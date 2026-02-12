import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/utils/errors.test.js
import {
  ScraperError,
  ValidationError,
  NetworkError,
  FileOperationError,
  BrowserError,
  ImageLoadError,
  ProcessingError,
  ErrorCategory,
  categorizeError,
  isRetryableError,
  isIgnorableError,
  getRetryStrategy,
  formatError,
} from '../../src/utils/errors.js';

describe('错误类', () => {
  describe('ScraperError', () => {
    test('应该创建基础错误实例', () => {
      const error = new ScraperError('Test error', 'TEST_CODE', { detail: 'test' });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ScraperError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ detail: 'test' });
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    test('应该正确序列化为JSON', () => {
      const error = new ScraperError('Test error', 'TEST_CODE', { detail: 'test' });
      const json = error.toJSON();

      expect(json).toHaveProperty('name', 'ScraperError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('code', 'TEST_CODE');
      expect(json).toHaveProperty('details', { detail: 'test' });
      expect(json).toHaveProperty('timestamp');
      expect(json).toHaveProperty('stack');
    });
  });

  describe('ValidationError', () => {
    test('应该创建验证错误实例', () => {
      const error = new ValidationError('Validation failed', { field: 'url' });

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(ScraperError);
      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'url' });
    });
  });

  describe('NetworkError', () => {
    test('应该创建网络错误实例', () => {
      const originalError = new Error('Connection failed');
      const error = new NetworkError('Network request failed', 'http://test.com', originalError);

      expect(error).toBeInstanceOf(NetworkError);
      expect(error.message).toBe('Network request failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.details).toEqual({
        url: 'http://test.com',
        originalError: 'Connection failed',
      });
    });

    test('应该处理字符串类型的原始错误', () => {
      const error = new NetworkError('Network failed', 'http://test.com', 'Timeout');

      expect(error.details.originalError).toBe('Timeout');
    });
  });

  describe('FileOperationError', () => {
    test('应该创建文件操作错误实例', () => {
      const error = new FileOperationError('File not found', '/path/to/file', 'read');

      expect(error).toBeInstanceOf(FileOperationError);
      expect(error.code).toBe('FILE_ERROR');
      expect(error.details).toEqual({
        filePath: '/path/to/file',
        operation: 'read',
      });
    });
  });

  describe('BrowserError', () => {
    test('应该创建浏览器错误实例', () => {
      const error = new BrowserError('Browser crashed', { pid: 12345 });

      expect(error).toBeInstanceOf(BrowserError);
      expect(error.code).toBe('BROWSER_ERROR');
      expect(error.details).toEqual({ pid: 12345 });
    });
  });

  describe('ImageLoadError', () => {
    test('应该创建图片加载错误实例', () => {
      const error = new ImageLoadError('Image failed to load', 'http://test.com/image.jpg', {
        statusCode: 404,
      });

      expect(error).toBeInstanceOf(ImageLoadError);
      expect(error.code).toBe('IMAGE_LOAD_ERROR');
      expect(error.details).toEqual({
        url: 'http://test.com/image.jpg',
        statusCode: 404,
      });
    });
  });

  describe('ProcessingError', () => {
    test('应该创建处理错误实例', () => {
      const error = new ProcessingError('PDF generation failed', {
        step: 'merge',
        file: 'test.pdf',
      });

      expect(error).toBeInstanceOf(ProcessingError);
      expect(error.code).toBe('PROCESSING_ERROR');
      expect(error.details).toEqual({
        step: 'merge',
        file: 'test.pdf',
      });
    });
  });
});

describe('错误分类工具', () => {
  describe('categorizeError', () => {
    test('应该识别可忽略的JS错误', () => {
      const errors = [
        new Error('Invariant: attempted to hard navigate to the same URL'),
        new Error('Navigation cancelled by a newer navigation'),
        new Error('ResizeObserver loop limit exceeded'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.IGNORABLE_JS);
      });
    });

    test('应该识别可重试的网络错误', () => {
      const networkErrors = [
        new Error('ECONNRESET'),
        new Error('ETIMEDOUT'),
        new Error('ENOTFOUND'),
        new Error('ECONNREFUSED'),
        new Error('net::ERR_NETWORK_CHANGED'),
        new Error('net::ERR_INTERNET_DISCONNECTED'),
        new Error('HTTP 502 Bad Gateway'),
        new Error('HTTP 503 Service Unavailable'),
      ];

      networkErrors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.RETRYABLE_NETWORK);
      });

      // HTTP 504 Gateway Timeout 包含 "Timeout"，所以被归类为超时错误
      const timeoutError = new Error('HTTP 504 Gateway Timeout');
      expect(categorizeError(timeoutError)).toBe(ErrorCategory.RETRYABLE_TIMEOUT);
    });

    test('应该识别可重试的超时错误', () => {
      const errors = [
        new Error('Navigation timeout'),
        new Error('Request timeout exceeded'),
        new Error('Operation Timeout'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.RETRYABLE_TIMEOUT);
      });
    });

    test('应该识别可重试的浏览器错误', () => {
      const errors = [
        new Error('获取浏览器超时'),
        new Error('页面创建失败'),
        new Error('Browser closed unexpectedly'),
        new Error('Target closed'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.RETRYABLE_BROWSER);
      });
    });

    test('应该识别永久性HTTP错误', () => {
      const errors = [
        new Error('HTTP 404 Not Found'),
        new Error('HTTP 403 Forbidden'),
        new Error('HTTP 401 Unauthorized'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.PERMANENT_HTTP);
      });
    });

    test('应该识别永久性验证错误', () => {
      const errors = [
        new ValidationError('Invalid URL'),
        new Error('页面内容未找到'),
        new Error('Invalid selector provided'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.PERMANENT_VALIDATION);
      });
    });

    test('应该识别系统级错误', () => {
      const errors = [
        new Error('ENOSPC: no space left on device'),
        new Error('EMFILE: too many open files'),
        new Error('ENOMEM: out of memory'),
      ];

      errors.forEach((error) => {
        expect(categorizeError(error)).toBe(ErrorCategory.SYSTEM_ERROR);
      });
    });

    test('应该将未知错误分类为UNKNOWN', () => {
      const error = new Error('Some random error');
      expect(categorizeError(error)).toBe(ErrorCategory.UNKNOWN);
    });
  });

  describe('isRetryableError', () => {
    test('应该正确识别可重试的错误', () => {
      const retryableErrors = [
        new Error('ECONNRESET'),
        new Error('Navigation timeout'),
        new Error('Browser closed'),
      ];

      retryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    test('应该正确识别不可重试的错误', () => {
      const nonRetryableErrors = [
        new Error('HTTP 404'),
        new ValidationError('Invalid input'),
        new Error('ENOSPC'),
      ];

      nonRetryableErrors.forEach((error) => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('isIgnorableError', () => {
    test('应该正确识别可忽略的错误', () => {
      const ignorableError = new Error('ResizeObserver loop limit exceeded');
      expect(isIgnorableError(ignorableError)).toBe(true);
    });

    test('应该正确识别不可忽略的错误', () => {
      const nonIgnorableError = new Error('Network error');
      expect(isIgnorableError(nonIgnorableError)).toBe(false);
    });
  });

  describe('getRetryStrategy', () => {
    test('应该为网络错误返回合适的重试策略', () => {
      const error = new Error('ECONNRESET');
      const strategy = getRetryStrategy(error);

      expect(strategy).toEqual({
        maxAttempts: 5,
        baseDelay: 2000,
        backoffMultiplier: 1.5,
        maxDelay: 30000,
      });
    });

    test('应该为超时错误返回合适的重试策略', () => {
      const error = new Error('Navigation timeout');
      const strategy = getRetryStrategy(error);

      expect(strategy).toEqual({
        maxAttempts: 3,
        baseDelay: 5000,
        backoffMultiplier: 2,
        maxDelay: 60000,
      });
    });

    test('应该为浏览器错误返回合适的重试策略', () => {
      const error = new Error('Browser closed');
      const strategy = getRetryStrategy(error);

      expect(strategy).toEqual({
        maxAttempts: 3,
        baseDelay: 10000,
        backoffMultiplier: 2,
        maxDelay: 60000,
      });
    });

    test('应该为不可重试的错误返回无重试策略', () => {
      const error = new Error('HTTP 404');
      const strategy = getRetryStrategy(error);

      expect(strategy).toEqual({
        maxAttempts: 1,
        baseDelay: 0,
        backoffMultiplier: 1,
        maxDelay: 0,
      });
    });
  });

  describe('formatError', () => {
    test('应该格式化ScraperError实例', () => {
      const error = new ScraperError('Test error', 'TEST_CODE', { detail: 'test' });
      const formatted = formatError(error);

      expect(formatted).toHaveProperty('name', 'ScraperError');
      expect(formatted).toHaveProperty('message', 'Test error');
      expect(formatted).toHaveProperty('code', 'TEST_CODE');
      expect(formatted).toHaveProperty('details');
      expect(formatted).toHaveProperty('timestamp');
      expect(formatted).toHaveProperty('stack');
    });

    test('应该格式化普通Error实例', () => {
      const error = new Error('Regular error');
      const formatted = formatError(error);

      expect(formatted).toHaveProperty('name', 'Error');
      expect(formatted).toHaveProperty('message', 'Regular error');
      expect(formatted).toHaveProperty('stack');
      expect(formatted).toHaveProperty('timestamp');
    });

    test('应该处理非Error对象', () => {
      const error = 'String error';
      const formatted = formatError(error);

      expect(formatted).toHaveProperty('name', 'Error');
      expect(formatted).toHaveProperty('message', 'String error');
      expect(formatted).toHaveProperty('timestamp');
    });
  });
});
