import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let mockCreateContainer;
let mockShutdownContainer;
let mockGetContainerHealth;
let mockCheckPythonEnvironment;
let mockPythonRunnerDispose;
let mockGetRunningProcesses;
let mockLogger;

vi.mock('../../src/core/setup.js', () => ({
  createContainer: (...args) => mockCreateContainer(...args),
  shutdownContainer: (...args) => mockShutdownContainer(...args),
  getContainerHealth: (...args) => mockGetContainerHealth(...args),
}));

vi.mock('../../src/core/pythonRunner.js', () => ({
  __esModule: true,
  default: vi.fn(function MockPythonRunner() {
    this.checkPythonEnvironment = (...args) => mockCheckPythonEnvironment(...args);
    this.dispose = (...args) => mockPythonRunnerDispose(...args);
    this.getRunningProcesses = (...args) => mockGetRunningProcesses(...args);
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import { Application } from '../../src/app.js';

function createMockContainer(serviceMap) {
  return {
    get: vi.fn(async (name) => {
      if (!(name in serviceMap)) {
        throw new Error(`Unknown service requested in test: ${name}`);
      }
      return serviceMap[name];
    }),
  };
}

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('Application minimal workflow integration', () => {
  let processOnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateContainer = vi.fn();
    mockShutdownContainer = vi.fn().mockResolvedValue();
    mockGetContainerHealth = vi.fn().mockReturnValue({ healthy: true, services: [] });
    mockCheckPythonEnvironment = vi.fn().mockResolvedValue({
      available: true,
      version: 'Python 3.11.0',
      executable: 'python3',
    });
    mockPythonRunnerDispose = vi.fn().mockResolvedValue();
    mockGetRunningProcesses = vi.fn().mockReturnValue([]);
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('does not register signal handlers when setupSignalHandlers is false', () => {
    const app = new Application({ setupSignalHandlers: false });

    expect(app).toBeDefined();
    expect(processOnSpy).not.toHaveBeenCalled();
  });

  it('runs scrape + python merge workflow in standard mode', async () => {
    const tempRoot = await createTempDir('app-standard');
    const pdfDir = path.join(tempRoot, 'pdfs');
    const tempDirectory = path.join('.temp', `vi-app-standard-${Date.now()}`);

    const config = {
      rootURL: 'https://docs.example.com/start',
      pdfDir,
      output: { tempDirectory },
      markdownPdf: { batchMode: false },
    };

    const scraper = { run: vi.fn().mockResolvedValue() };
    const progressTracker = {
      start: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 1, completed: 1, failed: 0 }),
    };
    const fileService = {
      ensureDirectory: vi.fn(async (dir) => {
        await fs.mkdir(dir, { recursive: true });
      }),
    };
    const pythonMergeService = {
      mergePDFs: vi.fn().mockResolvedValue({
        success: true,
        outputFile: 'docs.pdf',
        processedFiles: 1,
      }),
    };

    const container = createMockContainer({
      config,
      logger: mockLogger,
      scraper,
      progressTracker,
      fileService,
      pythonMergeService,
    });
    mockCreateContainer.mockResolvedValue(container);

    const app = new Application({ setupSignalHandlers: false });

    try {
      const result = await app.run();

      expect(scraper.run).toHaveBeenCalledTimes(1);
      expect(progressTracker.start).not.toHaveBeenCalled();
      expect(fileService.ensureDirectory).toHaveBeenCalledWith(pdfDir);
      expect(pythonMergeService.mergePDFs).toHaveBeenCalledTimes(1);
      expect(result.scraping.success).toBe(true);
      expect(result.merge.success).toBe(true);
      expect(result.batchMode).toBe(false);
    } finally {
      await app.cleanup();
      await fs.rm(path.resolve(tempDirectory), { recursive: true, force: true });
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs scrape + batch pdf workflow when batch mode is enabled', async () => {
    const tempRoot = await createTempDir('app-batch');
    const pdfDir = path.join(tempRoot, 'pdfs');

    const config = {
      rootURL: 'https://docs.example.com/start',
      pdfDir,
      markdown: { outputDir: 'markdown' },
      output: { finalPdfDirectory: 'finalPdf' },
      markdownPdf: { batchMode: true },
    };

    const scraper = { run: vi.fn().mockResolvedValue() };
    const progressTracker = {
      start: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 2, completed: 2, failed: 0 }),
    };
    const fileService = {
      ensureDirectory: vi.fn(async (dir) => {
        await fs.mkdir(dir, { recursive: true });
      }),
    };
    const markdownToPdfService = {
      generateBatchPdf: vi.fn().mockResolvedValue({
        success: true,
        outputPath: 'batch.pdf',
        filesProcessed: 2,
      }),
    };
    const pythonMergeService = { mergePDFs: vi.fn() };

    const container = createMockContainer({
      config,
      logger: mockLogger,
      scraper,
      progressTracker,
      fileService,
      markdownToPdfService,
      pythonMergeService,
    });
    mockCreateContainer.mockResolvedValue(container);

    const app = new Application({ setupSignalHandlers: false });

    try {
      const result = await app.run();

      expect(scraper.run).toHaveBeenCalledTimes(1);
      expect(markdownToPdfService.generateBatchPdf).toHaveBeenCalledTimes(1);
      expect(pythonMergeService.mergePDFs).not.toHaveBeenCalled();
      expect(result.scraping.success).toBe(true);
      expect(result.merge.success).toBe(true);
      expect(result.batchMode).toBe(true);
    } finally {
      await app.cleanup();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
