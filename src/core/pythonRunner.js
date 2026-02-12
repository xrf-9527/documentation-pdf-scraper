import { spawn } from 'child_process';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';

/**
 * Python脚本执行器
 * 提供安全、可监控的Python脚本执行功能
 */
class PythonRunner {
  constructor(config = {}, logger = null) {
    this.config = {
      pythonExecutable: config.pythonExecutable || 'python3',
      timeout: config.pythonTimeout || 300000, // 5分钟默认超时
      maxBuffer: config.maxBuffer || 1024 * 1024 * 10, // 10MB缓冲区
      encoding: config.encoding || 'utf8',
      cwd: config.pythonCwd || process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: config.pythonPath || '',
        PYTHONIOENCODING: 'utf-8',
        ...config.pythonEnv,
      },
      ...config,
    };

    this.logger = logger || createLogger('PythonRunner');
    this.runningProcesses = new Map();
  }

  /**
   * 执行Python脚本
   * @param {string} scriptPath - 脚本路径
   * @param {string[]} args - 命令行参数
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async runScript(scriptPath, args = [], options = {}) {
    const startTime = Date.now();
    const processId = `python_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 验证脚本文件（跳过Python命令行选项如-c）
      if (scriptPath !== '-c' && !scriptPath.startsWith('-')) {
        await this.validateScript(scriptPath);
      }

      const executionOptions = {
        ...this.config,
        ...options,
        timeout: options.timeout || this.config.timeout,
      };

      this.logger.info(`Starting Python script execution`, {
        processId,
        scriptPath,
        args,
        timeout: executionOptions.timeout,
      });

      const result = await this.executeProcess(scriptPath, args, executionOptions, processId);

      const duration = Date.now() - startTime;
      this.logger.info(`Python script execution completed successfully`, {
        processId,
        duration,
        exitCode: result.exitCode,
      });

      return {
        success: true,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
        processId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Python script execution failed`, {
        processId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        exitCode: error.exitCode || -1,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        duration,
        processId,
      };
    } finally {
      // 清理进程记录
      this.runningProcesses.delete(processId);
    }
  }

  /**
   * 执行进程
   * @private
   */
  async executeProcess(scriptPath, args, options, processId) {
    return new Promise((resolve, reject) => {
      const fullArgs = [scriptPath, ...args];

      const child = spawn(options.pythonExecutable, fullArgs, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout,
      });

      // 记录运行中的进程
      this.runningProcesses.set(processId, {
        process: child,
        startTime: Date.now(),
        scriptPath,
        args,
      });

      let stdout = '';
      let stderr = '';
      let isTimeout = false;

      // 设置超时处理
      const timeoutId = setTimeout(() => {
        isTimeout = true;
        this.logger.warning(`Python script execution timeout`, {
          processId,
          timeout: options.timeout,
        });

        this.killProcess(child, processId);
      }, options.timeout);

      // 收集标准输出
      child.stdout.on('data', (data) => {
        const chunk = data.toString(options.encoding);
        stdout += chunk;

        // 实时日志输出
        if (options.logOutput) {
          this.logger.debug(`Python stdout [${processId}]:`, chunk.trim());
        }
      });

      // 收集标准错误
      child.stderr.on('data', (data) => {
        const chunk = data.toString(options.encoding);
        stderr += chunk;

        // 实时日志输出
        if (options.logOutput) {
          this.logger.debug(`Python stderr [${processId}]:`, chunk.trim());
        }
      });

      // 进程退出处理
      child.on('exit', (code, signal) => {
        clearTimeout(timeoutId);

        this.logger.debug(`Python process exited`, {
          processId,
          exitCode: code,
          signal,
          isTimeout,
        });

        if (isTimeout) {
          reject(new Error(`Python script execution timeout after ${options.timeout}ms`));
        } else if (code === 0) {
          resolve({
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            signal,
          });
        } else {
          const error = new Error(`Python script exited with code ${code}`);
          error.exitCode = code;
          error.stdout = stdout.trim();
          error.stderr = stderr.trim();
          error.signal = signal;
          reject(error);
        }
      });

      // 进程错误处理
      child.on('error', (error) => {
        clearTimeout(timeoutId);

        this.logger.error(`Python process error`, {
          processId,
          error: error.message,
        });

        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
      });

      // 发送输入数据（如果有）
      if (options.input) {
        child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  }

  /**
   * 验证Python脚本
   * @private
   */
  async validateScript(scriptPath) {
    try {
      // 检查文件是否存在
      await fs.promises.access(scriptPath);

      // 检查是否是Python文件
      if (!scriptPath.endsWith('.py')) {
        throw new Error(`Invalid Python script file: ${scriptPath}`);
      }

      // 检查文件是否可读
      const stats = await fs.promises.stat(scriptPath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${scriptPath}`);
      }
    } catch (error) {
      throw new Error(`Script validation failed: ${error.message}`);
    }
  }

  /**
   * 强制终止进程
   * @private
   */
  killProcess(process, processId) {
    try {
      if (process && !process.killed) {
        // 尝试优雅关闭
        process.kill('SIGTERM');

        // 如果5秒后仍未关闭，强制终止
        const forceKillTimeout = setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
            this.logger.warning(`Force killed Python process`, { processId });
          }
        }, 5000);

        // 不要因为这个保护性定时器阻止 Node 测试进程退出
        if (forceKillTimeout && typeof forceKillTimeout.unref === 'function') {
          forceKillTimeout.unref();
        }
      }
    } catch (error) {
      this.logger.error(`Error killing Python process`, {
        processId,
        error: error.message,
      });
    }
  }

  /**
   * 获取正在运行的进程信息
   */
  getRunningProcesses() {
    const processes = [];
    for (const [processId, info] of this.runningProcesses) {
      processes.push({
        processId,
        scriptPath: info.scriptPath,
        args: info.args,
        startTime: info.startTime,
        duration: Date.now() - info.startTime,
        pid: info.process.pid,
      });
    }
    return processes;
  }

  /**
   * 终止所有运行中的进程
   */
  async killAllProcesses() {
    const processes = Array.from(this.runningProcesses.entries());

    this.logger.info(`Terminating ${processes.length} running Python processes`);

    for (const [processId, info] of processes) {
      this.killProcess(info.process, processId);
    }

    // 等待进程终止
    await new Promise((resolve) => setTimeout(resolve, 6000));

    this.runningProcesses.clear();
    this.logger.info('All Python processes terminated');
  }

  /**
   * 检查Python环境
   */
  async checkPythonEnvironment() {
    try {
      const result = await this.runScript('-c', ['import sys; print(sys.version)'], {
        timeout: 10000,
        logOutput: false,
      });

      if (result.success) {
        this.logger.info(`Python environment check passed`, {
          version: result.stdout.trim(),
        });
        return {
          available: true,
          version: result.stdout.trim(),
          executable: this.config.pythonExecutable,
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      this.logger.error(`Python environment check failed:`, error);
      return {
        available: false,
        error: error.message,
        executable: this.config.pythonExecutable,
      };
    }
  }

  /**
   * 清理资源
   */
  async dispose() {
    this.logger.info('Disposing Python runner...');
    await this.killAllProcesses();
    this.logger.info('Python runner disposed');
  }
}

export default PythonRunner;
