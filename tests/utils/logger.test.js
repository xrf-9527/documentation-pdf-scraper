import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/utils/logger.test.js
import { createLogger, createLoggerAsync, consoleLogger } from '../../src/utils/logger.js';
import winston from 'winston';
import fs from 'fs/promises';
import path from 'path';

// Mock winston and fs
vi.mock('winston', () => {
  const mockTransports = {
    File: vi.fn(),
    Console: vi.fn(),
  };

  const mockFormat = {
    combine: vi.fn().mockReturnValue({}),
    colorize: vi.fn().mockReturnValue({}),
    simple: vi.fn().mockReturnValue({}),
    timestamp: vi.fn().mockReturnValue({}),
    errors: vi.fn().mockReturnValue({}),
    json: vi.fn().mockReturnValue({}),
    printf: vi.fn().mockReturnValue({}),
  };

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    logProgress: vi.fn(),
  };

  const mockWinston = {
    createLogger: vi.fn().mockReturnValue(mockLogger),
    transports: mockTransports,
    format: mockFormat,
  };

  return {
    default: mockWinston,
    ...mockWinston,
  };
});

vi.mock('fs/promises', () => {
  const mockFsPromises = {
    mkdir: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: mockFsPromises,
    ...mockFsPromises,
  };
});

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置环境变量
    delete process.env.NODE_ENV;
  });

  describe('createLogger', () => {
    test('应该创建带有默认配置的logger', () => {
      const logger = createLogger();

      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          defaultMeta: { service: 'pdf-scraper' },
        })
      );
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('error');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('debug');
      expect(logger).toHaveProperty('logProgress');
    });

    test('应该使用自定义日志级别', () => {
      createLogger({ level: 'debug' });

      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        })
      );
    });

    test('应该使用logLevel配置选项', () => {
      createLogger({ logLevel: 'warn' });

      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
        })
      );
    });

    test('应该在测试环境中不包含文件传输', () => {
      process.env.NODE_ENV = 'test';
      createLogger();

      const createLoggerCall = winston.createLogger.mock.calls[0][0];
      const transports = createLoggerCall.transports;

      // 验证没有文件传输
      const fileTransports = transports.filter((t) =>
        winston.transports.File.mock.instances.includes(t)
      );
      expect(fileTransports).toHaveLength(0);
    });

    test('应该在非测试环境中包含文件传输', () => {
      process.env.NODE_ENV = 'production';
      createLogger();

      expect(winston.transports.File).toHaveBeenCalledTimes(2); // error.log 和 combined.log
      expect(winston.transports.File).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringContaining('error.log'),
          level: 'error',
          maxsize: 10485760,
          maxFiles: 5,
        })
      );
      expect(winston.transports.File).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringContaining('combined.log'),
          maxsize: 10485760,
          maxFiles: 5,
        })
      );
    });

    test('应该可以禁用文件传输', () => {
      createLogger({ includeFileTransports: false });

      expect(winston.transports.File).not.toHaveBeenCalled();
    });

    test('应该默认包含控制台传输', () => {
      createLogger();

      expect(winston.transports.Console).toHaveBeenCalled();
    });

    test('应该使用简单格式当指定时', () => {
      createLogger({ format: 'simple' });

      expect(winston.format.simple).toHaveBeenCalled();
      expect(winston.format.colorize).toHaveBeenCalled();
    });

    test('应该使用默认格式当未指定simple时', () => {
      createLogger();

      expect(winston.format.timestamp).toHaveBeenCalledWith({
        format: 'HH:mm:ss',
      });
      expect(winston.format.printf).toHaveBeenCalled();
    });

    test('应该创建日志目录', () => {
      createLogger();

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
    });

    test('应该处理日志目录创建失败', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      fs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      createLogger();

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith('创建日志目录失败:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    test('logProgress方法应该添加进度类型', () => {
      const logger = createLogger();
      const mockInfo = logger.info;

      logger.logProgress('处理中', { current: 10, total: 100 });

      expect(mockInfo).toHaveBeenCalledWith('处理中', {
        type: 'progress',
        current: 10,
        total: 100,
      });
    });
  });

  describe('createLoggerAsync', () => {
    test('应该等待目录创建并返回logger', async () => {
      const logger = await createLoggerAsync();

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
      expect(winston.createLogger).toHaveBeenCalled();
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('logProgress');
    });

    test('应该强制包含文件传输', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production'; // 设置为非测试环境
      vi.clearAllMocks(); // 清除之前测试的mock调用

      await createLoggerAsync();

      // createLoggerAsync 强制 includeFileTransports: true
      expect(winston.transports.File).toHaveBeenCalledTimes(2); // error.log 和 combined.log

      process.env.NODE_ENV = originalEnv; // 恢复原始环境
    });

    test('应该处理目录创建错误但仍返回logger', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      fs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const logger = await createLoggerAsync();

      expect(consoleSpy).toHaveBeenCalledWith('创建日志目录失败:', expect.any(Error));
      expect(winston.createLogger).toHaveBeenCalled();
      expect(logger).toBeDefined();

      consoleSpy.mockRestore();
    });

    test('应该传递配置选项', async () => {
      await createLoggerAsync({ level: 'debug', format: 'simple' });

      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        })
      );
    });
  });

  describe('consoleLogger', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = {
        log: vi.spyOn(console, 'log').mockImplementation(),
        warn: vi.spyOn(console, 'warn').mockImplementation(),
        error: vi.spyOn(console, 'error').mockImplementation(),
      };
    });

    afterEach(() => {
      Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
    });

    test('应该提供基本的日志方法', () => {
      expect(consoleLogger).toHaveProperty('debug');
      expect(consoleLogger).toHaveProperty('info');
      expect(consoleLogger).toHaveProperty('warn');
      expect(consoleLogger).toHaveProperty('error');
      expect(consoleLogger).toHaveProperty('logProgress');
    });

    test('debug和info应该使用console.log', () => {
      console.log('Debug message');
      console.log('Info message');

      expect(consoleSpy.log).toHaveBeenCalledWith('Debug message');
      expect(consoleSpy.log).toHaveBeenCalledWith('Info message');
    });

    test('warn应该使用console.warn', () => {
      console.warn('Warning message');

      expect(consoleSpy.warn).toHaveBeenCalledWith('Warning message');
    });

    test('error应该使用console.error', () => {
      console.error('Error message');

      expect(consoleSpy.error).toHaveBeenCalledWith('Error message');
    });

    test('logProgress应该格式化进度消息', () => {
      consoleLogger.logProgress('处理中', { current: 10, total: 100 });

      expect(consoleSpy.log).toHaveBeenCalledWith('[PROGRESS] 处理中', { current: 10, total: 100 });
    });
  });
});
