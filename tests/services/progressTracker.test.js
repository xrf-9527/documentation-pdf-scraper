import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/services/progressTracker.test.js
import { ProgressTracker } from '../../src/services/progressTracker.js';
import { EventEmitter } from 'events';
import chalk from 'chalk';

// Mock chalk to avoid color codes in tests
vi.mock('chalk', () => {
  const mockChalk = {
    green: vi.fn((text) => text),
    red: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    gray: vi.fn((text) => text),
    bold: vi.fn((text) => text),
  };

  return {
    default: mockChalk,
    ...mockChalk,
  };
});

describe('ProgressTracker', () => {
  let progressTracker;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    progressTracker = new ProgressTracker(mockLogger);

    vi.clearAllTimers();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    if (progressTracker.progressInterval) {
      progressTracker.stopProgressDisplay();
    }
    vi.useRealTimers();
    console.log.mockRestore();
  });

  describe('constructor', () => {
    test('应该正确初始化', () => {
      expect(progressTracker).toBeInstanceOf(EventEmitter);
      expect(progressTracker.stats).toEqual({
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        retried: 0,
        startTime: null,
        endTime: null,
        currentUrl: null,
        eta: null,
      });
      expect(progressTracker.urlStats).toBeInstanceOf(Map);
      expect(progressTracker.displayMode).toBe('detailed');
    });
  });

  describe('start', () => {
    test('应该开始追踪任务', () => {
      const startPromise = new Promise((resolve) => {
        progressTracker.once('start', resolve);
      });

      progressTracker.start(100);

      expect(progressTracker.stats.total).toBe(100);
      expect(progressTracker.stats.startTime).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith('开始爬取任务', {
        总数: 100,
        模式: 'detailed',
      });

      return startPromise.then((event) => {
        expect(event).toEqual({ total: 100 });
      });
    });

    test('应该在detailed模式下启动进度显示', () => {
      progressTracker.start(50, { displayMode: 'detailed' });

      expect(progressTracker.progressInterval).toBeDefined();
    });

    test('应该在simple模式下不启动进度显示', () => {
      progressTracker.start(50, { displayMode: 'simple' });

      expect(progressTracker.displayMode).toBe('simple');
      expect(progressTracker.progressInterval).toBeNull();
    });

    test('start should clear previous interval and reset state', () => {
      progressTracker.start(10);
      const firstInterval = progressTracker.progressInterval;
      progressTracker.success('url1');

      progressTracker.start(5);

      expect(progressTracker.stats.total).toBe(5);
      expect(progressTracker.stats.completed).toBe(0);
      expect(progressTracker.stats.failed).toBe(0);
      expect(progressTracker.stats.skipped).toBe(0);
      expect(progressTracker.stats.retried).toBe(0);
      expect(progressTracker.urlStats.size).toBe(0);
      expect(progressTracker.progressInterval).not.toBeNull();
      expect(progressTracker.progressInterval).not.toBe(firstInterval);
    });
  });

  describe('success', () => {
    test('应该记录成功的URL', () => {
      progressTracker.start(10);

      const successPromise = new Promise((resolve) => {
        progressTracker.once('success', resolve);
      });

      progressTracker.success('http://example.com', { size: 1024 });

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.status).toBe('success');
      expect(urlStat.endTime).toBeDefined();
      expect(urlStat.duration).toBeDefined();
      expect(urlStat.details).toEqual({ size: 1024 });

      expect(progressTracker.stats.completed).toBe(1);
      expect(progressTracker.stats.currentUrl).toBeNull();

      return successPromise;
    });

    test('应该避免重复计数', () => {
      progressTracker.start(10);
      progressTracker.success('http://example.com');
      progressTracker.success('http://example.com'); // 同一个URL再次成功

      expect(progressTracker.stats.completed).toBe(1);
    });

    test('应该更新ETA', () => {
      progressTracker.start(10);
      vi.spyOn(progressTracker, 'updateETA');

      progressTracker.success('http://example.com');

      expect(progressTracker.updateETA).toHaveBeenCalled();
    });
  });

  describe('failure', () => {
    test('应该记录失败的URL', () => {
      progressTracker.start(10);

      const failurePromise = new Promise((resolve) => {
        progressTracker.once('failure', resolve);
      });

      const error = new Error('Network error');
      progressTracker.failure('http://example.com', error);

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.status).toBe('failed');
      expect(urlStat.error).toBe('Network error');
      expect(urlStat.attempts).toBe(1);

      expect(progressTracker.stats.failed).toBe(1);

      return failurePromise;
    });

    test('应该处理将要重试的失败', () => {
      progressTracker.start(10);

      const error = new Error('Timeout');
      progressTracker.failure('http://example.com', error, true);

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.status).toBe('pending-retry');
      expect(progressTracker.stats.failed).toBe(0); // 不增加失败计数
    });

    test('应该避免重复计数失败', () => {
      progressTracker.start(10);
      progressTracker.failure('http://example.com', new Error('Error 1'));
      progressTracker.failure('http://example.com', new Error('Error 2'));

      expect(progressTracker.stats.failed).toBe(1);
    });
  });

  describe('skip', () => {
    test('应该记录跳过的URL', () => {
      progressTracker.start(10);

      const skipPromise = new Promise((resolve) => {
        progressTracker.once('skip', resolve);
      });

      progressTracker.skip('http://example.com', 'Already processed');

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.status).toBe('skipped');
      expect(urlStat.reason).toBe('Already processed');

      expect(progressTracker.stats.skipped).toBe(1);

      return skipPromise;
    });

    test('应该避免重复计数跳过', () => {
      progressTracker.start(10);
      progressTracker.skip('http://example.com', 'Reason 1');
      progressTracker.skip('http://example.com', 'Reason 2');

      expect(progressTracker.stats.skipped).toBe(1);
    });
  });

  describe('retry', () => {
    test('应该记录重试', () => {
      progressTracker.start(10);

      const retryPromise = new Promise((resolve) => {
        progressTracker.once('retry', resolve);
      });

      progressTracker.retry('http://example.com', 2);

      expect(progressTracker.stats.retried).toBe(1);

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.status).toBe('retrying');
      expect(urlStat.attempts).toBe(2);

      return retryPromise;
    });
  });

  describe('startUrl', () => {
    test('应该开始处理URL', () => {
      const urlStartPromise = new Promise((resolve) => {
        progressTracker.once('url-start', resolve);
      });

      progressTracker.startUrl('http://example.com');

      expect(progressTracker.stats.currentUrl).toBe('http://example.com');

      const urlStat = progressTracker.urlStats.get('http://example.com');
      expect(urlStat.startTime).toBeDefined();
      expect(urlStat.status).toBe('processing');

      return urlStartPromise;
    });
  });

  describe('finish', () => {
    test('应该完成追踪并显示报告', async () => {
      progressTracker.start(10);
      progressTracker.stats.startTime = Date.now() - 5000; // 5秒前

      // 添加一些统计数据
      progressTracker.success('url1');
      progressTracker.success('url2');
      progressTracker.failure('url3', new Error('Error'));
      progressTracker.skip('url4');

      const finishPromise = new Promise((resolve) => {
        progressTracker.once('finish', resolve);
      });

      vi.spyOn(progressTracker, 'displayFinalReport');

      progressTracker.finish();

      expect(progressTracker.stats.endTime).toBeDefined();
      expect(progressTracker.displayFinalReport).toHaveBeenCalled();

      const event = await finishPromise;
      expect(event.duration).toBeGreaterThan(0);
      expect(event.summary).toBeDefined();
    });

    test('应该停止进度显示', () => {
      progressTracker.start(10);
      vi.spyOn(progressTracker, 'stopProgressDisplay');

      progressTracker.finish();

      expect(progressTracker.stopProgressDisplay).toHaveBeenCalled();
    });
  });

  describe('updateETA', () => {
    test('应该计算预计完成时间', () => {
      progressTracker.start(100);
      progressTracker.stats.startTime = Date.now() - 10000; // 10秒前
      progressTracker.stats.completed = 20;

      progressTracker.updateETA();

      expect(progressTracker.stats.eta).toBeGreaterThan(0);
    });

    test('应该处理没有进度的情况', () => {
      progressTracker.start(100);
      progressTracker.updateETA();

      expect(progressTracker.stats.eta).toBeNull();
    });

    test('应该处理所有任务完成的情况', () => {
      progressTracker.start(10);
      progressTracker.stats.completed = 10;

      progressTracker.updateETA();

      expect(progressTracker.stats.eta).toBe(0);
    });
  });

  describe('getStats', () => {
    test('应该返回正确的统计信息', () => {
      progressTracker.start(100);
      progressTracker.stats.startTime = Date.now() - 10000;
      progressTracker.success('url1');
      progressTracker.success('url2');
      progressTracker.failure('url3', new Error('Error'));
      progressTracker.skip('url4');

      const stats = progressTracker.getStats();

      expect(stats.total).toBe(100);
      expect(stats.succeeded).toBe(2);
      expect(stats.processed).toBe(4); // 基于唯一URL
      expect(stats.percentage).toBe('4.00');
      expect(stats.rate).toMatch(/^\d+\.\d{2}$/);
      expect(stats.elapsed).toMatch(/^\d+$/);
      expect(stats.etaSeconds).toBeDefined();
    });

    test('应该处理零进度的情况', () => {
      progressTracker.start(100);

      const stats = progressTracker.getStats();

      expect(stats.succeeded).toBe(0);
      expect(stats.processed).toBe(0);
      expect(stats.percentage).toBe('0.00');
      expect(stats.rate).toBe('0.00');
    });
  });

  describe('getSummary', () => {
    test('应该返回任务摘要', () => {
      progressTracker.start(10);
      progressTracker.stats.startTime = Date.now() - 5000;
      progressTracker.stats.endTime = Date.now();
      progressTracker.success('url1');
      progressTracker.success('url2');
      progressTracker.failure('url3', new Error('Error'));
      progressTracker.skip('url4');

      const summary = progressTracker.getSummary();

      expect(summary).toEqual({
        总数: 10,
        成功: 2,
        失败: 1,
        跳过: 1,
        重试次数: 0,
        成功率: '20.00%',
        总耗时: expect.stringMatching(/^\d+\.\d{2}秒$/),
        平均速度: expect.stringMatching(/^\d+\.\d{2} 页\/秒$/),
      });
    });
  });

  describe('日志输出', () => {
    test('应该在详细模式下输出进度日志', () => {
      progressTracker.start(10);
      progressTracker.displayMode = 'detailed';

      progressTracker.success('http://example.com');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✓ [1/10] http://example.com')
      );
    });

    test('应该在简单模式下不输出进度日志', () => {
      progressTracker.start(10);
      progressTracker.displayMode = 'simple';

      progressTracker.success('http://example.com');

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('http://example.com')
      );
    });
  });

  describe('进度条', () => {
    test('应该创建正确的进度条', () => {
      const progressBar = progressTracker.createProgressBar(50);
      expect(progressBar).toContain('█'.repeat(10));
      expect(progressBar).toContain('░'.repeat(10));
    });

    test('应该处理边界值', () => {
      expect(progressTracker.createProgressBar(0)).toContain('░'.repeat(20));
      expect(progressTracker.createProgressBar(100)).toContain('█'.repeat(20));
      expect(progressTracker.createProgressBar(150)).toContain('█'.repeat(20)); // 限制在100%
      expect(progressTracker.createProgressBar(-10)).toContain('░'.repeat(20)); // 限制在0%
    });
  });

  describe('时间格式化', () => {
    test('应该正确格式化时间', () => {
      expect(progressTracker.formatTime(30)).toBe('30秒');
      expect(progressTracker.formatTime(90)).toBe('1分30秒');
      expect(progressTracker.formatTime(3661)).toBe('1小时1分');
    });
  });

  describe('定期进度显示', () => {
    test('应该定期显示进度', () => {
      progressTracker.start(100);
      progressTracker.stats.currentUrl = 'http://current.com';
      progressTracker.startProgressDisplay();

      // 快进5秒
      vi.advanceTimersByTime(5000);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('处理中: http://current.com')
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('进度:'));
    });

    test('应该停止进度显示', () => {
      progressTracker.startProgressDisplay();
      const interval = progressTracker.progressInterval;

      progressTracker.stopProgressDisplay();

      expect(progressTracker.progressInterval).toBeNull();
    });
  });

  describe('最终报告', () => {
    test('应该显示成功的最终报告', () => {
      progressTracker.start(10);
      progressTracker.success('url1');
      progressTracker.success('url2');
      progressTracker.stats.failed = 0;

      progressTracker.displayFinalReport();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('=== 爬取任务完成报告 ==='));
    });

    test('应该显示失败的URL', () => {
      progressTracker.start(10);
      progressTracker.failure('http://failed1.com', new Error('Error 1'));
      progressTracker.failure('http://failed2.com', new Error('Error 2'));

      progressTracker.displayFinalReport();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('失败的URL:'));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('http://failed1.com: Error 1')
      );
    });
  });

  describe('exportDetailedReport', () => {
    test('应该导出详细报告', async () => {
      const mockFileService = {
        writeJson: vi.fn(),
      };

      progressTracker.start(10);
      progressTracker.success('url1');
      progressTracker.failure('url2', new Error('Error'));

      const report = await progressTracker.exportDetailedReport(
        '/reports/test.json',
        mockFileService
      );

      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/reports/test.json',
        expect.objectContaining({
          summary: expect.any(Object),
          stats: expect.any(Object),
          urlDetails: expect.any(Array),
          generatedAt: expect.any(String),
        })
      );

      expect(report.urlDetails).toHaveLength(2);
    });
  });
});
