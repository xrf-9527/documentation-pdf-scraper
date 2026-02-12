import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import {
  setupContainer,
  createContainer,
  getContainerHealth,
  shutdownContainer,
} from '../../src/core/setup.js';
import Container from '../../src/core/container.js';

// Mock all dependencies
vi.mock('../../src/core/container.js', () => ({
  default: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn((name) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    name,
  })),
}));
vi.mock('../../src/config/configValidator.js', () => ({
  validateConfig: vi.fn(),
}));

// Mock all service classes
vi.mock('../../src/config/configLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(function MockConfigLoader() {
    return {
      load: vi.fn().mockResolvedValue({ test: true }),
    };
  }),
}));
vi.mock('../../src/services/fileService.js', () => ({
  FileService: vi.fn(),
}));
vi.mock('../../src/services/pathService.js', () => ({
  PathService: vi.fn(),
}));
vi.mock('../../src/services/metadataService.js', () => ({
  MetadataService: vi.fn(),
}));
vi.mock('../../src/services/stateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(function MockStateManager() {
    return {
      load: vi.fn().mockResolvedValue(),
    };
  }),
}));
vi.mock('../../src/services/progressTracker.js', () => ({
  ProgressTracker: vi.fn(),
}));
vi.mock('../../src/services/queueManager.js', () => ({
  QueueManager: vi.fn(),
}));
vi.mock('../../src/services/browserPool.js', () => ({
  BrowserPool: vi.fn().mockImplementation(function MockBrowserPool() {
    return {
      initialize: vi.fn().mockResolvedValue(),
    };
  }),
}));
vi.mock('../../src/services/pageManager.js', () => ({
  PageManager: vi.fn(),
}));
vi.mock('../../src/services/imageService.js', () => ({
  ImageService: vi.fn(),
}));
vi.mock('../../src/services/pdfStyleService.js', () => ({
  PDFStyleService: vi.fn(),
}));
vi.mock('../../src/services/translationService.js', () => ({
  TranslationService: vi.fn(),
}));
vi.mock('../../src/services/markdownService.js', () => ({
  MarkdownService: vi.fn(),
}));
vi.mock('../../src/services/pandocPdfService.js', () => ({
  PandocPdfService: vi.fn(),
}));
vi.mock('../../src/core/scraper.js', () => ({
  Scraper: vi.fn().mockImplementation(function MockScraper() {
    return {
      initialize: vi.fn().mockResolvedValue(),
    };
  }),
}));
vi.mock('../../src/services/PythonMergeService.js', () => ({
  PythonMergeService: vi.fn(),
}));

describe('setup', () => {
  let mockContainer;
  let mockLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock container
    mockContainer = {
      register: vi.fn(),
      get: vi.fn().mockResolvedValue({}),
      validateDependencies: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        registeredServices: 15,
        instances: 5,
        singletons: 15,
      }),
      getHealth: vi.fn().mockReturnValue({
        healthy: true,
        services: [],
      }),
      dispose: vi.fn().mockResolvedValue(),
    };

    Container.mockImplementation(function MockContainer() {
      return mockContainer;
    });
  });

  describe('setupContainer', () => {
    it('should create and configure container successfully', async () => {
      const container = await setupContainer();

      expect(container).toBe(mockContainer);
      expect(Container).toHaveBeenCalledTimes(1);

      // Verify all services are registered
      expect(mockContainer.register).toHaveBeenCalledWith(
        'config',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: [],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'logger',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: [],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'fileService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'pathService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'metadataService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['fileService', 'pathService', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'stateManager',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['fileService', 'pathService', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'progressTracker',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'queueManager',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'browserPool',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'pageManager',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['browserPool', 'config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'imageService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'pdfStyleService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'translationService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'pathService', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'markdownService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'markdownToPdfService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger', 'metadataService'],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'scraper',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: [
            'config',
            'logger',
            'browserPool',
            'pageManager',
            'fileService',
            'pathService',
            'metadataService',
            'stateManager',
            'progressTracker',
            'queueManager',
            'imageService',
            'pdfStyleService',
            'translationService',
            'markdownService',
            'markdownToPdfService',
          ],
          lifecycle: 'singleton',
        })
      );

      expect(mockContainer.register).toHaveBeenCalledWith(
        'pythonMergeService',
        expect.any(Function),
        expect.objectContaining({
          singleton: true,
          dependencies: ['config', 'logger'],
          lifecycle: 'singleton',
        })
      );

      // Verify total number of services registered
      expect(mockContainer.register).toHaveBeenCalledTimes(17);

      // Verify validation and preloading
      expect(mockContainer.validateDependencies).toHaveBeenCalled();
      expect(mockContainer.get).toHaveBeenCalledWith('config');
      expect(mockContainer.get).toHaveBeenCalledWith('logger');
      expect(mockContainer.get).toHaveBeenCalledWith('fileService');
      expect(mockContainer.get).toHaveBeenCalledWith('pathService');

      // Verify stats were retrieved
      expect(mockContainer.getStats).toHaveBeenCalled();
    });

    it('should handle setup errors and dispose container', async () => {
      const setupError = new Error('Setup failed');
      mockContainer.validateDependencies.mockImplementation(() => {
        throw setupError;
      });

      await expect(setupContainer()).rejects.toThrow('Setup failed');

      // Verify cleanup was attempted
      expect(mockContainer.dispose).toHaveBeenCalled();
    });

    it('should log error if disposal fails during setup error', async () => {
      const setupError = new Error('Setup failed');
      const disposeError = new Error('Dispose failed');

      mockContainer.validateDependencies.mockImplementation(() => {
        throw setupError;
      });
      mockContainer.dispose.mockRejectedValue(disposeError);

      await expect(setupContainer()).rejects.toThrow('Setup failed');

      // Verify both errors were handled
      expect(mockContainer.dispose).toHaveBeenCalled();
    });

    it('should create services with correct configurations', async () => {
      // First call setupContainer to populate the mock calls
      await setupContainer();

      // Test config service factory
      const configFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'config'
      )[1];

      const { ConfigLoader } = await import('../../src/config/configLoader.js');
      const { validateConfig } = await import('../../src/config/configValidator.js');

      const config = await configFactory();
      expect(ConfigLoader).toHaveBeenCalled();
      expect(validateConfig).toHaveBeenCalledWith({ test: true });

      // Test logger service factory
      const loggerFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'logger'
      )[1];

      const logger = loggerFactory();
      expect(logger.name).toBe('App');

      // Test fileService factory
      const fileServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'fileService'
      )[1];

      const { FileService } = await import('../../src/services/fileService.js');
      const mockLoggerService = { name: 'test' };
      fileServiceFactory(mockLoggerService);
      expect(FileService).toHaveBeenCalledWith(mockLoggerService);

      // Test pathService factory
      const pathServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'pathService'
      )[1];

      const { PathService } = await import('../../src/services/pathService.js');
      const mockConfig = { outputDir: 'test' };
      pathServiceFactory(mockConfig);
      expect(PathService).toHaveBeenCalledWith(mockConfig);

      // Test queueManager factory with config
      const queueManagerFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'queueManager'
      )[1];

      const { QueueManager } = await import('../../src/services/queueManager.js');
      queueManagerFactory({ concurrency: 10 }, mockLoggerService);
      expect(QueueManager).toHaveBeenCalledWith({
        concurrency: 10,
        timeout: 0, // Disabled queue timeout - operations have their own timeouts
        logger: mockLoggerService,
      });

      // Test imageService factory with config
      const imageServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'imageService'
      )[1];

      const { ImageService } = await import('../../src/services/imageService.js');
      imageServiceFactory({ imageTimeout: 20000 }, mockLoggerService);
      expect(ImageService).toHaveBeenCalledWith({
        defaultTimeout: 20000,
        logger: mockLoggerService,
      });

      // Test pdfStyleService factory with config
      const pdfStyleServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'pdfStyleService'
      )[1];

      const { PDFStyleService } = await import('../../src/services/pdfStyleService.js');
      pdfStyleServiceFactory({
        pdf: {
          theme: 'dark',
          fontSize: '16px',
          preserveCodeHighlighting: false,
        },
      });
      expect(PDFStyleService).toHaveBeenCalledWith({
        theme: 'dark',
        preserveCodeHighlighting: false,
        enableCodeWrap: true,
        fontSize: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        codeFont: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
        removeSelectors: [],
      });

      // Test translationService factory
      const translationServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'translationService'
      )[1];

      const { TranslationService } = await import('../../src/services/translationService.js');
      const mockPathService = { getTranslationCacheDirectory: vi.fn() };
      translationServiceFactory(
        { translation: { enabled: true } },
        mockPathService,
        mockLoggerService
      );
      expect(TranslationService).toHaveBeenCalledWith({
        config: { translation: { enabled: true } },
        pathService: mockPathService,
        logger: mockLoggerService,
      });

      // Test markdownService factory
      const markdownServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'markdownService'
      )[1];

      const { MarkdownService } = await import('../../src/services/markdownService.js');
      markdownServiceFactory(mockConfig, mockLoggerService);
      expect(MarkdownService).toHaveBeenCalledWith({
        config: mockConfig,
        logger: mockLoggerService,
      });

      // Test markdownToPdfService factory
      const markdownToPdfServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'markdownToPdfService'
      )[1];

      const { PandocPdfService } = await import('../../src/services/pandocPdfService.js');
      markdownToPdfServiceFactory(mockConfig, mockLoggerService);
      expect(PandocPdfService).toHaveBeenCalledWith({
        config: mockConfig,
        logger: mockLoggerService,
      });

      // Test scraper factory
      const scraperFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'scraper'
      )[1];

      const { Scraper } = await import('../../src/core/scraper.js');
      const services = [
        mockConfig,
        mockLoggerService,
        'browserPool',
        'pageManager',
        'fileService',
        'pathService',
        'metadataService',
        'stateManager',
        'progressTracker',
        'queueManager',
        'imageService',
        'pdfStyleService',
        'translationService',
        'markdownService',
        'markdownToPdfService',
      ];

      await scraperFactory(...services);
      expect(Scraper).toHaveBeenCalledWith({
        config: mockConfig,
        logger: mockLoggerService,
        browserPool: 'browserPool',
        pageManager: 'pageManager',
        fileService: 'fileService',
        pathService: 'pathService',
        metadataService: 'metadataService',
        stateManager: 'stateManager',
        progressTracker: 'progressTracker',
        queueManager: 'queueManager',
        imageService: 'imageService',
        pdfStyleService: 'pdfStyleService',
        translationService: 'translationService',
        markdownService: 'markdownService',
        markdownToPdfService: 'markdownToPdfService',
      });
    });
  });

  describe('createContainer', () => {
    it('should call setupContainer', async () => {
      const container = await createContainer();

      expect(container).toBe(mockContainer);
      expect(Container).toHaveBeenCalledTimes(1);
    });
  });

  describe('getContainerHealth', () => {
    it('should return container health information', () => {
      const health = getContainerHealth(mockContainer);

      expect(health).toEqual({
        healthy: true,
        services: [],
      });
      expect(mockContainer.getHealth).toHaveBeenCalled();
    });
  });

  describe('shutdownContainer', () => {
    it('should dispose container successfully', async () => {
      await shutdownContainer(mockContainer);

      expect(mockContainer.dispose).toHaveBeenCalled();
    });

    it('should handle disposal errors', async () => {
      const disposeError = new Error('Disposal failed');
      mockContainer.dispose.mockRejectedValue(disposeError);

      await expect(shutdownContainer(mockContainer)).rejects.toThrow('Disposal failed');
    });
  });

  describe('service factory edge cases', () => {
    it('should handle missing config values with defaults', async () => {
      await setupContainer();

      // Test queueManager with no concurrency
      const queueManagerFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'queueManager'
      )[1];

      const { QueueManager } = await import('../../src/services/queueManager.js');
      queueManagerFactory({}, {});
      expect(QueueManager).toHaveBeenCalledWith({
        concurrency: 5,
        timeout: 0, // Disabled queue timeout - operations have their own timeouts
        logger: {},
      });

      // Test imageService with no timeout
      const imageServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'imageService'
      )[1];

      const { ImageService } = await import('../../src/services/imageService.js');
      imageServiceFactory({}, {});
      expect(ImageService).toHaveBeenCalledWith({
        defaultTimeout: 15000,
        logger: {},
      });

      // Test pdfStyleService with empty config
      const pdfStyleServiceFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'pdfStyleService'
      )[1];

      const { PDFStyleService } = await import('../../src/services/pdfStyleService.js');
      pdfStyleServiceFactory({});
      expect(PDFStyleService).toHaveBeenCalledWith({
        theme: 'light',
        preserveCodeHighlighting: true,
        enableCodeWrap: true,
        fontSize: '14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        codeFont: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
        removeSelectors: [],
      });
    });

    it('should handle async service factories', async () => {
      await setupContainer();

      // Test stateManager async factory
      const stateManagerFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'stateManager'
      )[1];

      const { StateManager } = await import('../../src/services/stateManager.js');
      const stateManager = await stateManagerFactory('file', 'path', 'logger');

      expect(StateManager).toHaveBeenCalledWith('file', 'path', 'logger');
      expect(stateManager.load).toHaveBeenCalled();

      // Test browserPool async factory
      const browserPoolFactory = mockContainer.register.mock.calls.find(
        (call) => call[0] === 'browserPool'
      )[1];

      const { BrowserPool } = await import('../../src/services/browserPool.js');
      const browserPool = await browserPoolFactory({ concurrency: 3 }, 'logger');

      expect(BrowserPool).toHaveBeenCalledWith({
        maxBrowsers: 3,
        headless: true,
        logger: 'logger',
      });
      expect(browserPool.initialize).toHaveBeenCalled();
    });
  });
});
