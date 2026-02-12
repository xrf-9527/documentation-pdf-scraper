import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/utils/common.test.js
import {
  delay,
  retry,
  isIgnored,
  retryWithProgress,
  batchDelay,
  exponentialBackoff,
  jitteredDelay,
  applyJitter,
} from '../../src/utils/common.js';

describe('Common Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('delay', () => {
    test('应该延迟指定的毫秒数', async () => {
      const promise = delay(1000);

      // 使用 vi.advanceTimersByTime 而不是直接检查 setTimeout
      vi.advanceTimersByTime(1000);
      await promise;
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      vi.useRealTimers(); // retry tests need real timers
    });

    afterEach(() => {
      vi.useFakeTimers();
    });

    test('应该在第一次成功时返回结果', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('应该重试失败的函数', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'))
        .mockResolvedValue('success');

      const result = await retry(fn, { delay: 10 }); // 使用短延迟

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('应该在所有尝试失败后抛出最后的错误', async () => {
      const lastError = new Error('Final error');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValue(lastError);

      await expect(retry(fn, { maxAttempts: 3, delay: 10 })).rejects.toThrow('Final error');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('应该使用指数退避', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await retry(fn, { delay: 10, backoff: 2 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('应该调用onRetry回调', async () => {
      const onRetry = vi.fn();
      const error = new Error('Test error');
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      await retry(fn, { onRetry, delay: 10, jitterStrategy: 'none' });

      // 新签名包含 waitTime 作为第三个参数
      expect(onRetry).toHaveBeenCalledWith(1, error, expect.any(Number));
    });

    test('decorrelated jitter 应该遵守 maxDelay 上限', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const waits = [];
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);

      const result = await retry(fn, {
        maxAttempts: 3,
        delay: 50,
        backoff: 3,
        maxDelay: 100,
        jitterStrategy: 'decorrelated',
        onRetry: (attempt, error, waitTime) => {
          waits.push(waitTime);
        },
      });

      randomSpy.mockRestore();

      expect(result).toBe('success');
      expect(waits.length).toBe(2);
      waits.forEach((w) => {
        expect(w).toBeLessThanOrEqual(100);
        expect(w).toBeGreaterThan(0);
      });
    });
  });

  describe('applyJitter', () => {
    test('strategy 为 none 时应返回 baseDelay', () => {
      expect(applyJitter(1000, 'none')).toBe(1000);
    });

    test('full jitter 应该在 [0, baseDelay] 范围内', () => {
      const mockRandom = vi.spyOn(Math, 'random');

      mockRandom.mockReturnValue(0);
      expect(applyJitter(1000, 'full')).toBe(0);

      mockRandom.mockReturnValue(1);
      expect(applyJitter(1000, 'full')).toBe(1000);

      mockRandom.mockRestore();
    });

    test('equal jitter 应该在 [base/2, base] 范围内', () => {
      const mockRandom = vi.spyOn(Math, 'random');

      mockRandom.mockReturnValue(0);
      expect(applyJitter(1000, 'equal')).toBe(500);

      mockRandom.mockReturnValue(1);
      expect(applyJitter(1000, 'equal')).toBe(1000);

      mockRandom.mockRestore();
    });

    test('decorrelated jitter 应该在 [base, prev*3] 范围内', () => {
      const mockRandom = vi.spyOn(Math, 'random');

      // 最小值：base
      mockRandom.mockReturnValue(0);
      expect(applyJitter(1000, 'decorrelated', 2000)).toBe(1000);

      // 最大值：3 * prev
      mockRandom.mockReturnValue(1);
      expect(applyJitter(1000, 'decorrelated', 2000)).toBe(6000);

      mockRandom.mockRestore();
    });
  });

  describe('isIgnored', () => {
    test('应该识别被忽略的URL', () => {
      const ignoreURLs = ['/api/deprecated', '/test', 'localhost'];

      expect(isIgnored('https://example.com/api/deprecated/v1', ignoreURLs)).toBe(true);
      expect(isIgnored('https://example.com/test/page', ignoreURLs)).toBe(true);
      expect(isIgnored('http://localhost:3000', ignoreURLs)).toBe(true);
    });

    test('应该不忽略未匹配的URL', () => {
      const ignoreURLs = ['/api/deprecated', '/test'];

      expect(isIgnored('https://example.com/api/v2', ignoreURLs)).toBe(false);
      expect(isIgnored('https://example.com/docs', ignoreURLs)).toBe(false);
    });

    test('应该处理空的忽略列表', () => {
      expect(isIgnored('https://example.com/any', [])).toBe(false);
    });
  });

  describe('retryWithProgress', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('应该调用进度回调', async () => {
      const onProgress = vi.fn();
      const fn = vi.fn().mockRejectedValueOnce(new Error('Fail')).mockResolvedValue('success');

      const promise = retryWithProgress(fn, { onProgress, maxAttempts: 3, delay: 100 });

      // 第一次尝试
      await Promise.resolve();
      expect(onProgress).toHaveBeenCalledWith({ attempt: 1, maxAttempts: 3 });

      // 运行延迟并进行第二次尝试
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      expect(onProgress).toHaveBeenCalledWith({ attempt: 2, maxAttempts: 3 });

      const result = await promise;
      expect(result).toBe('success');
    });

    test('应该调用重试回调并包含等待时间', async () => {
      const onRetry = vi.fn();
      const error = new Error('Test error');
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      const promise = retryWithProgress(fn, {
        onRetry,
        delay: 100,
        backoff: 2,
      });

      // 第一次尝试失败
      await Promise.resolve();

      // 运行延迟
      vi.advanceTimersByTime(100);

      const result = await promise;

      expect(onRetry).toHaveBeenCalledWith(1, error, 100);
      expect(result).toBe('success');
    });
  });

  describe('batchDelay', () => {
    test('应该批量执行任务并延迟', async () => {
      const task1 = vi.fn().mockResolvedValue('result1');
      const task2 = vi.fn().mockResolvedValue('result2');
      const task3 = vi.fn().mockResolvedValue('result3');

      // 开始执行
      const promise = batchDelay([task1, task2, task3], 100);

      // 让第一个任务执行并完成
      await Promise.resolve();
      await Promise.resolve();
      expect(task1).toHaveBeenCalled();

      // 运行延迟，让第二个任务执行
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(task2).toHaveBeenCalled();

      // 运行延迟，让第三个任务执行
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(task3).toHaveBeenCalled();

      const results = await promise;

      expect(results).toEqual([
        { success: true, result: 'result1', index: 0 },
        { success: true, result: 'result2', index: 1 },
        { success: true, result: 'result3', index: 2 },
      ]);
    });

    test('应该处理失败的任务', async () => {
      // 临时使用真实计时器
      vi.useRealTimers();

      const error = new Error('Task failed');
      const task1 = vi.fn().mockResolvedValue('result1');
      const task2 = vi.fn().mockRejectedValue(error);
      const task3 = vi.fn().mockResolvedValue('result3');

      const results = await batchDelay([task1, task2, task3], 0);

      expect(results).toEqual([
        { success: true, result: 'result1', index: 0 },
        { success: false, error, index: 1 },
        { success: true, result: 'result3', index: 2 },
      ]);

      // 恢复假计时器
      vi.useFakeTimers();
    });
  });

  describe('exponentialBackoff', () => {
    test('应该计算正确的指数退避延迟', async () => {
      // 第0次尝试: 1000ms
      const promise1 = exponentialBackoff(0, 1000, 30000);
      vi.advanceTimersByTime(1000);
      await promise1;

      // 第2次尝试: 4000ms
      const promise2 = exponentialBackoff(2, 1000, 30000);
      vi.advanceTimersByTime(4000);
      await promise2;

      // 第10次尝试: 应该被限制在30000ms
      const promise3 = exponentialBackoff(10, 1000, 30000);
      vi.advanceTimersByTime(30000);
      await promise3;
    });
  });

  describe('jitteredDelay', () => {
    test('应该添加随机抖动到延迟', async () => {
      // Mock Math.random 返回固定值
      const mockRandom = vi.spyOn(Math, 'random');

      // 测试最大正抖动
      mockRandom.mockReturnValue(1);
      const promise1 = jitteredDelay(1000, 0.1);
      vi.advanceTimersByTime(1100); // 1000 * 1.1
      await promise1;

      // 测试最大负抖动
      mockRandom.mockReturnValue(0);
      const promise2 = jitteredDelay(1000, 0.1);
      vi.advanceTimersByTime(900); // 1000 * 0.9
      await promise2;

      // 测试无抖动
      mockRandom.mockReturnValue(0.5);
      const promise3 = jitteredDelay(1000, 0.1);
      vi.advanceTimersByTime(1000); // 1000 * 1.0
      await promise3;

      mockRandom.mockRestore();
    });

    test('应该确保延迟不为负数', async () => {
      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0);

      const promise = jitteredDelay(100, 2); // 极大的抖动可能导致负数
      vi.runAllTimers();
      await promise;

      // 通过运行所有计时器来验证不会出错
      mockRandom.mockRestore();
    });
  });
});
