import path from 'path';
import { createContainer, shutdownContainer, getContainerHealth } from './core/setup.js';
import PythonRunner from './core/pythonRunner.js';
import { createLogger } from './utils/logger.js';

/**
 * 主应用程序类
 * 提供完整的应用程序生命周期管理
 */
class Application {
  constructor(options = {}) {
    const { setupSignalHandlers = true, processRef = process } = options;

    this.container = null;
    this.logger = createLogger('Application');
    this.pythonRunner = null;
    this.isShuttingDown = false;
    this.startTime = null;
    this.processRef = processRef;

    // 绑定信号处理
    if (setupSignalHandlers) {
      this.setupSignalHandlers();
    }
  }

  /**
   * 设置信号处理器，实现优雅关闭
   */
  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    signals.forEach((signal) => {
      this.processRef.on(signal, async () => {
        this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
        await this.shutdown();
        this.processRef.exit(0);
      });
    });

    // 处理未捕获的异常
    this.processRef.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.shutdown();
      this.processRef.exit(1);
    });

    // 处理未处理的Promise拒绝
    this.processRef.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled promise rejection:', { reason, promise });
      await this.shutdown();
      this.processRef.exit(1);
    });
  }

  /**
   * 初始化应用程序
   */
  async initialize() {
    try {
      this.startTime = Date.now();
      this.logger.info('🚀 Starting PDF Scraper Application...');

      // 1. 创建依赖注入容器
      this.logger.info('📦 Setting up dependency injection container...');
      this.container = await createContainer();

      // 2. 获取配置和服务
      const config = await this.container.get('config');
      const appLogger = await this.container.get('logger');

      // 3. 初始化Python运行器
      this.pythonRunner = new PythonRunner(config, appLogger);

      // 4. 检查Python环境（可选）
      this.logger.info('🐍 Checking Python environment...');
      const pythonCheck = await this.pythonRunner.checkPythonEnvironment();
      if (!pythonCheck.available) {
        this.logger.warn('⚠️ Python environment not available:', pythonCheck.error);
        this.logger.warn('📄 PDF merge functionality will be limited');
      } else {
        this.logger.info('✅ Python environment ready:', pythonCheck.version);
      }

      // 5. 验证容器健康状态
      const health = getContainerHealth(this.container);
      this.logger.info('🏥 Container health check:', health);

      const initTime = Date.now() - this.startTime;
      this.logger.info(`✅ Application initialized successfully in ${initTime}ms`);
    } catch (error) {
      this.logger.error('❌ Failed to initialize application:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 运行爬虫任务
   */
  async runScraping() {
    try {
      this.logger.info('🕷️  Starting web scraping process...');
      const scrapeStartTime = Date.now();

      // 获取必要的服务
      const scraper = await this.container.get('scraper');
      const progressTracker = await this.container.get('progressTracker');
      const fileService = await this.container.get('fileService');
      const config = await this.container.get('config');

      // 清理和准备PDF目录
      this.logger.info('🧹 Preparing PDF directory...');
      // await fileService.cleanDirectory(config.pdfDir); // Don't clean on start to allow resume
      await fileService.ensureDirectory(config.pdfDir);

      // 执行爬虫任务
      await scraper.run();

      // 获取爬虫统计信息
      const stats = progressTracker.getStats();
      const normalizedStats = {
        ...stats,
        succeeded: stats.succeeded ?? stats.completed ?? 0,
      };
      const scrapeTime = Date.now() - scrapeStartTime;

      this.logger.info('✅ Web scraping completed successfully', {
        duration: scrapeTime,
        stats: normalizedStats,
      });

      return {
        success: true,
        duration: scrapeTime,
        stats: normalizedStats,
      };
    } catch (error) {
      this.logger.error('❌ Web scraping failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 运行Python PDF合并
   */
  async runPythonMerge() {
    try {
      this.logger.info('📄 Starting PDF merge process...');
      const mergeStartTime = Date.now();

      const pythonMergeService = await this.container.get('pythonMergeService');

      // 动态获取依赖
      const fs = await import('fs/promises');
      const path = await import('path');
      const config = await this.container.get('config');
      const pdfDir = config.pdfDir || 'pdfs';

      // 为 Python 合并生成完整配置文件（config.json 仅保留公共配置，doc-target 在运行时合并）
      const tempDirectory = path.resolve(config.output?.tempDirectory || '.temp');
      const rootDir = path.resolve(process.cwd());
      if (!tempDirectory.startsWith(rootDir)) {
        throw new Error(`Unsafe temp directory: ${tempDirectory}`);
      }

      await fs.mkdir(tempDirectory, { recursive: true });

      const mergedConfigPath = path.join(
        tempDirectory,
        `merged_config_${process.pid}_${Date.now()}.json`
      );
      await fs.writeFile(mergedConfigPath, JSON.stringify(config, null, 2), 'utf8');

      // 查找PDF源目录（排除finalPdf和metadata）
      let targetDirectory = null;
      try {
        const items = await fs.readdir(pdfDir);
        for (const item of items) {
          const itemPath = path.join(pdfDir, item);
          const stat = await fs.stat(itemPath);
          if (
            stat.isDirectory() &&
            !item.startsWith('finalPdf') &&
            item !== 'metadata' &&
            item !== '.temp'
          ) {
            targetDirectory = item;
            break;
          }
        }
      } catch (error) {
        this.logger.warn('无法读取PDF目录，使用默认合并方式', { error: error.message });
      }

      // 使用新的Python合并服务
      let result;
      try {
        result = await pythonMergeService.mergePDFs(
          targetDirectory
            ? { directory: targetDirectory, config: mergedConfigPath }
            : { config: mergedConfigPath }
        );
      } finally {
        try {
          await fs.unlink(mergedConfigPath);
        } catch {
          // ignore cleanup errors
        }
      }

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

  /**
   * 运行批量PDF生成（跳过Python合并，直接从markdown生成最终PDF）
   */
  async runBatchPdfGeneration() {
    try {
      this.logger.info('📄 Starting batch PDF generation (direct from markdown)...');
      const batchStartTime = Date.now();

      const config = await this.container.get('config');
      const markdownToPdfService = await this.container.get('markdownToPdfService');

      const pdfDir = config.pdfDir || 'pdfs';
      const markdownDir = path.join(pdfDir, config.markdown?.outputDir || 'markdown');

      // Generate output filename
      const url = new URL(config.rootURL);
      const domain = url.hostname.replace(/\./g, '_');
      const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const timestamp = Date.now().toString().slice(-6);

      const finalPdfDir = path.join(pdfDir, config.output?.finalPdfDirectory || 'finalPdf');
      const outputPath = path.join(finalPdfDir, `${domain}_batch_${currentDate}_${timestamp}.pdf`);

      const result = await markdownToPdfService.generateBatchPdf(
        markdownDir,
        outputPath,
        config.markdownPdf || {}
      );

      const batchTime = Date.now() - batchStartTime;

      if (result.success) {
        this.logger.info('✅ Batch PDF generation completed successfully', {
          duration: batchTime,
          outputFile: result.outputPath,
          filesProcessed: result.filesProcessed,
        });
      } else {
        this.logger.error('❌ Batch PDF generation failed');
      }

      return {
        ...result,
        duration: batchTime,
      };
    } catch (error) {
      this.logger.error('❌ Batch PDF generation process failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 运行完整的应用程序流程
   */
  async run() {
    try {
      await this.initialize();

      const totalStartTime = Date.now();
      this.logger.info('🎯 Starting complete PDF scraping and merge workflow...');

      // 1. 执行网页爬虫
      const scrapeResult = await this.runScraping();
      if (!scrapeResult.success) {
        throw new Error(`Scraping failed: ${scrapeResult.error}`);
      }

      // 2. 执行PDF生成（根据配置选择批量模式或Python合并）
      const config = await this.container.get('config');
      const useBatchMode = config.markdownPdf?.batchMode === true;

      let mergeResult;
      if (useBatchMode) {
        this.logger.info('📦 Using batch mode - generating PDF directly from markdown...');
        mergeResult = await this.runBatchPdfGeneration();
      } else {
        this.logger.info('📦 Using standard mode - merging individual PDFs via Python...');
        mergeResult = await this.runPythonMerge();
      }

      if (!mergeResult.success) {
        throw new Error(
          `PDF generation failed: ${mergeResult.error || 'Unknown PDF generation error'}`
        );
      }

      const totalTime = Date.now() - totalStartTime;

      // 生成最终报告
      const finalReport = {
        totalDuration: totalTime,
        scraping: scrapeResult,
        merge: mergeResult,
        batchMode: useBatchMode,
        timestamp: new Date().toISOString(),
      };

      this.logger.info('🎉 Application workflow completed!', finalReport);

      return finalReport;
    } catch (error) {
      this.logger.error('💥 Application workflow failed:', error);
      throw error;
    }
  }

  /**
   * 获取应用程序状态
   */
  getStatus() {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;

    return {
      status: this.isShuttingDown ? 'shutting_down' : 'running',
      uptime,
      startTime: this.startTime,
      containerHealth: this.container ? getContainerHealth(this.container) : null,
      pythonProcesses: this.pythonRunner ? this.pythonRunner.getRunningProcesses() : [],
      memoryUsage: this.processRef.memoryUsage(),
      pid: this.processRef.pid,
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('🧹 Starting application cleanup...');

    try {
      // 1. 停止Python进程
      if (this.pythonRunner) {
        await this.pythonRunner.dispose();
        this.pythonRunner = null;
      }

      // 2. 关闭容器和所有服务
      if (this.container) {
        await shutdownContainer(this.container);
        this.container = null;
      }

      this.logger.info('✅ Application cleanup completed');
    } catch (error) {
      this.logger.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * 优雅关闭
   */
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

  /**
   * 健康检查
   */
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
}

/**
 * 主入口函数
 */
async function main() {
  const app = new Application();

  try {
    // 运行应用程序
    const result = await app.run();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 APPLICATION COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log(`📊 Total Duration: ${result.totalDuration}ms`);
    console.log(`🕷️  Scraping: ${result.scraping.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`📄 PDF Merge: ${result.merge.success ? '✅ Success' : '❌ Failed'}`);
    console.log('='.repeat(60));

    // 优雅关闭
    await app.shutdown();

    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('💥 APPLICATION FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('='.repeat(60));

    // 确保清理资源
    await app.cleanup();

    process.exit(1);
  }
}

// 导出应用程序类和主函数
export { Application, main };

// 如果直接运行此文件，执行主函数
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const appFilePath = path.resolve(process.cwd(), 'src/app.js');

if (entryFilePath === appFilePath) {
  main().catch(console.error);
}
