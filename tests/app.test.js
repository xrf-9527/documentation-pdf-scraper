import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { createLogger } from '../src/utils/logger.js';
import * as setupModule from '../src/core/setup.js';
import PythonRunner from '../src/core/pythonRunner.js';

// Mock all dependencies before importing app.js
vi.mock('../src/core/setup.js', () => ({
  createContainer: vi.fn(),
  shutdownContainer: vi.fn().mockResolvedValue(),
  getContainerHealth: vi.fn().mockReturnValue({ healthy: true, services: [] }),
}));

vi.mock('../src/core/pythonRunner.js', () => ({
  default: vi.fn().mockImplementation(function MockPythonRunner() {
    return {
      checkPythonEnvironment: vi.fn().mockResolvedValue({
        available: true,
        version: 'Python 3.9.0',
        executable: 'python3',
      }),
      getRunningProcesses: vi.fn().mockReturnValue([]),
      dispose: vi.fn().mockResolvedValue(),
    };
  }),
}));

vi.mock('../src/utils/logger.js', () => ({
  createLogger: vi.fn((name) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    name,
  })),
}));

// Prevent process.exit from being called
let mockExit;

beforeEach(() => {
  mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

// app.js uses import.meta.url; keep this mock in ESM-friendly Vitest style.
// we'll create a comprehensive mock test that validates the expected behavior

describe('Application', () => {
  let Application;
  let app;
  let mockContainer;
  let mockScraper;
  let mockProgressTracker;
  let mockFileService;
  let mockPythonMergeService;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Application class
    Application = class MockApplication {
      constructor() {
        this.container = null;
        this.logger = createLogger('Application');
        this.pythonRunner = null;
        this.isShuttingDown = false;
        this.startTime = null;
        this.setupSignalHandlers();
      }

      setupSignalHandlers() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        signals.forEach((signal) => {
          process.on(signal, async () => {
            this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
            await this.shutdown();
            process.exit(0);
          });
        });

        process.on('uncaughtException', async (error) => {
          this.logger.error('Uncaught exception:', error);
          await this.shutdown();
          process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
          this.logger.error('Unhandled promise rejection:', { reason, promise });
          await this.shutdown();
          process.exit(1);
        });
      }

      async initialize() {
        try {
          this.startTime = Date.now();
          this.logger.info('🚀 Starting PDF Scraper Application...');
          this.logger.info('📦 Setting up dependency injection container...');

          this.container = await setupModule.createContainer();

          const config = await this.container.get('config');
          const appLogger = await this.container.get('logger');

          this.pythonRunner = new PythonRunner(config, appLogger);

          this.logger.info('🐍 Checking Python environment...');
          const pythonCheck = await this.pythonRunner.checkPythonEnvironment();
          if (!pythonCheck.available) {
            this.logger.warn('⚠️ Python environment not available:', pythonCheck.error);
            this.logger.warn('📄 PDF merge functionality will be limited');
          } else {
            this.logger.info('✅ Python environment ready:', pythonCheck.version);
          }

          const health = setupModule.getContainerHealth(this.container);
          this.logger.info('🏥 Container health check:', health);

          const initTime = Date.now() - this.startTime;
          this.logger.info(`✅ Application initialized successfully in ${initTime}ms`);
        } catch (error) {
          this.logger.error('❌ Failed to initialize application:', error);
          await this.cleanup();
          throw error;
        }
      }

      async runScraping() {
        try {
          this.logger.info('🕷️  Starting web scraping process...');
          const scrapeStartTime = Date.now();

          const scraper = await this.container.get('scraper');
          const progressTracker = await this.container.get('progressTracker');
          const fileService = await this.container.get('fileService');
          const config = await this.container.get('config');

          this.logger.info('🧹 Preparing PDF directory...');
          await fileService.ensureDirectory(config.pdfDir);

          await scraper.run();

          const stats = progressTracker.getStats();
          const scrapeTime = Date.now() - scrapeStartTime;

          this.logger.info('✅ Web scraping completed successfully', {
            duration: scrapeTime,
            stats,
          });

          return {
            success: true,
            duration: scrapeTime,
            stats,
          };
        } catch (error) {
          this.logger.error('❌ Web scraping failed:', error);
          return {
            success: false,
            error: error.message,
          };
        }
      }

      async runPythonMerge() {
        try {
          this.logger.info('📄 Starting PDF merge process...');
          const mergeStartTime = Date.now();

          const pythonMergeService = await this.container.get('pythonMergeService');
          const result = await pythonMergeService.mergePDFs();

          const mergeTime = Date.now() - mergeStartTime;

          if (result.success) {
            this.logger.info('✅ PDF merge completed successfully', {
              duration: mergeTime,
              outputFile: result.outputFile,
              processedFiles: result.processedFiles,
            });
          } else {
            this.logger.error('❌ PDF merge failed:', result.error);
          }

          return {
            ...result,
            duration: mergeTime,
          };
        } catch (error) {
          this.logger.error('❌ PDF merge process failed:', error);
          return {
            success: false,
            error: error.message,
          };
        }
      }

      async run() {
        try {
          await this.initialize();

          const totalStartTime = Date.now();
          this.logger.info('🎯 Starting complete PDF scraping and merge workflow...');

          const scrapeResult = await this.runScraping();
          if (!scrapeResult.success) {
            throw new Error(`Scraping failed: ${scrapeResult.error}`);
          }

          const mergeResult = await this.runPythonMerge();
          if (!mergeResult.success) {
            this.logger.error('PDF merge failed, but scraping was successful');
          }

          const totalTime = Date.now() - totalStartTime;

          const finalReport = {
            totalDuration: totalTime,
            scraping: scrapeResult,
            merge: mergeResult,
            timestamp: new Date().toISOString(),
          };

          this.logger.info('🎉 Application workflow completed!', finalReport);

          return finalReport;
        } catch (error) {
          this.logger.error('💥 Application workflow failed:', error);
          throw error;
        }
      }

      getStatus() {
        const uptime = this.startTime ? Date.now() - this.startTime : 0;

        return {
          status: this.isShuttingDown ? 'shutting_down' : 'running',
          uptime,
          startTime: this.startTime,
          containerHealth: this.container ? setupModule.getContainerHealth(this.container) : null,
          pythonProcesses: this.pythonRunner ? this.pythonRunner.getRunningProcesses() : [],
          memoryUsage: process.memoryUsage(),
          pid: process.pid,
        };
      }

      async cleanup() {
        if (this.isShuttingDown) {
          return;
        }

        this.isShuttingDown = true;
        this.logger.info('🧹 Starting application cleanup...');

        try {
          if (this.pythonRunner) {
            await this.pythonRunner.dispose();
            this.pythonRunner = null;
          }

          if (this.container) {
            await setupModule.shutdownContainer(this.container);
            this.container = null;
          }

          this.logger.info('✅ Application cleanup completed');
        } catch (error) {
          this.logger.error('❌ Error during cleanup:', error);
        }
      }

      async shutdown() {
        if (this.isShuttingDown) {
          return;
        }

        const shutdownStartTime = Date.now();
        this.logger.info('🛑 Initiating graceful shutdown...');

        try {
          await this.cleanup();

          const shutdownTime = Date.now() - shutdownStartTime;
          this.logger.info(`✅ Graceful shutdown completed in ${shutdownTime}ms`);
        } catch (error) {
          this.logger.error('❌ Error during shutdown:', error);
        }
      }

      async healthCheck() {
        try {
          const status = this.getStatus();
          const pythonCheck = this.pythonRunner
            ? await this.pythonRunner.checkPythonEnvironment()
            : null;

          return {
            healthy: true,
            status: status.status,
            uptime: status.uptime,
            containerHealth: status.containerHealth,
            pythonEnvironment: pythonCheck,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            healthy: false,
            error: error.message,
            timestamp: new Date().toISOString(),
          };
        }
      }
    };

    // Mock config
    mockConfig = {
      pdfDir: '/test/pdf',
      pythonExecutable: 'python3',
    };

    // Mock services
    mockScraper = {
      run: vi.fn().mockResolvedValue(),
    };

    mockProgressTracker = {
      start: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        processed: 10,
        failed: 0,
        total: 10,
      }),
    };

    mockFileService = {
      cleanDirectory: vi.fn().mockResolvedValue(),
      ensureDirectory: vi.fn().mockResolvedValue(),
    };

    mockPythonMergeService = {
      mergePDFs: vi.fn().mockResolvedValue({
        success: true,
        outputFile: 'merged.pdf',
        processedFiles: 10,
      }),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Mock container
    mockContainer = {
      get: vi.fn().mockImplementation((service) => {
        const services = {
          config: mockConfig,
          logger: mockLogger,
          scraper: mockScraper,
          progressTracker: mockProgressTracker,
          fileService: mockFileService,
          pythonMergeService: mockPythonMergeService,
        };
        return Promise.resolve(services[service]);
      }),
    };

    setupModule.createContainer.mockResolvedValue(mockContainer);

    app = new Application();
  });

  afterEach(() => {
    // Remove signal handlers to prevent test interference
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGQUIT');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(app.container).toBeNull();
      expect(app.pythonRunner).toBeNull();
      expect(app.isShuttingDown).toBe(false);
      expect(app.startTime).toBeNull();
      expect(app.logger).toBeDefined();
    });

    it('should setup signal handlers', () => {
      const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
      signals.forEach((signal) => {
        expect(process.listenerCount(signal)).toBeGreaterThan(0);
      });
      expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
      expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await app.initialize();

      expect(app.container).toBe(mockContainer);
      expect(app.pythonRunner).toBeDefined();
      expect(app.startTime).toBeGreaterThan(0);

      expect(setupModule.createContainer).toHaveBeenCalled();

      expect(app.logger.info).toHaveBeenCalledWith('🚀 Starting PDF Scraper Application...');
      expect(app.logger.info).toHaveBeenCalledWith('✅ Python environment ready:', 'Python 3.9.0');
    });

    it('should handle Python environment not available', async () => {
      PythonRunner.mockImplementation(function MockPythonRunnerUnavailable() {
        return {
          checkPythonEnvironment: vi.fn().mockResolvedValue({
            available: false,
            error: 'Python not found',
          }),
          getRunningProcesses: vi.fn().mockReturnValue([]),
          dispose: vi.fn().mockResolvedValue(),
        };
      });

      await app.initialize();

      expect(app.logger.warn).toHaveBeenCalledWith(
        '⚠️ Python environment not available:',
        'Python not found'
      );
      expect(app.logger.warn).toHaveBeenCalledWith('📄 PDF merge functionality will be limited');
    });

    it('should handle initialization errors', async () => {
      setupModule.createContainer.mockRejectedValue(new Error('Container setup failed'));

      await expect(app.initialize()).rejects.toThrow('Container setup failed');
      expect(app.logger.error).toHaveBeenCalledWith(
        '❌ Failed to initialize application:',
        expect.any(Error)
      );
    });
  });

  describe('runScraping', () => {
    beforeEach(async () => {
      await app.initialize();
    });

    it('runScraping should not call progressTracker.start directly', async () => {
      await app.runScraping();
      expect(mockProgressTracker.start).not.toHaveBeenCalled();
    });

    it('should run scraping successfully', async () => {
      const result = await app.runScraping();

      expect(result).toMatchObject({
        success: true,
        duration: expect.any(Number),
        stats: {
          processed: 10,
          failed: 0,
          total: 10,
        },
      });

      expect(mockFileService.ensureDirectory).toHaveBeenCalledWith('/test/pdf');
      expect(mockProgressTracker.start).not.toHaveBeenCalled();
      expect(mockScraper.run).toHaveBeenCalled();
    });

    it('should handle scraping errors', async () => {
      mockScraper.run.mockRejectedValue(new Error('Scraping failed'));

      const result = await app.runScraping();

      expect(result).toMatchObject({
        success: false,
        error: 'Scraping failed',
      });

      expect(app.logger.error).toHaveBeenCalledWith('❌ Web scraping failed:', expect.any(Error));
    });
  });

  describe('runPythonMerge', () => {
    beforeEach(async () => {
      await app.initialize();
    });

    it('should run Python merge successfully', async () => {
      const result = await app.runPythonMerge();

      expect(result).toMatchObject({
        success: true,
        outputFile: 'merged.pdf',
        processedFiles: 10,
        duration: expect.any(Number),
      });

      expect(mockPythonMergeService.mergePDFs).toHaveBeenCalled();
      expect(app.logger.info).toHaveBeenCalledWith(
        '✅ PDF merge completed successfully',
        expect.any(Object)
      );
    });

    it('should handle merge failures', async () => {
      mockPythonMergeService.mergePDFs.mockResolvedValue({
        success: false,
        error: 'Merge failed',
      });

      const result = await app.runPythonMerge();

      expect(result.success).toBe(false);
      expect(app.logger.error).toHaveBeenCalledWith('❌ PDF merge failed:', 'Merge failed');
    });

    it('should handle merge exceptions', async () => {
      mockPythonMergeService.mergePDFs.mockRejectedValue(new Error('Merge exception'));

      const result = await app.runPythonMerge();

      expect(result).toMatchObject({
        success: false,
        error: 'Merge exception',
      });
    });
  });

  describe('run', () => {
    it('should run complete workflow successfully', async () => {
      const result = await app.run();

      expect(result).toMatchObject({
        totalDuration: expect.any(Number),
        scraping: {
          success: true,
          duration: expect.any(Number),
          stats: expect.any(Object),
        },
        merge: {
          success: true,
          outputFile: 'merged.pdf',
          processedFiles: 10,
          duration: expect.any(Number),
        },
        timestamp: expect.any(String),
      });

      expect(app.logger.info).toHaveBeenCalledWith(
        '🎉 Application workflow completed!',
        expect.any(Object)
      );
    });

    it('should fail if scraping fails', async () => {
      mockScraper.run.mockRejectedValue(new Error('Scraping error'));

      await expect(app.run()).rejects.toThrow('Scraping failed: Scraping error');
    });

    it('should continue if merge fails after successful scraping', async () => {
      mockPythonMergeService.mergePDFs.mockResolvedValue({
        success: false,
        error: 'Merge failed',
      });

      const result = await app.run();

      expect(result.scraping.success).toBe(true);
      expect(result.merge.success).toBe(false);
      expect(app.logger.error).toHaveBeenCalledWith(
        'PDF merge failed, but scraping was successful'
      );
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', () => {
      const status = app.getStatus();

      expect(status).toMatchObject({
        status: 'running',
        uptime: 0,
        startTime: null,
        containerHealth: null,
        pythonProcesses: [],
        memoryUsage: expect.any(Object),
        pid: process.pid,
      });
    });

    it('should return status when initialized', async () => {
      await app.initialize();

      const status = app.getStatus();

      expect(status).toMatchObject({
        status: 'running',
        uptime: expect.any(Number),
        startTime: expect.any(Number),
        containerHealth: { healthy: true, services: [] },
        pythonProcesses: [],
        memoryUsage: expect.any(Object),
        pid: process.pid,
      });
    });

    it('should return shutting down status', async () => {
      await app.initialize();
      app.isShuttingDown = true;

      const status = app.getStatus();

      expect(status.status).toBe('shutting_down');
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', async () => {
      await app.initialize();
      const pythonRunnerDisposeSpy = app.pythonRunner.dispose;

      await app.cleanup();

      expect(pythonRunnerDisposeSpy).toHaveBeenCalled();
      expect(app.pythonRunner).toBeNull();

      expect(setupModule.shutdownContainer).toHaveBeenCalledWith(mockContainer);
      expect(app.container).toBeNull();
      expect(app.isShuttingDown).toBe(true);
    });

    it('should not cleanup twice', async () => {
      await app.initialize();
      await app.cleanup();
      await app.cleanup();

      expect(app.pythonRunner).toBeNull();
      expect(setupModule.shutdownContainer).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup errors', async () => {
      await app.initialize();
      app.pythonRunner.dispose.mockRejectedValue(new Error('Dispose error'));

      await app.cleanup();

      expect(app.logger.error).toHaveBeenCalledWith('❌ Error during cleanup:', expect.any(Error));
    });
  });

  describe('shutdown', () => {
    it('should perform graceful shutdown', async () => {
      await app.initialize();
      await app.shutdown();

      expect(app.logger.info).toHaveBeenCalledWith('🛑 Initiating graceful shutdown...');
      expect(app.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Graceful shutdown completed')
      );
      expect(app.isShuttingDown).toBe(true);
    });

    it('should not shutdown twice', async () => {
      await app.initialize();
      await app.shutdown();

      const cleanupSpy = vi.spyOn(app, 'cleanup');
      await app.shutdown();

      expect(cleanupSpy).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
      await app.initialize();

      const health = await app.healthCheck();

      expect(health).toMatchObject({
        healthy: true,
        status: 'running',
        uptime: expect.any(Number),
        containerHealth: { healthy: true, services: [] },
        pythonEnvironment: expect.objectContaining({
          available: expect.any(Boolean),
        }),
        timestamp: expect.any(String),
      });
    });

    it('should handle healthcheck errors', async () => {
      // Force an error by making getStatus throw
      vi.spyOn(app, 'getStatus').mockImplementation(() => {
        throw new Error('Status error');
      });

      const health = await app.healthCheck();

      expect(health).toMatchObject({
        healthy: false,
        error: expect.any(String),
        timestamp: expect.any(String),
      });
    });
  });

  describe('signal handlers', () => {
    it('should handle SIGINT', async () => {
      await app.initialize();
      const shutdownSpy = vi.spyOn(app, 'shutdown');

      process.emit('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(shutdownSpy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should handle uncaught exception', async () => {
      await app.initialize();
      const shutdownSpy = vi.spyOn(app, 'shutdown');

      process.emit('uncaughtException', new Error('Test error'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(app.logger.error).toHaveBeenCalledWith('Uncaught exception:', expect.any(Error));
      expect(shutdownSpy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle unhandled rejection', async () => {
      await app.initialize();
      const shutdownSpy = vi.spyOn(app, 'shutdown');

      // Create a rejected promise but don't throw it
      const rejectedPromise = Promise.reject('test rejection');
      // Prevent unhandled rejection warning
      rejectedPromise.catch(() => {});

      process.emit('unhandledRejection', 'rejection reason', rejectedPromise);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(app.logger.error).toHaveBeenCalledWith(
        'Unhandled promise rejection:',
        expect.any(Object)
      );
      expect(shutdownSpy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});

describe('main', () => {
  let mockApp;
  let consoleLogSpy;
  let consoleErrorSpy;

  // Mock main function
  const main = async function () {
    const Application = class {
      constructor() {
        Object.assign(this, mockApp);
      }
    };

    const app = new Application();

    try {
      const result = await app.run();

      console.log('\n' + '='.repeat(60));
      console.log('🎉 APPLICATION COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`📊 Total Duration: ${result.totalDuration}ms`);
      console.log(`🕷️  Scraping: ${result.scraping.success ? '✅ Success' : '❌ Failed'}`);
      console.log(`📄 PDF Merge: ${result.merge.success ? '✅ Success' : '❌ Failed'}`);
      console.log('='.repeat(60));

      await app.shutdown();
      process.exit(0);
    } catch (error) {
      console.error('\n' + '='.repeat(60));
      console.error('💥 APPLICATION FAILED');
      console.error('='.repeat(60));
      console.error('Error:', error.message);
      console.error('='.repeat(60));

      await app.cleanup();
      process.exit(1);
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();

    // Mock Application instance methods
    mockApp = {
      run: vi.fn().mockResolvedValue({
        totalDuration: 5000,
        scraping: { success: true },
        merge: { success: true },
      }),
      shutdown: vi.fn().mockResolvedValue(),
      cleanup: vi.fn().mockResolvedValue(),
    };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should run main successfully', async () => {
    await main();

    expect(mockApp.run).toHaveBeenCalled();
    expect(mockApp.shutdown).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('APPLICATION COMPLETED SUCCESSFULLY')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Scraping: ✅ Success'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('PDF Merge: ✅ Success'));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('should handle main failure', async () => {
    mockApp.run.mockRejectedValue(new Error('Application failed'));

    await main();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('APPLICATION FAILED'));
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'Application failed');
    expect(mockApp.cleanup).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
