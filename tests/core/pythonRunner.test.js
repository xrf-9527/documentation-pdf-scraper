import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { spawn } from 'child_process';
import fs from 'fs';
import { EventEmitter } from 'events';
import PythonRunner from '../../src/core/pythonRunner.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => {
  const mockFs = {
    promises: {
      access: vi.fn(),
      stat: vi.fn(),
    },
  };

  return {
    default: mockFs,
    ...mockFs,
  };
});

// Mock logger module
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('PythonRunner', () => {
  let pythonRunner;
  let mockProcess;
  let mockLogger;

  beforeEach(() => {
    // Create mock process
    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    mockProcess.kill = vi.fn();
    mockProcess.killed = false;
    mockProcess.pid = 12345;

    spawn.mockReturnValue(mockProcess);

    pythonRunner = new PythonRunner({
      pythonExecutable: 'python3',
      pythonTimeout: 5000,
      pythonCwd: '/test/dir',
    });

    mockLogger = pythonRunner.logger;

    // Mock file system operations
    fs.promises.access.mockResolvedValue();
    fs.promises.stat.mockResolvedValue({
      isFile: () => true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const runner = new PythonRunner();

      expect(runner.config.pythonExecutable).toBe('python3');
      expect(runner.config.timeout).toBe(300000);
      expect(runner.config.maxBuffer).toBe(10485760);
      expect(runner.config.encoding).toBe('utf8');
      expect(runner.runningProcesses).toBeInstanceOf(Map);
    });

    it('should merge custom config', () => {
      const runner = new PythonRunner({
        pythonExecutable: 'python',
        pythonTimeout: 10000,
        pythonPath: '/custom/path',
      });

      expect(runner.config.pythonExecutable).toBe('python');
      expect(runner.config.timeout).toBe(10000);
      expect(runner.config.env.PYTHONPATH).toBe('/custom/path');
    });

    it('should set Python environment variables', () => {
      const runner = new PythonRunner({
        pythonEnv: { CUSTOM_VAR: 'value' },
      });

      expect(runner.config.env.PYTHONIOENCODING).toBe('utf-8');
      expect(runner.config.env.CUSTOM_VAR).toBe('value');
    });
  });

  describe('runScript', () => {
    it('should execute script successfully', async () => {
      const scriptPath = '/test/script.py';
      const args = ['arg1', 'arg2'];

      // Simulate successful execution
      process.nextTick(() => {
        mockProcess.stdout.emit('data', Buffer.from('Output line 1\n'));
        mockProcess.stdout.emit('data', Buffer.from('Output line 2'));
        mockProcess.emit('exit', 0, null);
      });

      const result = await pythonRunner.runScript(scriptPath, args);

      expect(result).toMatchObject({
        success: true,
        exitCode: 0,
        stdout: 'Output line 1\nOutput line 2',
        stderr: '',
        duration: expect.any(Number),
        processId: expect.stringMatching(/^python_\d+_[a-z0-9]+$/),
      });

      expect(spawn).toHaveBeenCalledWith(
        'python3',
        [scriptPath, 'arg1', 'arg2'],
        expect.objectContaining({
          cwd: '/test/dir',
          env: expect.objectContaining({
            PYTHONIOENCODING: 'utf-8',
          }),
          timeout: 5000,
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting Python script execution',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Python script execution completed successfully',
        expect.any(Object)
      );
    });

    it('should handle script execution failure', async () => {
      const scriptPath = '/test/script.py';

      // Simulate failed execution
      process.nextTick(() => {
        mockProcess.stderr.emit('data', Buffer.from('Error occurred'));
        mockProcess.emit('exit', 1, null);
      });

      const result = await pythonRunner.runScript(scriptPath);

      expect(result).toMatchObject({
        success: false,
        error: 'Python script exited with code 1',
        exitCode: 1,
        stdout: '',
        stderr: 'Error occurred',
        duration: expect.any(Number),
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Python script execution failed',
        expect.any(Object)
      );
    });

    it('should handle process spawn error', async () => {
      const scriptPath = '/test/script.py';

      // Simulate spawn error
      process.nextTick(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      });

      const result = await pythonRunner.runScript(scriptPath);

      expect(result).toMatchObject({
        success: false,
        error: 'Spawn failed',
        exitCode: -1,
      });
    });

    it('should validate script before execution', async () => {
      fs.promises.access.mockRejectedValue(new Error('File not found'));

      const result = await pythonRunner.runScript('/nonexistent/script.py');

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Script validation failed'),
      });
    });

    it('should skip validation for command line execution', async () => {
      process.nextTick(() => {
        mockProcess.stdout.emit('data', Buffer.from('3.9.0'));
        mockProcess.emit('exit', 0, null);
      });

      const result = await pythonRunner.runScript('-c', ['print("hello")']);

      expect(result.success).toBe(true);
      expect(fs.promises.access).not.toHaveBeenCalled();
    });

    it('should handle input option', async () => {
      process.nextTick(() => {
        mockProcess.emit('exit', 0, null);
      });

      await pythonRunner.runScript('/test/script.py', [], {
        input: 'test input',
      });

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('test input');
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it('should log output when logOutput is true', async () => {
      process.nextTick(() => {
        mockProcess.stdout.emit('data', Buffer.from('Debug output'));
        mockProcess.stderr.emit('data', Buffer.from('Error output'));
        mockProcess.emit('exit', 0, null);
      });

      await pythonRunner.runScript('/test/script.py', [], {
        logOutput: true,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Python stdout'),
        'Debug output'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Python stderr'),
        'Error output'
      );
    });
  });

  describe('validateScript', () => {
    it('should validate Python file successfully', async () => {
      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({
        isFile: () => true,
      });

      await expect(pythonRunner.validateScript('/test/script.py')).resolves.not.toThrow();
    });

    it('should reject non-Python files', async () => {
      await expect(pythonRunner.validateScript('/test/script.js')).rejects.toThrow(
        'Invalid Python script file'
      );
    });

    it('should reject non-existent files', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));

      await expect(pythonRunner.validateScript('/test/script.py')).rejects.toThrow(
        'Script validation failed'
      );
    });

    it('should reject directories', async () => {
      fs.promises.stat.mockResolvedValue({
        isFile: () => false,
      });

      await expect(pythonRunner.validateScript('/test/dir.py')).rejects.toThrow(
        'Path is not a file'
      );
    });
  });

  describe('killProcess', () => {
    it('should kill process with SIGTERM', () => {
      pythonRunner.killProcess(mockProcess, 'test-id');

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should force kill with SIGKILL after timeout', () => {
      vi.useFakeTimers();

      pythonRunner.killProcess(mockProcess, 'test-id');

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Fast forward 5 seconds
      vi.advanceTimersByTime(5000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockLogger.warning).toHaveBeenCalledWith('Force killed Python process', {
        processId: 'test-id',
      });

      vi.useRealTimers();
    });

    it('should not kill already killed process', () => {
      mockProcess.killed = true;

      pythonRunner.killProcess(mockProcess, 'test-id');

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should handle kill errors', () => {
      mockProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      pythonRunner.killProcess(mockProcess, 'test-id');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error killing Python process',
        expect.objectContaining({
          error: 'Kill failed',
        })
      );
    });
  });

  describe('getRunningProcesses', () => {
    it('should return empty array when no processes', () => {
      const processes = pythonRunner.getRunningProcesses();

      expect(processes).toEqual([]);
    });

    it('should return running process info', async () => {
      // Start a process
      const promise = pythonRunner.runScript('/test/script.py', ['arg1']);

      // Wait for process to be registered
      await new Promise((resolve) => process.nextTick(resolve));

      const processes = pythonRunner.getRunningProcesses();

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        processId: expect.stringMatching(/^python_/),
        scriptPath: '/test/script.py',
        args: ['arg1'],
        startTime: expect.any(Number),
        duration: expect.any(Number),
        pid: 12345,
      });

      // Clean up
      mockProcess.emit('exit', 0);
      await promise;
    });
  });

  describe('killAllProcesses', () => {
    it('should kill all running processes', async () => {
      vi.useFakeTimers();
      vi.spyOn(pythonRunner, 'killProcess').mockImplementation(() => {});

      // Add some processes to the map
      pythonRunner.runningProcesses.set('proc1', { process: mockProcess });
      pythonRunner.runningProcesses.set('proc2', { process: mockProcess });

      const killPromise = pythonRunner.killAllProcesses();

      // Advance timers by 6 seconds to handle the setTimeout in killAllProcesses
      vi.advanceTimersByTime(6000);

      await killPromise;

      expect(pythonRunner.killProcess).toHaveBeenCalledTimes(2);
      expect(pythonRunner.runningProcesses.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('All Python processes terminated');

      vi.useRealTimers();
    });
  });

  describe('checkPythonEnvironment', () => {
    it('should check Python environment successfully', async () => {
      process.nextTick(() => {
        mockProcess.stdout.emit('data', Buffer.from('Python 3.9.0'));
        mockProcess.emit('exit', 0, null);
      });

      const result = await pythonRunner.checkPythonEnvironment();

      expect(result).toEqual({
        available: true,
        version: 'Python 3.9.0',
        executable: 'python3',
      });

      expect(spawn).toHaveBeenCalledWith(
        'python3',
        ['-c', 'import sys; print(sys.version)'],
        expect.any(Object)
      );
    });

    it('should handle environment check failure', async () => {
      process.nextTick(() => {
        mockProcess.emit('exit', 1, null);
      });

      const result = await pythonRunner.checkPythonEnvironment();

      expect(result).toMatchObject({
        available: false,
        error: expect.any(String),
        executable: 'python3',
      });
    });
  });

  describe('dispose', () => {
    it('should dispose resources', async () => {
      vi.spyOn(pythonRunner, 'killAllProcesses').mockResolvedValue();

      await pythonRunner.dispose();

      expect(pythonRunner.killAllProcesses).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Disposing Python runner...');
      expect(mockLogger.info).toHaveBeenCalledWith('Python runner disposed');
    });
  });

  describe('process management', () => {
    it('should track and clean up processes correctly', async () => {
      // Start process
      const promise = pythonRunner.runScript('/test/script.py');

      await new Promise((resolve) => process.nextTick(resolve));
      expect(pythonRunner.runningProcesses.size).toBe(1);

      // Complete process
      mockProcess.emit('exit', 0);
      await promise;

      expect(pythonRunner.runningProcesses.size).toBe(0);
    });
  });
});
