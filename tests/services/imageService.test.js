import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { ImageService } from '../../src/services/imageService.js';

describe('ImageService', () => {
  let imageService;
  let mockLogger;
  let mockPage;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockPage = {
      url: vi.fn().mockReturnValue('https://example.com'),
      evaluateOnNewDocument: vi.fn(),
      evaluate: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    };

    imageService = new ImageService({
      logger: mockLogger,
      defaultTimeout: 5000,
      checkInterval: 100,
      scrollDistance: 300,
      scrollDelay: 50,
      maxScrollAttempts: 2,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const service = new ImageService();

      expect(service.options.defaultTimeout).toBe(15000);
      expect(service.options.checkInterval).toBe(500);
      expect(service.options.scrollDistance).toBe(300);
      expect(service.options.scrollDelay).toBe(200);
      expect(service.options.maxScrollAttempts).toBe(3);
      expect(service.options.enableIntersectionObserver).toBe(true);
      expect(service.options.observerRootMargin).toBe('500px');
    });

    it('should accept custom options', () => {
      expect(imageService.options.defaultTimeout).toBe(5000);
      expect(imageService.options.checkInterval).toBe(100);
      expect(imageService.logger).toBe(mockLogger);
    });

    it('should initialize stats', () => {
      expect(imageService.stats).toEqual({
        imagesProcessed: 0,
        imagesLoaded: 0,
        imagesFailed: 0,
        lazyImagesTriggered: 0,
        scrollOperations: 0,
        totalLoadTime: 0,
      });
    });
  });

  describe('setupImageObserver', () => {
    it('should setup image observer on page', async () => {
      await imageService.setupImageObserver(mockPage);

      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), {
        observerRootMargin: '500px',
        enableIntersectionObserver: true,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith('图片观察器设置完成');
    });

    it('should emit observer-setup event', async () => {
      const listener = vi.fn();
      imageService.on('observer-setup', listener);

      await imageService.setupImageObserver(mockPage);

      expect(listener).toHaveBeenCalledWith({ pageUrl: 'https://example.com' });
    });

    it('should handle setup errors', async () => {
      mockPage.evaluateOnNewDocument.mockRejectedValue(new Error('Setup failed'));

      await expect(imageService.setupImageObserver(mockPage)).rejects.toThrow('Setup failed');

      expect(mockLogger.error).toHaveBeenCalledWith('设置图片观察器失败', {
        error: 'Setup failed',
      });
    });
  });

  describe('waitForImages', () => {
    beforeEach(() => {
      // Setup evaluateOnNewDocument to work
      mockPage.evaluateOnNewDocument.mockResolvedValue();
    });

    it('should wait for images to load successfully', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce({
          total: 3,
          loaded: 1,
          failed: 0,
          pending: 2,
          stats: { loaded: 1, failed: 0 },
          allLoaded: false,
        })
        .mockResolvedValueOnce({
          total: 3,
          loaded: 2,
          failed: 0,
          pending: 1,
          stats: { loaded: 2, failed: 0 },
          allLoaded: false,
        })
        .mockResolvedValueOnce({
          total: 3,
          loaded: 3,
          failed: 0,
          pending: 0,
          stats: { loaded: 3, failed: 0 },
          allLoaded: true,
        });

      const result = await imageService.waitForImages(mockPage);

      expect(result).toBe(true);
      expect(imageService.stats.imagesProcessed).toBe(3);
      expect(imageService.stats.imagesLoaded).toBe(3);
      expect(imageService.stats.imagesFailed).toBe(0);
      expect(mockLogger.debug).toHaveBeenCalledWith('所有图片加载完成', expect.any(Object));
    });

    it('should handle images with failures', async () => {
      mockPage.evaluate.mockResolvedValue({
        total: 3,
        loaded: 2,
        failed: 1,
        pending: 0,
        stats: { loaded: 2, failed: 1 },
        allLoaded: true,
      });

      const result = await imageService.waitForImages(mockPage);

      expect(result).toBe(true);
      expect(imageService.stats.imagesLoaded).toBe(2);
      expect(imageService.stats.imagesFailed).toBe(1);
    });

    it('should timeout if images dont load', async () => {
      mockPage.evaluate.mockResolvedValue({
        total: 3,
        loaded: 1,
        failed: 0,
        pending: 2,
        stats: { loaded: 1, failed: 0 },
        allLoaded: false,
      });

      const result = await imageService.waitForImages(mockPage, { defaultTimeout: 200 });

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('图片加载超时', expect.any(Object));
    });

    it('should emit progress events', async () => {
      const progressListener = vi.fn();
      imageService.on('images-progress', progressListener);

      mockPage.evaluate.mockResolvedValue({
        total: 2,
        loaded: 2,
        failed: 0,
        pending: 0,
        stats: { loaded: 2, failed: 0 },
        allLoaded: true,
      });

      await imageService.waitForImages(mockPage);

      expect(progressListener).toHaveBeenCalledWith(
        expect.objectContaining({
          total: 2,
          loaded: 2,
          elapsedTime: expect.any(Number),
        })
      );
    });

    it('should stop waiting when image count stabilizes', async () => {
      mockPage.evaluate.mockResolvedValue({
        total: 3,
        loaded: 2,
        failed: 0,
        pending: 1,
        stats: { loaded: 2, failed: 0 },
        allLoaded: false,
      });

      const result = await imageService.waitForImages(mockPage, {
        defaultTimeout: 5000,
        checkInterval: 50,
      });

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('图片数量已稳定，停止等待新图片');
    });

    it('should handle evaluation errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Evaluation failed'));

      const result = await imageService.waitForImages(mockPage);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('等待图片加载时发生错误', {
        error: 'Evaluation failed',
      });
    });
  });

  describe('scrollPage', () => {
    it('should scroll page successfully', async () => {
      const scrollResult = {
        totalHeight: 2000,
        viewportHeight: 800,
        scrollSteps: [
          { position: 0, duration: 50 },
          { position: 300, duration: 50 },
          { position: 600, duration: 50 },
        ],
      };

      mockPage.evaluate.mockResolvedValue(scrollResult);

      const result = await imageService.scrollPage(mockPage);

      expect(result).toBe(scrollResult);
      expect(imageService.stats.scrollOperations).toBe(1);
      expect(mockLogger.debug).toHaveBeenCalledWith('页面滚动完成', expect.any(Object));
    });

    it('should emit scroll-complete event', async () => {
      const listener = vi.fn();
      imageService.on('scroll-complete', listener);

      mockPage.evaluate.mockResolvedValue({
        totalHeight: 1000,
        viewportHeight: 500,
        scrollSteps: [],
      });

      await imageService.scrollPage(mockPage);

      expect(listener).toHaveBeenCalled();
    });

    it('should handle scroll errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Scroll failed'));

      await expect(imageService.scrollPage(mockPage)).rejects.toThrow('Scroll failed');

      expect(mockLogger.error).toHaveBeenCalledWith('滚动页面时发生错误', {
        error: 'Scroll failed',
      });
    });
  });

  describe('triggerLazyLoading', () => {
    beforeEach(() => {
      // Mock scrollPage and waitForImages
      vi.spyOn(imageService, 'scrollPage').mockResolvedValue({
        totalHeight: 2000,
        scrollSteps: [],
      });

      vi.spyOn(imageService, 'waitForImages').mockResolvedValue(true);
    });

    it('should trigger lazy loading successfully', async () => {
      mockPage.evaluate.mockResolvedValue({
        totalLazyImages: 5,
        triggered: 5,
      });

      const result = await imageService.triggerLazyLoading(mockPage);

      expect(result).toMatchObject({
        totalLazyImages: 5,
        triggered: 5,
        allImagesLoaded: true,
      });
      expect(imageService.stats.lazyImagesTriggered).toBe(5);
      expect(imageService.scrollPage).toHaveBeenCalled();
      expect(imageService.waitForImages).toHaveBeenCalled();
    });

    it('should emit lazy-loading-triggered event', async () => {
      const listener = vi.fn();
      imageService.on('lazy-loading-triggered', listener);

      mockPage.evaluate.mockResolvedValue({
        totalLazyImages: 3,
        triggered: 3,
      });

      await imageService.triggerLazyLoading(mockPage);

      expect(listener).toHaveBeenCalledWith({
        totalLazyImages: 3,
        triggered: 3,
      });
    });

    it('should handle trigger errors', async () => {
      imageService.scrollPage.mockRejectedValue(new Error('Scroll failed'));

      await expect(imageService.triggerLazyLoading(mockPage)).rejects.toThrow('Scroll failed');

      expect(mockLogger.error).toHaveBeenCalledWith('触发懒加载时发生错误', {
        error: 'Scroll failed',
      });
    });
  });

  describe('processPageImages', () => {
    beforeEach(() => {
      vi.spyOn(imageService, 'setupImageObserver').mockResolvedValue();
      vi.spyOn(imageService, 'waitForImages').mockResolvedValue(true);
      vi.spyOn(imageService, 'triggerLazyLoading').mockResolvedValue({
        totalLazyImages: 3,
        triggered: 3,
        allImagesLoaded: true,
      });
      vi.spyOn(imageService, 'scrollPage').mockResolvedValue({});
    });

    it('should process page images successfully', async () => {
      const result = await imageService.processPageImages(mockPage);

      expect(result).toMatchObject({
        success: true,
        allImagesLoaded: true,
        lazyImagesTriggered: 3,
      });
      expect(imageService.setupImageObserver).toHaveBeenCalledWith(mockPage);
      expect(imageService.triggerLazyLoading).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('页面图片处理完成', expect.any(Object));
    });

    it('should retry if images dont load', async () => {
      // Override the triggerLazyLoading mock for this test
      imageService.triggerLazyLoading.mockResolvedValueOnce({
        totalLazyImages: 3,
        triggered: 3,
        allImagesLoaded: false, // This triggers the retry logic
      });

      imageService.waitForImages
        .mockResolvedValueOnce(true) // Initial wait
        .mockResolvedValueOnce(false) // First retry
        .mockResolvedValueOnce(true); // Second retry

      const result = await imageService.processPageImages(mockPage);

      expect(result.attempts).toBe(2);
      expect(result.allImagesLoaded).toBe(true);
      expect(imageService.scrollPage).toHaveBeenCalledTimes(2);
    });

    it('should handle processing errors', async () => {
      imageService.setupImageObserver.mockRejectedValue(new Error('Setup failed'));

      const result = await imageService.processPageImages(mockPage);

      expect(result).toMatchObject({
        success: false,
        error: 'Setup failed',
      });
      expect(mockLogger.error).toHaveBeenCalledWith('页面图片处理失败', expect.any(Object));
    });

    it('should emit page-images-complete event', async () => {
      const listener = vi.fn();
      imageService.on('page-images-complete', listener);

      await imageService.processPageImages(mockPage);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });

  describe('cleanup', () => {
    it('should perform global cleanup when no page provided', async () => {
      vi.spyOn(imageService, 'dispose').mockResolvedValue();

      await imageService.cleanup();

      expect(imageService.dispose).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('无页面参数，执行全局清理');
    });

    it('should skip cleanup if page is closed', async () => {
      mockPage.isClosed.mockReturnValue(true);

      await imageService.cleanup(mockPage);

      expect(mockLogger.debug).toHaveBeenCalledWith('页面已关闭，跳过页面相关的清理操作');
    });

    it('should cleanup page if valid', async () => {
      vi.spyOn(imageService, 'cleanupPage').mockResolvedValue(true);

      await imageService.cleanup(mockPage);

      expect(imageService.cleanupPage).toHaveBeenCalledWith(mockPage);
    });

    it('should handle cleanup errors', async () => {
      vi.spyOn(imageService, 'cleanupPage').mockRejectedValue(new Error('Cleanup failed'));

      await imageService.cleanup(mockPage);

      expect(mockLogger.warn).toHaveBeenCalledWith('清理图片服务资源时发生错误', {
        error: 'Cleanup failed',
      });
    });
  });

  describe('cleanupPage', () => {
    it('should cleanup page resources', async () => {
      mockPage.evaluate.mockResolvedValue();

      const result = await imageService.cleanupPage(mockPage);

      expect(result).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(mockLogger.debug).toHaveBeenCalledWith('图片服务页面清理完成');
    });

    it('should handle closed pages', async () => {
      mockPage.isClosed.mockReturnValue(true);

      const result = await imageService.cleanupPage(mockPage);

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith('页面无效或已关闭，跳过页面清理');
    });

    it('should handle cleanup errors gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Page closed'));

      const result = await imageService.cleanupPage(mockPage);

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith('页面清理失败（可能页面已关闭）', {
        error: 'Page closed',
      });
    });
  });

  describe('dispose', () => {
    it('should dispose service resources', async () => {
      vi.spyOn(imageService, 'resetStats');
      vi.spyOn(imageService, 'removeAllListeners');

      await imageService.dispose();

      expect(imageService.resetStats).toHaveBeenCalled();
      expect(imageService.removeAllListeners).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('图片服务全局清理完成');
    });

    it('should emit dispose-complete event', async () => {
      const listener = vi.fn();
      imageService.on('dispose-complete', listener);

      await imageService.dispose();

      expect(listener).toHaveBeenCalled();
    });

    it('should handle dispose errors', async () => {
      vi.spyOn(imageService, 'removeAllListeners').mockImplementation(() => {
        throw new Error('Dispose failed');
      });

      await imageService.dispose();

      expect(mockLogger.error).toHaveBeenCalledWith('图片服务全局清理失败', {
        error: 'Dispose failed',
      });
    });
  });

  describe('getStats', () => {
    it('should return current stats with average load time', () => {
      imageService.stats = {
        imagesProcessed: 10,
        imagesLoaded: 8,
        imagesFailed: 2,
        lazyImagesTriggered: 5,
        scrollOperations: 3,
        totalLoadTime: 1000,
      };

      const stats = imageService.getStats();

      expect(stats).toMatchObject({
        imagesProcessed: 10,
        imagesLoaded: 8,
        imagesFailed: 2,
        averageLoadTime: 100,
      });
    });

    it('should handle zero images processed', () => {
      const stats = imageService.getStats();

      expect(stats.averageLoadTime).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', () => {
      imageService.stats.imagesProcessed = 10;
      imageService.stats.imagesLoaded = 8;

      imageService.resetStats();

      expect(imageService.stats).toEqual({
        imagesProcessed: 0,
        imagesLoaded: 0,
        imagesFailed: 0,
        lazyImagesTriggered: 0,
        scrollOperations: 0,
        totalLoadTime: 0,
      });
    });

    it('should emit stats-reset event', () => {
      const listener = vi.fn();
      imageService.on('stats-reset', listener);

      imageService.resetStats();

      expect(listener).toHaveBeenCalled();
    });
  });
});
