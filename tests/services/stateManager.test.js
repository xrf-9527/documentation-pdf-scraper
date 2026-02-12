import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/services/stateManager.test.js
import { StateManager } from '../../src/services/stateManager.js';
import { EventEmitter } from 'events';

describe('StateManager', () => {
  let stateManager;
  let mockFileService;
  let mockPathService;
  let mockLogger;

  beforeEach(() => {
    // Mock dependencies
    mockFileService = {
      readJson: vi.fn(),
      writeJson: vi.fn(),
    };

    mockPathService = {
      getMetadataPath: vi.fn((type) => `/metadata/${type}.json`),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    stateManager = new StateManager(mockFileService, mockPathService, mockLogger);

    // Clear all timers
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (stateManager.autoSaveTimer) {
      stateManager.stopAutoSave();
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    test('应该正确初始化状态', () => {
      expect(stateManager).toBeInstanceOf(EventEmitter);
      expect(stateManager.state.processedUrls).toBeInstanceOf(Set);
      expect(stateManager.state.failedUrls).toBeInstanceOf(Map);
      expect(stateManager.state.urlToIndex).toBeInstanceOf(Map);
      expect(stateManager.state.indexToUrl).toBeInstanceOf(Map);
      expect(stateManager.state.imageLoadFailures).toBeInstanceOf(Set);
      expect(stateManager.state.urlToFile).toBeInstanceOf(Map);
      expect(stateManager.state.startTime).toBeNull();
      expect(stateManager.state.lastSaveTime).toBeNull();
    });
  });

  describe('load', () => {
    test('应该成功加载状态数据', async () => {
      const mockProgress = {
        processedUrls: ['url1', 'url2'],
        failedUrls: [{ url: 'url3', error: 'Error' }],
        urlToIndex: { url1: 1, url2: 2 },
        startTime: '2024-03-15T10:00:00Z',
      };
      const mockImageFailures = [{ url: 'img1.jpg' }];
      const mockUrlMapping = { url1: { path: '/path1' } };

      mockFileService.readJson
        .mockResolvedValueOnce(mockProgress)
        .mockResolvedValueOnce(mockImageFailures)
        .mockResolvedValueOnce(mockUrlMapping);

      const loadedPromise = new Promise((resolve) => {
        stateManager.once('loaded', resolve);
      });

      await stateManager.load();

      expect(stateManager.state.processedUrls.has('url1')).toBe(true);
      expect(stateManager.state.processedUrls.has('url2')).toBe(true);
      expect(stateManager.state.failedUrls.get('url3')).toBe('Error');
      expect(stateManager.state.urlToIndex.get('url1')).toBe(1);
      expect(stateManager.state.indexToUrl.get(1)).toBe('url1');
      expect(stateManager.state.imageLoadFailures.has('img1.jpg')).toBe(true);
      expect(stateManager.state.urlToFile.get('url1')).toBe('/path1');
      expect(stateManager.state.startTime).toEqual(new Date('2024-03-15T10:00:00Z'));

      await loadedPromise;
    });

    test('应该在加载失败时发出load-error事件', async () => {
      const error = new Error('Read error');
      mockFileService.readJson.mockRejectedValue(error);

      const errorPromise = new Promise((resolve) => {
        stateManager.once('load-error', resolve);
      });

      await stateManager.load();

      const emittedError = await errorPromise;
      expect(emittedError).toBe(error);
      expect(mockLogger.warn).toHaveBeenCalledWith('状态加载失败，使用空状态', {
        error: 'Read error',
      });
    });

    test('应该处理空的状态数据', async () => {
      mockFileService.readJson
        .mockResolvedValueOnce({ processedUrls: [], failedUrls: [], urlToIndex: {} })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({});

      await stateManager.load();

      expect(stateManager.state.processedUrls.size).toBe(0);
      expect(stateManager.state.failedUrls.size).toBe(0);
      expect(stateManager.state.urlToIndex.size).toBe(0);
    });

    test('load时应修复 processed/failed 重叠并以失败优先', async () => {
      mockFileService.readJson
        .mockResolvedValueOnce({
          processedUrls: ['url-1', 'url-2'],
          failedUrls: [{ url: 'url-2', error: 'stale error' }],
          urlToIndex: { 'url-1': 1, 'url-2': 2 },
          startTime: null,
        })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({});

      await stateManager.load();

      expect(stateManager.state.processedUrls.has('url-1')).toBe(true);
      expect(stateManager.state.processedUrls.has('url-2')).toBe(false);
      expect(stateManager.state.failedUrls.get('url-2')).toBe('stale error');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '检测到状态重叠，按失败优先修复',
        expect.objectContaining({
          重叠数量: 1,
        })
      );
    });
  });

  describe('save', () => {
    test('应该保存状态到磁盘', async () => {
      // 设置一些状态
      stateManager.state.processedUrls.add('url1');
      stateManager.state.failedUrls.set('url2', 'Network error');
      stateManager.state.urlToIndex.set('url1', 1);
      stateManager.state.indexToUrl.set(1, 'url1');
      stateManager.state.imageLoadFailures.add('img1.jpg');
      stateManager.state.urlToFile.set('url1', '/path1');
      stateManager.state.startTime = new Date('2024-03-15T10:00:00Z');

      const savedPromise = new Promise((resolve) => {
        stateManager.once('saved', resolve);
      });

      await stateManager.save();

      // 验证进度数据保存
      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/metadata/progress.json',
        expect.objectContaining({
          processedUrls: ['url1'],
          failedUrls: [{ url: 'url2', error: 'Network error' }],
          urlToIndex: { url1: 1 },
          startTime: new Date('2024-03-15T10:00:00Z'),
          savedAt: expect.any(String),
          stats: expect.any(Object),
        })
      );

      // 验证图片失败记录保存
      expect(mockFileService.writeJson).toHaveBeenCalledWith('/metadata/imageLoadFailures.json', [
        { url: 'img1.jpg', timestamp: expect.any(String) },
      ]);

      // 验证URL映射保存
      expect(mockFileService.writeJson).toHaveBeenCalledWith('/metadata/urlMapping.json', {
        url1: { path: '/path1', timestamp: expect.any(String) },
      });

      await savedPromise;
      expect(stateManager.state.lastSaveTime).toBeDefined();
    });

    test('应该在5秒内不重复保存', async () => {
      await stateManager.save();
      mockFileService.writeJson.mockClear();

      await stateManager.save();

      expect(mockFileService.writeJson).not.toHaveBeenCalled();
    });

    test('应该在force=true时强制保存', async () => {
      await stateManager.save();
      mockFileService.writeJson.mockClear();

      await stateManager.save(true);

      expect(mockFileService.writeJson).toHaveBeenCalled();
    });

    test('save时应写出无重叠的processed/failed状态', async () => {
      stateManager.state.processedUrls.add('url-1');
      stateManager.state.failedUrls.set('url-1', 'error');

      await stateManager.save(true);

      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/metadata/progress.json',
        expect.objectContaining({
          processedUrls: [],
          failedUrls: [{ url: 'url-1', error: 'error' }],
        })
      );
    });

    test('应该处理保存错误', async () => {
      const error = new Error('Write error');
      mockFileService.writeJson.mockRejectedValue(error);

      const errorPromise = new Promise((resolve) => {
        stateManager.once('save-error', resolve);
      });

      await stateManager.save();

      const emittedError = await errorPromise;
      expect(emittedError).toBe(error);
      expect(mockLogger.error).toHaveBeenCalledWith('状态保存失败', { error: 'Write error' });
    });
  });

  describe('自动保存', () => {
    test('startAutoSave应该启动定时器', () => {
      stateManager.startAutoSave();

      expect(stateManager.autoSaveTimer).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith('启动自动保存', { 间隔: '30秒' });
    });

    test('应该定期自动保存', async () => {
      const saveSpy = vi.spyOn(stateManager, 'save').mockResolvedValue();

      stateManager.startAutoSave();

      // 快进30秒
      vi.advanceTimersByTime(30000);

      expect(saveSpy).toHaveBeenCalled();
    });

    test('不应该重复启动自动保存', () => {
      stateManager.startAutoSave();
      const firstTimer = stateManager.autoSaveTimer;

      stateManager.startAutoSave();

      expect(stateManager.autoSaveTimer).toBe(firstTimer);
    });

    test('stopAutoSave应该停止定时器', () => {
      stateManager.startAutoSave();
      stateManager.stopAutoSave();

      expect(stateManager.autoSaveTimer).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('停止自动保存');
    });

    test('应该处理自动保存错误', async () => {
      const saveSpy = vi.spyOn(stateManager, 'save').mockRejectedValue(new Error('Save error'));

      stateManager.startAutoSave();
      vi.advanceTimersByTime(30000);

      // 等待异步操作
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith('自动保存失败', { error: 'Save error' });
    });
  });

  describe('URL管理', () => {
    test('setUrlIndex应该设置双向映射', () => {
      stateManager.setUrlIndex('http://example.com', 5);

      expect(stateManager.state.urlToIndex.get('http://example.com')).toBe(5);
      expect(stateManager.state.indexToUrl.get(5)).toBe('http://example.com');
    });

    test('isProcessed应该检查URL是否已处理', () => {
      stateManager.state.processedUrls.add('http://example.com');

      expect(stateManager.isProcessed('http://example.com')).toBe(true);
      expect(stateManager.isProcessed('http://other.com')).toBe(false);
    });

    test('markProcessed应该标记URL为已处理', () => {
      const processedPromise = new Promise((resolve) => {
        stateManager.once('url-processed', resolve);
      });

      stateManager.markProcessed('http://example.com', '/path/to/file.pdf');

      expect(stateManager.state.processedUrls.has('http://example.com')).toBe(true);
      expect(stateManager.state.urlToFile.get('http://example.com')).toBe('/path/to/file.pdf');

      return processedPromise.then((event) => {
        expect(event).toEqual({
          url: 'http://example.com',
          total: 1,
        });
      });
    });

    test('markProcessed应该从失败列表中移除URL', () => {
      stateManager.state.failedUrls.set('http://example.com', 'Previous error');

      stateManager.markProcessed('http://example.com');

      expect(stateManager.state.failedUrls.has('http://example.com')).toBe(false);
    });

    test('markFailed应该标记URL为失败', () => {
      const failedPromise = new Promise((resolve) => {
        stateManager.once('url-failed', resolve);
      });

      const error = new Error('Network error');
      stateManager.markFailed('http://example.com', error);

      expect(stateManager.state.failedUrls.get('http://example.com')).toBe('Network error');

      return failedPromise.then((event) => {
        expect(event).toEqual({
          url: 'http://example.com',
          error: 'Network error',
        });
      });
    });

    test('markFailed should remove URL from processed set to avoid negative pending', () => {
      stateManager.markProcessed('url-1');
      stateManager.markFailed('url-1', new Error('x'));

      const stats = stateManager.getStats();
      expect(stats.processed).toBe(0);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBeGreaterThanOrEqual(0);
    });

    test('getFailedUrls应该返回失败URL列表', () => {
      stateManager.state.failedUrls.set('url1', 'Error 1');
      stateManager.state.failedUrls.set('url2', 'Error 2');

      const failed = stateManager.getFailedUrls();

      expect(failed).toEqual([
        ['url1', 'Error 1'],
        ['url2', 'Error 2'],
      ]);
    });

    test('clearFailure应该清除失败记录', () => {
      stateManager.state.failedUrls.set('http://example.com', 'Error');
      stateManager.state.processedUrls.add('http://example.com');

      stateManager.clearFailure('http://example.com');

      expect(stateManager.state.failedUrls.has('http://example.com')).toBe(false);
      expect(stateManager.state.processedUrls.has('http://example.com')).toBe(false);
    });
  });

  describe('图片加载失败管理', () => {
    test('markImageLoadFailure应该记录失败', () => {
      const failurePromise = new Promise((resolve) => {
        stateManager.once('image-load-failure', resolve);
      });

      stateManager.markImageLoadFailure('http://example.com/image.jpg');

      expect(stateManager.state.imageLoadFailures.has('http://example.com/image.jpg')).toBe(true);

      return failurePromise.then((event) => {
        expect(event).toEqual({
          url: 'http://example.com/image.jpg',
        });
      });
    });
  });

  describe('统计信息', () => {
    test('getStats应该返回正确的统计信息', () => {
      // 设置测试数据
      stateManager.state.urlToIndex.set('url1', 1);
      stateManager.state.urlToIndex.set('url2', 2);
      stateManager.state.urlToIndex.set('url3', 3);
      stateManager.state.processedUrls.add('url1');
      stateManager.state.processedUrls.add('url2');
      stateManager.state.failedUrls.set('url3', 'Error');
      stateManager.state.imageLoadFailures.add('img1');
      stateManager.state.startTime = Date.now() - 60000; // 1分钟前

      const stats = stateManager.getStats();

      expect(stats).toEqual({
        total: 3,
        processed: 2,
        failed: 1,
        pending: 0,
        imageLoadFailures: 1,
        successRate: '66.67',
        startTime: stateManager.state.startTime,
        elapsed: expect.any(Number),
      });
      expect(stats.elapsed).toBeGreaterThan(0);
    });

    test('应该处理空状态的统计', () => {
      const stats = stateManager.getStats();

      expect(stats).toEqual({
        total: 0,
        processed: 0,
        failed: 0,
        pending: 0,
        imageLoadFailures: 0,
        successRate: 0,
        startTime: null,
        elapsed: 0,
      });
    });
  });

  describe('reset', () => {
    test('应该重置所有状态', () => {
      // 添加一些数据
      stateManager.state.processedUrls.add('url1');
      stateManager.state.failedUrls.set('url2', 'Error');
      stateManager.state.urlToIndex.set('url1', 1);
      stateManager.state.indexToUrl.set(1, 'url1');
      stateManager.state.imageLoadFailures.add('img1');
      stateManager.state.urlToFile.set('url1', '/path');
      stateManager.state.startTime = Date.now();
      stateManager.state.lastSaveTime = Date.now();

      const resetPromise = new Promise((resolve) => {
        stateManager.once('reset', resolve);
      });

      stateManager.reset();

      expect(stateManager.state.processedUrls.size).toBe(0);
      expect(stateManager.state.failedUrls.size).toBe(0);
      expect(stateManager.state.urlToIndex.size).toBe(0);
      expect(stateManager.state.indexToUrl.size).toBe(0);
      expect(stateManager.state.imageLoadFailures.size).toBe(0);
      expect(stateManager.state.urlToFile.size).toBe(0);
      expect(stateManager.state.startTime).toBeNull();
      expect(stateManager.state.lastSaveTime).toBeNull();

      return resetPromise;
    });
  });

  describe('setStartTime', () => {
    test('应该设置开始时间', () => {
      const before = Date.now();
      stateManager.setStartTime();
      const after = Date.now();

      expect(stateManager.state.startTime).toBeGreaterThanOrEqual(before);
      expect(stateManager.state.startTime).toBeLessThanOrEqual(after);
    });
  });

  describe('exportReport', () => {
    test('应该导出完整报告', async () => {
      // 设置测试数据
      stateManager.state.processedUrls.add('url1');
      stateManager.state.failedUrls.set('url2', 'Error');
      stateManager.state.imageLoadFailures.add('img1');
      stateManager.state.urlToFile.set('url1', '/path1');

      const report = await stateManager.exportReport('/reports/test.json');

      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/reports/test.json',
        expect.objectContaining({
          summary: expect.any(Object),
          failedUrls: [{ url: 'url2', error: 'Error' }],
          imageLoadFailures: ['img1'],
          processedFiles: [{ url: 'url1', path: '/path1' }],
          generatedAt: expect.any(String),
        })
      );

      expect(report.summary).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith('导出状态报告', { path: '/reports/test.json' });
    });
  });
});
