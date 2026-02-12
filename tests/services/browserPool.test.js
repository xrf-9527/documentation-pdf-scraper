import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { NetworkError } from '../../src/utils/errors.js';

// Mock puppeteer-extra and stealth plugin before importing BrowserPool
vi.mock('puppeteer-extra');
vi.mock('puppeteer-extra-plugin-stealth');

// Import BrowserPool and mocked modules
import { BrowserPool } from '../../src/services/browserPool.js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

describe('BrowserPool', () => {
  let browserPool;
  let mockLogger;
  let browserCount = 0;

  const createMockBrowser = (pid = 12345) => {
    return {
      on: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      process: vi.fn().mockReturnValue({ pid: pid + browserCount++ }),
    };
  };

  beforeEach(() => {
    browserCount = 0;
    vi.clearAllMocks();

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Configure mocks
    puppeteer.launch.mockImplementation(() => Promise.resolve(createMockBrowser()));
    puppeteer.use.mockReturnValue(undefined);
    StealthPlugin.mockReturnValue({
      name: 'stealth',
      _isPuppeteerExtraPlugin: true,
    });

    browserPool = new BrowserPool({
      logger: mockLogger,
      maxBrowsers: 2,
      headless: true,
    });
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const pool = new BrowserPool();

      expect(pool.options.maxBrowsers).toBe(1);
      expect(pool.options.headless).toBe(true);
      expect(pool.options.retryLimit).toBe(3);
      expect(pool.options.retryDelay).toBe(5000);
      expect(pool.browsers).toEqual([]);
      expect(pool.isInitialized).toBe(false);
      expect(pool.isClosed).toBe(false);
    });

    it('should accept custom options', () => {
      expect(browserPool.options.maxBrowsers).toBe(2);
      expect(browserPool.logger).toBe(mockLogger);
    });

    it('should initialize stats', () => {
      expect(browserPool.stats).toEqual({
        created: 0,
        disconnected: 0,
        errors: 0,
        totalRequests: 0,
        activeRequests: 0,
      });
    });
  });

  describe('initialize', () => {
    it('should initialize browser pool successfully', async () => {
      await browserPool.initialize();

      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
      expect(browserPool.browsers).toHaveLength(2);
      expect(browserPool.availableBrowsers).toHaveLength(2);
      expect(browserPool.isInitialized).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('浏览器池初始化完成', expect.any(Object));
    });

    it('should not reinitialize if already initialized', async () => {
      browserPool.isInitialized = true;

      await browserPool.initialize();

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('浏览器池已经初始化');
    });

    it('should handle partial browser creation failures', async () => {
      puppeteer.launch
        .mockResolvedValueOnce(createMockBrowser())
        .mockRejectedValueOnce(new Error('Browser creation failed'));

      await browserPool.initialize();

      expect(browserPool.browsers).toHaveLength(1);
      expect(browserPool.isInitialized).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '创建第 2 个浏览器实例失败',
        expect.any(Object)
      );
    });

    it('should throw if no browsers can be created', async () => {
      puppeteer.launch.mockRejectedValue(new Error('Browser creation failed'));

      await expect(browserPool.initialize()).rejects.toThrow(NetworkError);
      expect(browserPool.isInitialized).toBe(false);
    });

    it('should emit initialized event', async () => {
      const listener = vi.fn();
      browserPool.on('initialized', listener);

      await browserPool.initialize();

      expect(listener).toHaveBeenCalledWith({ totalBrowsers: 2 });
    });
  });

  describe('createBrowser', () => {
    it('should create browser successfully', async () => {
      const browser = await browserPool.createBrowser();

      expect(browser).toHaveProperty('close');
      expect(browser).toHaveProperty('isConnected');
      expect(browser).toHaveProperty('on');
      expect(browser).toHaveProperty('process');
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          defaultViewport: { width: 1920, height: 1080 },
          args: expect.arrayContaining(['--no-sandbox', '--disable-gpu']),
        })
      );
      expect(browserPool.stats.created).toBe(1);
    });

    it('should setup browser event listeners', async () => {
      const browser = await browserPool.createBrowser();

      expect(browser.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(browser.on).toHaveBeenCalledWith('targetcreated', expect.any(Function));
      expect(browser.on).toHaveBeenCalledWith('targetdestroyed', expect.any(Function));
    });

    it('should emit browser-created event', async () => {
      const listener = vi.fn();
      browserPool.on('browser-created', listener);

      const browser = await browserPool.createBrowser();

      expect(listener).toHaveBeenCalledWith({ browser });
    });

    it('should handle creation errors', async () => {
      puppeteer.launch.mockRejectedValue(new Error('Launch failed'));

      await expect(browserPool.createBrowser()).rejects.toThrow(NetworkError);
      expect(browserPool.stats.errors).toBe(1);
    });
  });

  describe('getBrowser', () => {
    beforeEach(async () => {
      await browserPool.initialize();
    });

    it('should get available browser', async () => {
      const browser = await browserPool.getBrowser();

      expect(browser).toHaveProperty('close');
      expect(browser).toHaveProperty('isConnected');
      expect(browserPool.availableBrowsers).toHaveLength(1);
      expect(browserPool.busyBrowsers).toHaveLength(1);
      expect(browserPool.stats.totalRequests).toBe(1);
      expect(browserPool.stats.activeRequests).toBe(1);
    });

    it('should throw if not initialized', async () => {
      const pool = new BrowserPool();

      await expect(pool.getBrowser()).rejects.toThrow('浏览器池未初始化');
    });

    it('should throw if closed', async () => {
      browserPool.isClosed = true;

      await expect(browserPool.getBrowser()).rejects.toThrow('浏览器池已关闭');
    });

    it('should emit browser-acquired event', async () => {
      const listener = vi.fn();
      browserPool.on('browser-acquired', listener);

      await browserPool.getBrowser();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          stats: expect.objectContaining({
            totalRequests: 1,
            activeRequests: 1,
          }),
        })
      );
    });
  });

  describe('releaseBrowser', () => {
    beforeEach(async () => {
      await browserPool.initialize();
    });

    it('should release browser successfully', async () => {
      const browser = await browserPool.getBrowser();

      await browserPool.releaseBrowser(browser);

      expect(browserPool.availableBrowsers).toHaveLength(2);
      expect(browserPool.busyBrowsers).toHaveLength(0);
      expect(browserPool.stats.activeRequests).toBe(0);
    });

    it('should handle disconnected browsers', async () => {
      const browser = await browserPool.getBrowser();
      browser.isConnected.mockReturnValue(false);

      await browserPool.releaseBrowser(browser);

      expect(browserPool.disconnectedBrowsers).toHaveLength(1);
    });

    it('should emit browser-released event', async () => {
      const listener = vi.fn();
      browserPool.on('browser-released', listener);

      const browser = await browserPool.getBrowser();
      await browserPool.releaseBrowser(browser);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          stats: expect.objectContaining({
            activeRequests: 0,
          }),
        })
      );
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await browserPool.initialize();
    });

    it('should close all browsers', async () => {
      await browserPool.close();

      expect(browserPool.isClosed).toBe(true);
      expect(browserPool.browsers.every((browser) => browser.close)).toBe(true);
    });

    it('should not close twice', async () => {
      await browserPool.close();
      await browserPool.close();

      expect(mockLogger.warn).toHaveBeenCalledWith('浏览器池已经关闭');
    });

    it('should emit closed event', async () => {
      const listener = vi.fn();
      browserPool.on('closed', listener);

      await browserPool.close();

      expect(listener).toHaveBeenCalled();
    });
  });
});
