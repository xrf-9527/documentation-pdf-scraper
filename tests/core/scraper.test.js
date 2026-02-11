import { jest } from '@jest/globals';
import { Scraper } from '../../src/core/scraper.js';
import { NetworkError, ValidationError } from '../../src/utils/errors.js';
import { EventEmitter } from 'events';

describe('Scraper', () => {
  let scraper;
  let mockDependencies;
  let mockPage;

  beforeEach(() => {
    mockPage = {
      goto: jest.fn(),
      evaluate: jest.fn(),
      waitForSelector: jest.fn(),
      pdf: jest.fn(),
      close: jest.fn(),
    };

    mockDependencies = {
      config: {
        rootURL: 'https://example.com',
        navLinksSelector: 'a',
        contentSelector: '.content',
        allowedDomains: ['example.com'],
        sectionEntryPoints: [],
        concurrency: 3,
        pdfDir: './pdfs',
        maxRetries: 3,
        pageTimeout: 30000,
        pdf: { engine: 'puppeteer' },
      },
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      browserPool: {
        isInitialized: false,
        initialize: jest.fn(),
        close: jest.fn(),
      },
      pageManager: {
        createPage: jest.fn().mockResolvedValue(mockPage),
        closePage: jest.fn(),
        closeAll: jest.fn(),
      },
      fileService: {
        ensureDirectory: jest.fn(),
      },
      pathService: {
        getPdfPath: jest.fn().mockReturnValue('./pdfs/001-page.pdf'),
      },
      metadataService: {
        saveArticleTitle: jest.fn(),
        logImageLoadFailure: jest.fn(),
        logFailedLink: jest.fn(),
        saveSectionStructure: jest.fn(),
      },
      stateManager: {
        on: jest.fn(),
        load: jest.fn(),
        save: jest.fn(),
        isProcessed: jest.fn().mockReturnValue(false),
        markProcessed: jest.fn(),
        markFailed: jest.fn(),
        setUrlIndex: jest.fn(),
        getFailedUrls: jest.fn().mockReturnValue([]),
        state: {
          processedUrls: new Set(),
          failedUrls: new Map(),
        },
      },
      progressTracker: {
        on: jest.fn(),
        start: jest.fn(),
        skip: jest.fn(),
        success: jest.fn(),
        failure: jest.fn(),
        finish: jest.fn(),
        getStats: jest.fn().mockReturnValue({
          processed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
        }),
      },
      queueManager: {
        on: jest.fn(),
        setConcurrency: jest.fn(),
        addTask: jest.fn(),
        waitForIdle: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        clear: jest.fn(),
        getStatus: jest.fn().mockReturnValue({
          pending: 0,
          active: 0,
          completed: 0,
          failed: 0,
        }),
      },
      imageService: {
        setupImageObserver: jest.fn(),
        triggerLazyLoading: jest.fn().mockResolvedValue(true),
        cleanupPage: jest.fn(),
      },
      pdfStyleService: {
        applyPDFStyles: jest.fn(),
        processSpecialContent: jest.fn(),
        removeDarkTheme: jest.fn(),
        getPDFOptions: jest.fn().mockReturnValue({
          format: 'A4',
          printBackground: true,
        }),
      },
    };

    scraper = new Scraper(mockDependencies);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(scraper.config).toBe(mockDependencies.config);
      expect(scraper.logger).toBe(mockDependencies.logger);
      expect(scraper.isInitialized).toBe(false);
      expect(scraper.isRunning).toBe(false);
    });

    it('should bind event handlers', () => {
      expect(mockDependencies.stateManager.on).toHaveBeenCalledWith(
        'stateLoaded',
        expect.any(Function)
      );
      expect(mockDependencies.progressTracker.on).toHaveBeenCalledWith(
        'progress',
        expect.any(Function)
      );
      expect(mockDependencies.queueManager.on).toHaveBeenCalledWith(
        'taskCompleted',
        expect.any(Function)
      );
      expect(mockDependencies.queueManager.on).toHaveBeenCalledWith(
        'taskFailed',
        expect.any(Function)
      );
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await scraper.initialize();

      expect(mockDependencies.browserPool.initialize).toHaveBeenCalled();
      expect(mockDependencies.stateManager.load).toHaveBeenCalled();
      expect(mockDependencies.queueManager.setConcurrency).toHaveBeenCalledWith(3);
      expect(mockDependencies.fileService.ensureDirectory).toHaveBeenCalledWith('./pdfs');
      expect(mockDependencies.fileService.ensureDirectory).toHaveBeenCalledWith('pdfs/metadata');
      expect(scraper.isInitialized).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      scraper.isInitialized = true;
      await scraper.initialize();

      expect(mockDependencies.browserPool.initialize).not.toHaveBeenCalled();
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith('爬虫已经初始化');
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Init failed');
      mockDependencies.browserPool.initialize.mockRejectedValue(error);

      await expect(scraper.initialize()).rejects.toThrow(error);
      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        '爬虫初始化失败',
        expect.any(Object)
      );
    });
  });

  describe('collectUrls', () => {
    beforeEach(async () => {
      scraper.isInitialized = true;
      mockPage.goto.mockResolvedValue();
      mockPage.waitForSelector.mockResolvedValue();
    });

    it('should collect URLs successfully', async () => {
      mockPage.evaluate.mockResolvedValue([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page1', // duplicate
        '#anchor', // invalid
        'javascript:void(0)', // invalid
      ]);

      const urls = await scraper.collectUrls();

      expect(urls).toHaveLength(3);
      expect(urls).toContain('https://example.com/');
      expect(urls).toContain('https://example.com/page1');
      expect(urls).toContain('https://example.com/page2');
      expect(mockDependencies.pageManager.createPage).toHaveBeenCalledWith('url-collector');
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    });

    it('should throw if not initialized', async () => {
      scraper.isInitialized = false;
      await expect(scraper.collectUrls()).rejects.toThrow(ValidationError);
    });

    it('should handle navigation errors', async () => {
      const navError = new Error('Navigation failed');
      mockPage.goto.mockRejectedValue(navError);

      const urls = await scraper.collectUrls();
      expect(urls).toEqual([]);
      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        '入口URL收集失败，将跳过该入口',
        expect.objectContaining({
          entryUrl: 'https://example.com',
          error: 'Navigation failed',
        })
      );
    }, 30000);

    it('should clean up resources on error', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Evaluation failed'));

      const urls = await scraper.collectUrls();
      expect(urls).toEqual([]);
      expect(mockDependencies.imageService.cleanupPage).toHaveBeenCalledWith(mockPage);
      expect(mockDependencies.pageManager.closePage).toHaveBeenCalledWith('url-collector');
    });
  });

  describe('_collectUrlsFromEntryPoint', () => {
    beforeEach(() => {
      mockPage.goto.mockResolvedValue({ status: () => 200 });
      mockPage.waitForSelector.mockResolvedValue();
    });

    it('should filter other entry points (ignore hash/query) and non-http(s) URLs', async () => {
      scraper.config.navExcludeSelector = '.nav-tabs';

      const getEntryPointsSpy = jest.spyOn(scraper, '_getEntryPoints');

      mockPage.evaluate.mockResolvedValue([
        'https://example.com/page1',
        'https://example.com/section2',
        'https://example.com/section2#hash',
        'https://example.com/section2?utm=1',
        'mailto:test@example.com',
        'tel:+123',
        '#anchor',
        'javascript:void(0)',
      ]);

      const urls = await scraper._collectUrlsFromEntryPoint(
        mockPage,
        'https://example.com/section1',
        ['https://example.com/section1', 'https://example.com/section2']
      );

      expect(getEntryPointsSpy).not.toHaveBeenCalled();
      expect(urls).toEqual(['https://example.com/section1', 'https://example.com/page1']);
    });
  });

  describe('validateUrl', () => {
    it('should accept valid URLs', () => {
      expect(scraper.validateUrl('https://example.com/page')).toBe(true);
      expect(scraper.validateUrl('http://example.com/page')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(scraper.validateUrl('invalid-url')).toBe(false);
      expect(scraper.validateUrl('ftp://example.com')).toBe(false);
      expect(scraper.validateUrl('')).toBe(false);
    });

    it('should check allowed domains', () => {
      expect(scraper.validateUrl('https://other.com')).toBe(false);
      expect(scraper.validateUrl('https://example.com')).toBe(true);
      expect(scraper.validateUrl('https://sub.example.com')).toBe(true);
      expect(scraper.validateUrl('https://test.sub.example.com')).toBe(true);
    });

    it('should filter by baseUrl if configured', () => {
      scraper.config.baseUrl = 'https://example.com/docs';
      expect(scraper.validateUrl('https://example.com/docs/page')).toBe(true);
      expect(scraper.validateUrl('https://example.com/other/page')).toBe(false);
    });
  });

  describe('isIgnored', () => {
    it('should check ignored patterns', () => {
      scraper.config.ignoreURLs = ['/admin', /\.pdf$/];

      expect(scraper.isIgnored('https://example.com/admin/page')).toBe(true);
      expect(scraper.isIgnored('https://example.com/file.pdf')).toBe(true);
      expect(scraper.isIgnored('https://example.com/normal/page')).toBe(false);
    });

    it('should handle missing ignoreURLs config', () => {
      scraper.config.ignoreURLs = null;
      expect(scraper.isIgnored('any-url')).toBe(false);
    });
  });

  describe('scrapePage', () => {
    const testUrl = 'https://example.com/page1';
    const testIndex = 0;

    beforeEach(() => {
      mockPage.goto.mockResolvedValue({ status: () => 200, statusText: () => 'OK' });
      mockPage.waitForSelector.mockResolvedValue();
      mockPage.evaluate.mockResolvedValue({ title: 'Page Title', source: 'document.title' });
    });

    it('should scrape page successfully with Puppeteer', async () => {
      scraper.config.enablePDFStyleProcessing = true;
      const result = await scraper.scrapePage(testUrl, testIndex);

      expect(result).toEqual({
        status: 'success',
        title: 'Page Title',
        outputPath: './pdfs/001-page.pdf',
        isBatchMode: false,
        imagesLoaded: true,
      });

      expect(mockDependencies.pageManager.createPage).toHaveBeenCalledWith('scraper-page-0');
      expect(mockDependencies.imageService.setupImageObserver).toHaveBeenCalledWith(mockPage);
      expect(mockDependencies.pdfStyleService.applyPDFStyles).toHaveBeenCalledWith(
        mockPage,
        '.content'
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          path: './pdfs/001-page.pdf',
          format: 'A4',
          printBackground: true,
        })
      );
      expect(mockDependencies.stateManager.markProcessed).toHaveBeenCalledWith(
        testUrl,
        './pdfs/001-page.pdf'
      );
      expect(mockDependencies.metadataService.saveArticleTitle).toHaveBeenCalledWith(
        '0',
        'Page Title'
      );
    });

    it('should skip already processed pages', async () => {
      mockDependencies.stateManager.isProcessed.mockReturnValue(true);

      const result = await scraper.scrapePage(testUrl, testIndex);

      expect(result).toEqual({
        status: 'skipped',
        reason: 'already_processed',
      });
      expect(mockDependencies.progressTracker.skip).toHaveBeenCalledWith(testUrl);
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should handle page navigation errors', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      await expect(scraper.scrapePage(testUrl, testIndex)).rejects.toThrow(NetworkError);
      expect(mockDependencies.stateManager.markFailed).toHaveBeenCalledWith(
        testUrl,
        expect.any(Error)
      );
      expect(mockDependencies.progressTracker.failure).toHaveBeenCalledWith(
        testUrl,
        expect.any(Error)
      );
    });

    it('should handle content not found', async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error('Timeout'));

      await expect(scraper.scrapePage(testUrl, testIndex)).rejects.toThrow(NetworkError);
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith(
        '内容选择器等待超时',
        expect.any(Object)
      );
    });

    it('should clean up resources on error', async () => {
      mockPage.pdf.mockRejectedValue(new Error('PDF generation failed'));

      await expect(scraper.scrapePage(testUrl, testIndex)).rejects.toThrow();
      expect(mockDependencies.imageService.cleanupPage).toHaveBeenCalledWith(mockPage);
      expect(mockDependencies.pageManager.closePage).toHaveBeenCalledWith('scraper-page-0');
    });

    it('should not mark URL success before title persistence succeeds', async () => {
      mockDependencies.metadataService.saveArticleTitle.mockRejectedValueOnce(new Error('write fail'));

      await expect(scraper.scrapePage('https://example.com/page1', 0)).rejects.toThrow(NetworkError);

      expect(mockDependencies.stateManager.markProcessed).not.toHaveBeenCalled();
      expect(mockDependencies.progressTracker.success).not.toHaveBeenCalled();
      expect(mockDependencies.progressTracker.failure).toHaveBeenCalled();
    });

    it('should mark first-pass failure as pending-retry when retries are enabled', async () => {
      const err = new Error('boom');
      mockPage.goto.mockRejectedValue(err);
      scraper.config.retryFailedUrls = true;

      await expect(
        scraper.scrapePage('https://example.com/page1', 0, { isRetry: false })
      ).rejects.toThrow();

      expect(mockDependencies.progressTracker.failure).toHaveBeenCalledWith(
        'https://example.com/page1',
        expect.any(Error),
        true
      );
    });

    it('should save state periodically', async () => {
      mockDependencies.progressTracker.getStats.mockReturnValue({ processed: 10 });

      await scraper.scrapePage(testUrl, testIndex);

      expect(mockDependencies.stateManager.save).toHaveBeenCalled();
    });
  });

  describe('navigateWithFallback', () => {
    it('should try multiple navigation strategies', async () => {
      mockPage.goto
        .mockRejectedValueOnce(new Error('Navigation timeout'))
        .mockResolvedValueOnce({ status: () => 200, statusText: () => 'OK' });

      const result = await scraper.navigateWithFallback(mockPage, 'https://example.com');

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('networkidle2');
      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });

    it('should handle all strategies failing', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      const result = await scraper.navigateWithFallback(mockPage, 'https://example.com');

      expect(result.success).toBe(false);
      expect(mockPage.goto).toHaveBeenCalledTimes(4);
    });
  });

  describe('retryFailedUrls', () => {
    it('should retry failed URLs', async () => {
      const failedUrls = [
        ['https://example.com/failed1', { message: 'Error 1' }],
        ['https://example.com/failed2', { message: 'Error 2' }],
      ];
      mockDependencies.stateManager.getFailedUrls.mockReturnValue(failedUrls);
      scraper.urlQueue = ['https://example.com/failed1'];

      mockPage.goto.mockResolvedValue({ status: () => 200 });
      mockPage.evaluate.mockResolvedValue({ title: 'Title', source: 'document.title' });

      await scraper.retryFailedUrls();

      expect(mockDependencies.logger.info).toHaveBeenCalledWith('开始重试 2 个失败的URL');
      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        '重试完成',
        expect.objectContaining({
          成功: expect.any(Number),
          失败: expect.any(Number),
        })
      );
    });

    it('should handle no failed URLs', async () => {
      mockDependencies.stateManager.getFailedUrls.mockReturnValue([]);

      await scraper.retryFailedUrls();

      expect(mockDependencies.logger.info).toHaveBeenCalledWith('没有需要重试的失败URL');
    });
  });

  describe('run', () => {
    beforeEach(() => {
      scraper.initialize = jest.fn();
      scraper.collectUrls = jest.fn().mockResolvedValue(['https://example.com/page1']);
      scraper.scrapePage = jest.fn();
      scraper.cleanup = jest.fn();
      mockDependencies.queueManager.addTask.mockImplementation((id, task) => task());
    });

    it('should run scraper successfully', async () => {
      await scraper.run();

      expect(scraper.initialize).toHaveBeenCalled();
      expect(scraper.collectUrls).toHaveBeenCalled();
      expect(mockDependencies.progressTracker.start).toHaveBeenCalledWith(1);
      expect(mockDependencies.queueManager.addTask).toHaveBeenCalled();
      expect(mockDependencies.queueManager.waitForIdle).toHaveBeenCalled();
      expect(mockDependencies.stateManager.save).toHaveBeenCalled();
      expect(mockDependencies.progressTracker.finish).toHaveBeenCalled();
      expect(scraper.cleanup).toHaveBeenCalled();
    });

    it('should throw if already running', async () => {
      scraper.isRunning = true;
      await expect(scraper.run()).rejects.toThrow(ValidationError);
    });

    it('should handle no URLs found', async () => {
      scraper.collectUrls.mockResolvedValue([]);

      await scraper.run();

      expect(mockDependencies.logger.warn).toHaveBeenCalledWith('没有找到可爬取的URL');
      expect(mockDependencies.queueManager.addTask).not.toHaveBeenCalled();
    });

    it('should cleanup on error', async () => {
      scraper.collectUrls.mockRejectedValue(new Error('Collection failed'));

      await expect(scraper.run()).rejects.toThrow();
      expect(scraper.cleanup).toHaveBeenCalled();
      expect(scraper.isRunning).toBe(false);
    });
  });

  describe('pause/resume/stop', () => {
    it('should pause scraper', async () => {
      scraper.isRunning = true;
      await scraper.pause();
      expect(mockDependencies.queueManager.pause).toHaveBeenCalled();
    });

    it('should resume scraper', async () => {
      scraper.isRunning = true;
      await scraper.resume();
      expect(mockDependencies.queueManager.resume).toHaveBeenCalled();
    });

    it('should stop scraper', async () => {
      scraper.isRunning = true;
      scraper.cleanup = jest.fn();

      await scraper.stop();

      expect(mockDependencies.queueManager.clear).toHaveBeenCalled();
      expect(scraper.cleanup).toHaveBeenCalled();
      expect(scraper.isRunning).toBe(false);
    });

    it('should warn if not running', async () => {
      scraper.isRunning = false;

      await scraper.pause();
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith('爬虫未在运行，无法暂停');

      await scraper.resume();
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith('爬虫未在运行，无法恢复');

      await scraper.stop();
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith('爬虫未在运行');
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', async () => {
      await scraper.cleanup();

      expect(mockDependencies.queueManager.pause).toHaveBeenCalled();
      expect(mockDependencies.queueManager.clear).toHaveBeenCalled();
      expect(mockDependencies.pageManager.closeAll).toHaveBeenCalled();
      expect(mockDependencies.browserPool.close).toHaveBeenCalled();
      expect(mockDependencies.stateManager.save).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockDependencies.browserPool.close.mockRejectedValue(new Error('Close failed'));

      await expect(scraper.cleanup()).rejects.toThrow();
      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        '资源清理失败',
        expect.any(Object)
      );
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      scraper.isInitialized = true;
      scraper.isRunning = true;
      scraper.startTime = Date.now() - 1000;
      scraper.urlQueue = ['url1', 'url2'];

      const status = scraper.getStatus();

      expect(status).toMatchObject({
        isInitialized: true,
        isRunning: true,
        totalUrls: 2,
        progress: expect.any(Object),
        queue: expect.any(Object),
        uptime: expect.any(Number),
      });
      expect(status.uptime).toBeGreaterThan(0);
    });
  });

  describe('event emissions', () => {
    it('should emit initialized event', async () => {
      const listener = jest.fn();
      scraper.on('initialized', listener);

      await scraper.initialize();

      expect(listener).toHaveBeenCalled();
    });

    it('should emit urlsCollected event', async () => {
      scraper.isInitialized = true;
      mockPage.goto.mockResolvedValue({ status: () => 200 });
      mockPage.waitForSelector.mockResolvedValue();

      // Mock multiple evaluate calls: section title + URLs collection
      mockPage.evaluate
        .mockResolvedValueOnce('Section Title') // _extractSectionTitle
        .mockResolvedValueOnce(['https://example.com/page1']); // _collectUrlsFromEntryPoint

      const listener = jest.fn();
      scraper.on('urlsCollected', listener);

      await scraper.collectUrls();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          totalUrls: expect.any(Number),
          duplicates: expect.any(Number),
          sections: expect.any(Number),
        })
      );
    });

    it('should emit pageScraped event', async () => {
      mockPage.goto.mockResolvedValue({ status: () => 200 });
      mockPage.evaluate.mockResolvedValue({ title: 'Title', source: 'document.title' });

      const listener = jest.fn();
      scraper.on('pageScraped', listener);

      await scraper.scrapePage('https://example.com/page', 0);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/page',
          index: 0,
          outputPath: './pdfs/001-page.pdf',
          isBatchMode: false,
          imagesLoaded: true,
        })
      );
    });
  });

  describe('_cleanTitle', () => {
    it('should remove site name with pipe separator', () => {
      expect(scraper._cleanTitle('Overview | Claude Code')).toBe('Overview');
      expect(scraper._cleanTitle('Getting Started | Docs')).toBe('Getting Started');
    });

    it('should remove site name with dash separator', () => {
      expect(scraper._cleanTitle('Overview - Claude Code')).toBe('Overview');
      expect(scraper._cleanTitle('API Reference - Docs')).toBe('API Reference');
    });

    it('should remove site name with en dash', () => {
      expect(scraper._cleanTitle('Overview – Claude Code')).toBe('Overview');
    });

    it('should remove site name with em dash', () => {
      expect(scraper._cleanTitle('Overview — Claude Code')).toBe('Overview');
    });

    it('should remove site name with double colon', () => {
      expect(scraper._cleanTitle('Overview :: Docs')).toBe('Overview');
    });

    it('should remove site name with bullet', () => {
      expect(scraper._cleanTitle('Overview • Docs')).toBe('Overview');
    });

    it('should remove site name with slash', () => {
      expect(scraper._cleanTitle('Overview / Docs')).toBe('Overview');
    });

    it('should handle titles without separators', () => {
      expect(scraper._cleanTitle('Simple Title')).toBe('Simple Title');
      expect(scraper._cleanTitle('No Separator Here')).toBe('No Separator Here');
    });

    it('should handle empty or invalid titles', () => {
      expect(scraper._cleanTitle('')).toBe('');
      expect(scraper._cleanTitle(null)).toBe('');
      expect(scraper._cleanTitle(undefined)).toBe('');
    });

    it('should preserve original if cleaned title is too short', () => {
      expect(scraper._cleanTitle('A | Very Long Site Name')).toBe('A | Very Long Site Name');
    });

    it('should handle multiple separators (use first)', () => {
      expect(scraper._cleanTitle('Title | Site | More')).toBe('Title');
    });

    it('should trim whitespace', () => {
      expect(scraper._cleanTitle('  Title | Site  ')).toBe('Title');
      expect(scraper._cleanTitle('Title  ')).toBe('Title');
    });
  });

  describe('title extraction with multiple sources', () => {
    beforeEach(() => {
      mockPage.goto.mockResolvedValue({ status: () => 200 });
      mockPage.waitForSelector.mockResolvedValue();
      mockPage.pdf.mockResolvedValue();
    });

    it('should extract title from document.title', async () => {
      mockPage.evaluate.mockResolvedValue({
        title: 'Overview | Claude Code',
        source: 'document.title',
      });

      await scraper.scrapePage('https://example.com/page', 0);

      expect(mockDependencies.metadataService.saveArticleTitle).toHaveBeenCalledWith(
        '0',
        'Overview'
      );
    });

    it('should extract title from content h1 when document.title is empty', async () => {
      mockPage.evaluate.mockResolvedValue({
        title: 'Page Heading',
        source: 'content-h1',
      });

      await scraper.scrapePage('https://example.com/page', 0);

      expect(mockDependencies.metadataService.saveArticleTitle).toHaveBeenCalledWith(
        '0',
        'Page Heading'
      );
    });

    it('should warn when title extraction fails', async () => {
      mockPage.evaluate.mockResolvedValue({
        title: '',
        source: 'none',
      });

      await scraper.scrapePage('https://example.com/page', 0);

      expect(mockDependencies.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('标题提取失败'),
        expect.any(Object)
      );
      expect(mockDependencies.metadataService.saveArticleTitle).not.toHaveBeenCalled();
    });
  });
});
