import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { PageManager } from '../../src/services/pageManager.js';
import { NetworkError } from '../../src/utils/errors.js';

describe('PageManager', () => {
  let pageManager;
  let mockBrowserPool;
  let mockLogger;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    mockPage = {
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      setViewport: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      close: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
      on: vi.fn(),
    };

    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
    };

    mockBrowserPool = {
      getBrowser: vi.fn().mockResolvedValue(mockBrowser),
      releaseBrowser: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        busyBrowsers: 1,
        availableBrowsers: 2,
      }),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    pageManager = new PageManager(mockBrowserPool, {
      logger: mockLogger,
      defaultTimeout: 30000,
      navigationTimeout: 30000,
      viewport: { width: 1920, height: 1080 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const pm = new PageManager(mockBrowserPool);

      expect(pm.browserPool).toBe(mockBrowserPool);
      expect(pm.options.defaultTimeout).toBe(30000);
      expect(pm.options.navigationTimeout).toBe(30000);
      expect(pm.options.enableRequestInterception).toBe(true);
      expect(pm.options.blockedResourceTypes).toEqual([]);
      expect(pm.pages).toBeInstanceOf(Map);
      expect(pm.isClosed).toBe(false);
    });

    it('should accept custom options', () => {
      const customOptions = {
        defaultTimeout: 60000,
        navigationTimeout: 45000,
        enableRequestInterception: false,
        blockedResourceTypes: ['image', 'media'],
        userAgent: 'Custom User Agent',
      };

      const pm = new PageManager(mockBrowserPool, customOptions);

      expect(pm.options.defaultTimeout).toBe(60000);
      expect(pm.options.navigationTimeout).toBe(45000);
      expect(pm.options.enableRequestInterception).toBe(false);
      expect(pm.options.blockedResourceTypes).toEqual(['image', 'media']);
      expect(pm.options.userAgent).toBe('Custom User Agent');
    });
  });

  describe('createPage', () => {
    it('should create a page successfully', async () => {
      const page = await pageManager.createPage('test-page');

      expect(mockBrowserPool.getBrowser).toHaveBeenCalled();
      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(30000);
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(30000);
      expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
      expect(pageManager.pages.has('test-page')).toBe(true);
      expect(pageManager.stats.created).toBe(1);
      expect(pageManager.stats.active).toBe(1);
      expect(page).toBe(mockPage);
    });

    it('should throw error if page manager is closed', async () => {
      pageManager.isClosed = true;

      await expect(pageManager.createPage('test-page')).rejects.toThrow('页面管理器已关闭');
    });

    it('should throw error if page ID already exists', async () => {
      await pageManager.createPage('test-page');

      await expect(pageManager.createPage('test-page')).rejects.toThrow('页面 test-page 已存在');
    });

    it('should release browser on page creation failure', async () => {
      mockBrowser.newPage.mockRejectedValue(new Error('Page creation failed'));

      await expect(pageManager.createPage('test-page')).rejects.toThrow(NetworkError);

      expect(mockBrowserPool.releaseBrowser).toHaveBeenCalledWith(mockBrowser);
      expect(pageManager.stats.errors).toBe(1);
    });

    it('should emit page-created event', async () => {
      const listener = vi.fn();
      pageManager.on('page-created', listener);

      await pageManager.createPage('test-page');

      expect(listener).toHaveBeenCalledWith({
        id: 'test-page',
        pageInfo: expect.objectContaining({
          id: 'test-page',
          page: mockPage,
          browser: mockBrowser,
          createdAt: expect.any(Number),
          lastActivity: expect.any(Number),
          requestCount: 0,
          errorCount: 0,
        }),
      });
    });
  });

  describe('configurePage', () => {
    it('should configure page with custom user agent', async () => {
      await pageManager.configurePage(mockPage, {
        userAgent: 'Custom UA',
        defaultTimeout: 45000,
        navigationTimeout: 60000,
      });

      expect(mockPage.setUserAgent).toHaveBeenCalledWith('Custom UA');
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(45000);
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(60000);
    });

    it('should enable request interception when specified', async () => {
      const mockRequest = {
        resourceType: vi.fn().mockReturnValue('image'),
        url: vi.fn().mockReturnValue('https://example.com/image.jpg'),
        abort: vi.fn(),
        continue: vi.fn(),
      };

      await pageManager.configurePage(mockPage, {
        enableRequestInterception: true,
        blockedResourceTypes: ['image'],
      });

      expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);

      const requestHandler = mockPage.on.mock.calls.find((call) => call[0] === 'request')[1];
      requestHandler(mockRequest);

      expect(mockRequest.abort).toHaveBeenCalled();
      expect(pageManager.stats.blockedRequests).toBe(1);
    });

    it('should block requests from blocked domains', async () => {
      const mockRequest = {
        resourceType: vi.fn().mockReturnValue('script'),
        url: vi.fn().mockReturnValue('https://google-analytics.com/ga.js'),
        abort: vi.fn(),
        continue: vi.fn(),
      };

      await pageManager.configurePage(mockPage, {
        enableRequestInterception: true,
        blockedResourceTypes: [],
      });

      const requestHandler = mockPage.on.mock.calls.find((call) => call[0] === 'request')[1];
      requestHandler(mockRequest);

      expect(mockRequest.abort).toHaveBeenCalled();
    });

    it('should hide webdriver properties', async () => {
      await pageManager.configurePage(mockPage, {});

      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('setupPageEvents', () => {
    beforeEach(async () => {
      await pageManager.createPage('test-page');
    });

    it('should handle page errors', () => {
      const errorListener = vi.fn();
      pageManager.on('page-error', errorListener);

      const errorHandler = mockPage.on.mock.calls.find((call) => call[0] === 'error')[1];
      const error = new Error('Page crashed');
      errorHandler(error);

      expect(mockLogger.error).toHaveBeenCalledWith('页面错误 [test-page]', {
        error: 'Page crashed',
      });
      expect(errorListener).toHaveBeenCalledWith({ id: 'test-page', error });
      expect(pageManager.stats.errors).toBe(1);
    });

    it('should handle page JavaScript errors', () => {
      const jsErrorListener = vi.fn();
      pageManager.on('page-js-error', jsErrorListener);

      const pageerrorHandler = mockPage.on.mock.calls.find((call) => call[0] === 'pageerror')[1];
      const error = new Error('Uncaught TypeError');
      pageerrorHandler(error);

      expect(mockLogger.warn).toHaveBeenCalledWith('页面JS错误 [test-page]', {
        error: 'Uncaught TypeError',
      });
      expect(jsErrorListener).toHaveBeenCalledWith({ id: 'test-page', error });
    });

    it('should ignore known JavaScript errors', () => {
      const jsErrorListener = vi.fn();
      pageManager.on('page-js-error', jsErrorListener);

      const pageerrorHandler = mockPage.on.mock.calls.find((call) => call[0] === 'pageerror')[1];
      const error = new Error('Invariant: attempted to hard navigate to the same URL');
      pageerrorHandler(error);

      expect(mockLogger.debug).toHaveBeenCalledWith('忽略的JS错误 [test-page]', {
        error: error.message,
      });
      expect(jsErrorListener).not.toHaveBeenCalled();
    });

    it('should handle page crash', async () => {
      const crashListener = vi.fn();
      pageManager.on('page-crash', crashListener);

      const crashHandler = mockPage.on.mock.calls.find((call) => call[0] === 'crash')[1];
      crashHandler();

      expect(mockLogger.error).toHaveBeenCalledWith('页面崩溃 [test-page]');
      expect(crashListener).toHaveBeenCalledWith({ id: 'test-page' });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('should track page requests', async () => {
      // First ensure the page is created and the event handler is set up
      // We already create the page in beforeEach

      // Find the page request event handler that was registered during setupPageEvents
      const setupEventsCalls = mockPage.on.mock.calls;
      const requestEventCall = setupEventsCalls.find((call) => call[0] === 'request');

      // The handler is the second item after the handler in configurePage
      const requestHandlers = setupEventsCalls.filter((call) => call[0] === 'request');
      expect(requestHandlers.length).toBeGreaterThan(1); // One from configurePage, one from setupPageEvents

      const trackingHandler = requestHandlers[requestHandlers.length - 1][1];
      trackingHandler({});

      const pageInfo = pageManager.getPageInfo('test-page');
      expect(pageInfo.requestCount).toBe(1);
      expect(pageInfo.lastActivity).toBeGreaterThan(0);
    });

    it('should emit page-response event', () => {
      const responseListener = vi.fn();
      pageManager.on('page-response', responseListener);

      const responseHandler = mockPage.on.mock.calls.find((call) => call[0] === 'response')[1];
      const mockResponse = {
        url: vi.fn().mockReturnValue('https://example.com'),
        status: vi.fn().mockReturnValue(200),
      };
      responseHandler(mockResponse);

      expect(responseListener).toHaveBeenCalledWith({
        id: 'test-page',
        url: 'https://example.com',
        status: 200,
      });
    });
  });

  describe('getPage', () => {
    it('should return page if exists', async () => {
      await pageManager.createPage('test-page');
      const page = pageManager.getPage('test-page');
      expect(page).toBe(mockPage);
    });

    it('should return null if page does not exist', () => {
      const page = pageManager.getPage('non-existent');
      expect(page).toBeNull();
    });
  });

  describe('getPageInfo', () => {
    it('should return page info if exists', async () => {
      await pageManager.createPage('test-page');
      const pageInfo = pageManager.getPageInfo('test-page');

      expect(pageInfo).toMatchObject({
        id: 'test-page',
        page: mockPage,
        browser: mockBrowser,
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number),
        requestCount: 0,
        errorCount: 0,
      });
    });

    it('should return undefined if page does not exist', () => {
      const pageInfo = pageManager.getPageInfo('non-existent');
      expect(pageInfo).toBeUndefined();
    });
  });

  describe('closePage', () => {
    beforeEach(async () => {
      await pageManager.createPage('test-page');
    });

    it('should close page successfully', async () => {
      const closeListener = vi.fn();
      pageManager.on('page-closed', closeListener);

      await pageManager.closePage('test-page');

      expect(mockPage.close).toHaveBeenCalled();
      expect(mockBrowserPool.releaseBrowser).toHaveBeenCalledWith(mockBrowser);
      expect(pageManager.pages.has('test-page')).toBe(false);
      expect(pageManager.stats.closed).toBe(1);
      expect(pageManager.stats.active).toBe(0);
      expect(closeListener).toHaveBeenCalled();
    });

    it('should handle already closed page', async () => {
      mockPage.isClosed.mockReturnValue(true);

      await pageManager.closePage('test-page');

      expect(mockPage.close).not.toHaveBeenCalled();
      expect(mockBrowserPool.releaseBrowser).toHaveBeenCalledWith(mockBrowser);
    });

    it('should warn if page does not exist', async () => {
      await pageManager.closePage('non-existent');

      expect(mockLogger.warn).toHaveBeenCalledWith('页面 [non-existent] 不存在，无法关闭');
    });

    it('should handle page close errors gracefully', async () => {
      mockPage.close.mockRejectedValue(new Error('Close failed'));

      await pageManager.closePage('test-page');

      expect(mockLogger.warn).toHaveBeenCalledWith('关闭页面失败 [test-page]', {
        error: 'Close failed',
      });
      expect(mockBrowserPool.releaseBrowser).toHaveBeenCalledWith(mockBrowser);
      expect(pageManager.pages.has('test-page')).toBe(false);
    });
  });

  describe('closeAll', () => {
    it('should close all pages', async () => {
      await pageManager.createPage('page1');
      await pageManager.createPage('page2');
      await pageManager.createPage('page3');

      await pageManager.closeAll();

      expect(mockPage.close).toHaveBeenCalledTimes(3);
      expect(pageManager.pages.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('开始关闭所有页面 (3 个)');
      expect(mockLogger.info).toHaveBeenCalledWith('所有页面已关闭');
    });

    it('should handle errors when closing pages', async () => {
      await pageManager.createPage('page1');

      // Clear previous mock calls to logger
      mockLogger.warn.mockClear();

      mockPage.close.mockRejectedValue(new Error('Close failed'));

      await pageManager.closeAll();

      expect(mockLogger.warn).toHaveBeenCalledWith('关闭页面失败 [page1]', {
        error: 'Close failed',
      });
    });
  });

  describe('cleanup', () => {
    it('should cleanup idle pages', async () => {
      await pageManager.createPage('page1');
      const pageInfo = pageManager.getPageInfo('page1');
      pageInfo.lastActivity = Date.now() - 400000; // 6+ minutes ago

      await pageManager.createPage('page2'); // Recent page

      const cleanedUp = await pageManager.cleanup(300000); // 5 minute timeout

      expect(cleanedUp).toBe(1);
      expect(pageManager.pages.has('page1')).toBe(false);
      expect(pageManager.pages.has('page2')).toBe(true);
    });

    it('should cleanup closed pages', async () => {
      await pageManager.createPage('page1');
      mockPage.isClosed.mockReturnValue(true);

      const cleanedUp = await pageManager.cleanup();

      expect(cleanedUp).toBe(1);
      expect(pageManager.pages.has('page1')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return current status', async () => {
      await pageManager.createPage('page1');
      await pageManager.createPage('page2');

      const status = pageManager.getStatus();

      expect(status).toMatchObject({
        isClosed: false,
        totalPages: 2,
        activeBrowsers: 1,
        stats: {
          created: 2,
          closed: 0,
          errors: 0,
          active: 2,
          totalRequests: 2,
          blockedRequests: 0,
        },
        pages: expect.arrayContaining([
          expect.objectContaining({
            id: 'page1',
            createdAt: expect.any(Number),
            lastActivity: expect.any(Number),
            requestCount: 0,
            errorCount: 0,
            idleTime: expect.any(Number),
          }),
        ]),
      });
    });
  });

  describe('close', () => {
    it('should close page manager', async () => {
      await pageManager.createPage('page1');

      const closedListener = vi.fn();
      pageManager.on('closed', closedListener);

      await pageManager.close();

      expect(pageManager.isClosed).toBe(true);
      expect(mockPage.close).toHaveBeenCalled();
      expect(closedListener).toHaveBeenCalledWith({ stats: pageManager.stats });
    });

    it('should not close twice', async () => {
      await pageManager.close();

      // Clear mock calls before second close
      mockLogger.info.mockClear();

      await pageManager.close();

      expect(mockLogger.info).not.toHaveBeenCalled(); // Second close should not log
    });
  });

  describe('createPages', () => {
    it('should create multiple pages', async () => {
      const configs = [
        { id: 'page1', options: { userAgent: 'UA1' } },
        { id: 'page2', options: { userAgent: 'UA2' } },
      ];

      const results = await pageManager.createPages(configs);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ success: true, id: 'page1', page: mockPage });
      expect(results[1]).toMatchObject({ success: true, id: 'page2', page: mockPage });
      expect(pageManager.pages.size).toBe(2);
    });

    it('should handle partial failures', async () => {
      mockBrowser.newPage
        .mockResolvedValueOnce(mockPage)
        .mockRejectedValueOnce(new Error('Creation failed'));

      const configs = [{ id: 'page1' }, { id: 'page2' }];

      const results = await pageManager.createPages(configs);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeInstanceOf(Error);
    });
  });

  describe('restartPage', () => {
    it('should restart existing page', async () => {
      await pageManager.createPage('page1', { userAgent: 'Original UA' });

      const newMockPage = { ...mockPage };
      mockBrowser.newPage.mockResolvedValue(newMockPage);

      const restartedPage = await pageManager.restartPage('page1', { userAgent: 'New UA' });

      expect(mockPage.close).toHaveBeenCalled();
      expect(restartedPage).toBe(newMockPage);
      expect(mockPage.setUserAgent).toHaveBeenLastCalledWith('New UA');
    });

    it('should throw if page does not exist', async () => {
      await expect(pageManager.restartPage('non-existent')).rejects.toThrow(
        '页面 non-existent 不存在'
      );
    });
  });

  describe('shouldBlockRequest', () => {
    it('should block media resources', () => {
      expect(pageManager.shouldBlockRequest('https://example.com/video.mp4', 'media')).toBe(true);
    });

    it('should block analytics domains', () => {
      expect(pageManager.shouldBlockRequest('https://google-analytics.com/ga.js', 'script')).toBe(
        true
      );
      expect(pageManager.shouldBlockRequest('https://googletagmanager.com/gtm.js', 'script')).toBe(
        true
      );
      expect(pageManager.shouldBlockRequest('https://facebook.com/tr', 'image')).toBe(true);
    });

    it('should allow normal resources', () => {
      expect(pageManager.shouldBlockRequest('https://example.com/app.js', 'script')).toBe(false);
      expect(pageManager.shouldBlockRequest('https://example.com/style.css', 'stylesheet')).toBe(
        false
      );
    });
  });

  describe('isIgnorableJSError', () => {
    it('should identify Next.js errors', () => {
      const nextError = new Error('Invariant: attempted to hard navigate to the same URL');
      expect(pageManager.isIgnorableJSError(nextError)).toBe(true);
    });

    it('should identify third-party errors', () => {
      const scriptError = new Error('Script error.');
      expect(pageManager.isIgnorableJSError(scriptError)).toBe(true);
    });

    it('should not ignore real errors', () => {
      const realError = new Error('Real application error');
      expect(pageManager.isIgnorableJSError(realError)).toBe(false);
    });
  });
});
