import Container from './container.js';
import { createLogger } from '../utils/logger.js';
import { validateConfig } from '../config/configValidator.js';

// 导入所有服务类
import { ConfigLoader } from '../config/configLoader.js';
import { FileService } from '../services/fileService.js';
import { PathService } from '../services/pathService.js';
import { MetadataService } from '../services/metadataService.js';
import { StateManager } from '../services/stateManager.js';
import { ProgressTracker } from '../services/progressTracker.js';
import { QueueManager } from '../services/queueManager.js';
import { BrowserPool } from '../services/browserPool.js';
import { PageManager } from '../services/pageManager.js';
import { ImageService } from '../services/imageService.js';
import { PDFStyleService } from '../services/pdfStyleService.js';
import { TranslationService } from '../services/translationService.js';
import { MarkdownService } from '../services/markdownService.js';
import { PandocPdfService } from '../services/pandocPdfService.js';
import { Scraper } from './scraper.js';
import { PythonMergeService } from '../services/PythonMergeService.js';

/**
 * 设置依赖注入容器
 * @returns {Promise<Container>} 配置好的容器实例
 */
async function setupContainer() {
  const container = new Container();
  const logger = createLogger('Setup');

  try {
    logger.info('Setting up dependency injection container...');

    // 1. 注册基础服务（无依赖）

    // 配置服务
    container.register(
      'config',
      async () => {
        const configLoader = new ConfigLoader();
        const config = await configLoader.load();

        // 验证配置
        validateConfig(config);

        logger.info('Configuration loaded and validated');
        return config;
      },
      {
        singleton: true,
        dependencies: [],
        lifecycle: 'singleton',
      }
    );

    // 日志服务
    container.register(
      'logger',
      () => {
        return createLogger('App');
      },
      {
        singleton: true,
        dependencies: [],
        lifecycle: 'singleton',
      }
    );

    // 2. 注册文件操作层服务

    // 文件服务
    container.register(
      'fileService',
      (logger) => {
        return new FileService(logger); // 修正：FileService 构造函数只需要 logger
      },
      {
        singleton: true,
        dependencies: ['logger'],
        lifecycle: 'singleton',
      }
    );

    // 路径服务
    container.register(
      'pathService',
      (config) => {
        return new PathService(config); // 修正：PathService 构造函数只需要 config
      },
      {
        singleton: true,
        dependencies: ['config'],
        lifecycle: 'singleton',
      }
    );

    // 3. 注册元数据服务
    container.register(
      'metadataService',
      (fileService, pathService, logger) => {
        return new MetadataService(fileService, pathService, logger);
      },
      {
        singleton: true,
        dependencies: ['fileService', 'pathService', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 4. 注册数据管理层服务

    // 状态管理器
    container.register(
      'stateManager',
      async (fileService, pathService, logger) => {
        const stateManager = new StateManager(fileService, pathService, logger);
        await stateManager.load();
        return stateManager;
      },
      {
        singleton: true,
        dependencies: ['fileService', 'pathService', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 进度跟踪器
    container.register(
      'progressTracker',
      (logger) => {
        return new ProgressTracker(logger);
      },
      {
        singleton: true,
        dependencies: ['logger'],
        lifecycle: 'singleton',
      }
    );

    // 队列管理器
    container.register(
      'queueManager',
      (config, logger) => {
        const queueTimeout = config.queue?.timeout || config.pageTimeout || 30000;
        return new QueueManager({
          concurrency: config.concurrency || 5,
          // p-queue requires a positive finite timeout.
          timeout: queueTimeout,
          logger,
        });
      },
      {
        singleton: true,
        dependencies: ['config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 5. 注册浏览器管理层服务

    // 浏览器池
    container.register(
      'browserPool',
      async (config, logger) => {
        const browserPool = new BrowserPool({
          maxBrowsers: config.concurrency || 5,
          headless: true,
          logger,
        });
        await browserPool.initialize();
        return browserPool;
      },
      {
        singleton: true,
        dependencies: ['config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 页面管理器
    container.register(
      'pageManager',
      (browserPool, config, logger) => {
        return new PageManager(browserPool, {
          logger,
          userAgent: config.browser?.userAgent,
          ...config.browser,
        });
      },
      {
        singleton: true,
        dependencies: ['browserPool', 'config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 6. 注册图片处理层服务

    // 图片服务
    container.register(
      'imageService',
      (config, logger) => {
        return new ImageService({
          defaultTimeout: config.imageTimeout || 15000,
          logger,
        });
      },
      {
        singleton: true,
        dependencies: ['config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // PDF样式服务
    container.register(
      'pdfStyleService',
      (config) => {
        const pdfConfig = config.pdf || {};
        return new PDFStyleService({
          theme: pdfConfig.theme || 'light',
          preserveCodeHighlighting: pdfConfig.preserveCodeHighlighting !== false,
          enableCodeWrap: pdfConfig.enableCodeWrap !== false,
          fontSize: pdfConfig.fontSize || '14px',
          fontFamily: pdfConfig.fontFamily || 'system-ui, -apple-system, sans-serif',
          codeFont:
            pdfConfig.codeFont || 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
          removeSelectors: config.removeSelectors || [],
        });
      },
      {
        singleton: true,
        dependencies: ['config'],
        lifecycle: 'singleton',
      }
    );

    // 翻译服务
    container.register(
      'translationService',
      (config, pathService, logger) => {
        return new TranslationService({
          config,
          pathService,
          logger,
        });
      },
      {
        singleton: true,
        dependencies: ['config', 'pathService', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // Markdown 服务
    container.register(
      'markdownService',
      (config, logger) => {
        return new MarkdownService({ config, logger });
      },
      {
        singleton: true,
        dependencies: ['config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // Markdown 转 PDF 服务 - 使用 Pandoc 以获得更好的 CJK 支持
    container.register(
      'markdownToPdfService',
      (config, logger, metadataService) => {
        return new PandocPdfService({ config, logger, metadataService });
      },
      {
        singleton: true,
        dependencies: ['config', 'logger', 'metadataService'],
        lifecycle: 'singleton',
      }
    );

    // 7. 注册核心爬虫服务

    // 爬虫服务 - 修复依赖注入
    container.register(
      'scraper',
      async (
        config,
        logger,
        browserPool, // 添加 browserPool
        pageManager,
        fileService,
        pathService,
        metadataService, // 添加 metadataService
        stateManager,
        progressTracker,
        queueManager,
        imageService,
        pdfStyleService, // 添加 pdfStyleService
        translationService, // 添加 translationService
        markdownService,
        markdownToPdfService
      ) => {
        const scraper = new Scraper({
          config,
          logger,
          browserPool, // 传递 browserPool
          pageManager,
          fileService,
          pathService,
          metadataService, // 传递 metadataService
          stateManager,
          progressTracker,
          queueManager,
          imageService,
          pdfStyleService, // 传递 pdfStyleService
          translationService, // 传递 translationService
          markdownService,
          markdownToPdfService,
        });

        await scraper.initialize();
        return scraper;
      },
      {
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
      }
    );

    // 8. 注册Python集成服务

    // Python合并服务
    container.register(
      'pythonMergeService',
      (config, logger) => {
        return new PythonMergeService(config, logger);
      },
      {
        singleton: true,
        dependencies: ['config', 'logger'],
        lifecycle: 'singleton',
      }
    );

    // 验证依赖关系
    container.validateDependencies();

    // 预加载关键服务
    logger.info('Pre-loading critical services...');
    await container.get('config');
    await container.get('logger');
    await container.get('fileService');
    await container.get('pathService');

    logger.info('Container setup completed successfully');

    // 输出容器统计信息
    const stats = container.getStats();
    logger.info('Container statistics:', stats);

    return container;
  } catch (error) {
    logger.error('Failed to setup container:', error);

    // 清理资源
    try {
      await container.dispose();
    } catch (disposeError) {
      logger.error('Error disposing container during setup failure:', disposeError);
    }

    throw error;
  }
}

/**
 * 创建预配置的容器实例
 * @returns {Promise<Container>} 配置好的容器实例
 */
async function createContainer() {
  return await setupContainer();
}

/**
 * 获取容器健康检查信息
 * @param {Container} container - 容器实例
 * @returns {Object} 健康检查结果
 */
function getContainerHealth(container) {
  return container.getHealth();
}

/**
 * 安全地关闭容器
 * @param {Container} container - 容器实例
 */
async function shutdownContainer(container) {
  const logger = createLogger('Shutdown');

  try {
    logger.info('Shutting down container...');
    await container.dispose();
    logger.info('Container shutdown completed');
  } catch (error) {
    logger.error('Error during container shutdown:', error);
    throw error;
  }
}

export { setupContainer, createContainer, getContainerHealth, shutdownContainer };
