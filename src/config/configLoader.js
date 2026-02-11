import fs from 'fs';
import path from 'path';
import { validateConfig } from './configValidator.js';
import { createLogger } from '../utils/logger.js';

const DOC_TARGETS = {
  openai: 'openai-docs.json',
  openclaw: 'openclaw-zh-cn.json',
  'claude-code': 'claude-code.json',
  'cloudflare-blog': 'cloudflare-blog.json',
  'anthropic-research': 'anthropic-research.json',
  'claude-blog': 'claude-blog.json',
};

/**
 * 配置加载器类
 * 负责加载、验证和管理应用程序配置
 */
class ConfigLoader {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(process.cwd(), 'config.json');
    this.config = null;
    this.logger = createLogger('ConfigLoader');
    this.loaded = false;
  }

  /**
   * 加载配置文件
   * @returns {Promise<Object>} 验证后的配置对象
   */
  async load() {
    try {
      this.logger.info(`Loading configuration from: ${this.configPath}`);

      // 检查配置文件是否存在
      await this.validateConfigFile();

      // 读取配置文件
      const rawConfig = await fs.promises.readFile(this.configPath, 'utf8');
      const parsedConfig = JSON.parse(rawConfig);

      this.logger.debug('Raw configuration loaded:', parsedConfig);

      // 合并 doc-target 配置（如果配置了 docTarget 或环境变量 DOC_TARGET）
      const mergedConfig = await this.applyDocTargetConfig(parsedConfig);

      // 处理配置
      const processedConfig = await this.processConfig(mergedConfig);

      // 验证配置
      const validationResult = validateConfig(processedConfig);
      this.config = validationResult.config;
      this.loaded = true;

      this.logger.info('Configuration loaded and validated successfully');
      this.logger.debug('Final configuration:', this.config);

      return this.config;
    } catch (error) {
      this.logger.error('Failed to load configuration:', error);
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  /**
   * 验证配置文件存在性和可读性
   * @private
   */
  async validateConfigFile() {
    try {
      await fs.promises.access(this.configPath, fs.constants.R_OK);

      const stats = await fs.promises.stat(this.configPath);
      if (!stats.isFile()) {
        throw new Error(`Configuration path is not a file: ${this.configPath}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${this.configPath}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Configuration file is not readable: ${this.configPath}`);
      }
      throw error;
    }
  }

  /**
   * 处理配置数据
   * @private
   */
  async processConfig(config) {
    const processedConfig = { ...config };

    try {
      // 1. 处理路径配置
      processedConfig.pdfDir = this.resolvePath(config.pdfDir);

      // 处理其他可能的路径配置
      if (config.filesystem?.tempDirectory) {
        processedConfig.filesystem.tempDirectory = this.resolvePath(
          config.filesystem.tempDirectory
        );
      }

      if (config.filesystem?.metadataDirectory) {
        processedConfig.filesystem.metadataDirectory = this.resolvePath(
          config.filesystem.metadataDirectory
        );
      }

      // 2. 处理域名配置
      if (!processedConfig.allowedDomains || processedConfig.allowedDomains.length === 0) {
        processedConfig.allowedDomains = this.extractDomainsFromUrl(config.rootURL);
      }

      // 3. 处理浏览器配置
      if (!processedConfig.browser) {
        processedConfig.browser = {};
      }

      // 4. 处理Python配置
      if (!processedConfig.python) {
        processedConfig.python = {};
      }

      // 5. 添加运行时配置
      processedConfig._runtime = {
        configPath: this.configPath,
        loadTime: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
      };

      return processedConfig;
    } catch (error) {
      this.logger.error('Error processing configuration:', error);
      throw new Error(`Configuration processing failed: ${error.message}`);
    }
  }

  /**
   * 合并 doc-target 配置（doc-targets/*.json）到基础配置
   * @private
   */
  async applyDocTargetConfig(baseConfig) {
    const envDocTarget = process.env.DOC_TARGET ? String(process.env.DOC_TARGET).trim() : '';
    const docTarget = envDocTarget || baseConfig?.docTarget;

    if (!docTarget) {
      return baseConfig;
    }

    if (typeof docTarget !== 'string' || docTarget.trim().length === 0) {
      throw new Error('Invalid docTarget: expected a non-empty string');
    }

    const targetPath = await this.resolveDocTargetConfigPath(docTarget.trim());
    const targetConfig = await this.readJsonFile(targetPath);

    this.logger.info('Applying doc-target configuration', {
      docTarget,
      targetPath,
    });

    return this.deepMerge(baseConfig, targetConfig);
  }

  /**
   * 解析 docTarget 对应的配置文件路径
   * @private
   */
  async resolveDocTargetConfigPath(docTarget) {
    const configDir = path.dirname(this.configPath);
    const targetsDir = path.resolve(configDir, 'doc-targets');

    const looksLikePath =
      docTarget.includes('/') || docTarget.includes('\\') || docTarget.endsWith('.json');

    if (looksLikePath) {
      const resolvedPath = path.isAbsolute(docTarget)
        ? docTarget
        : path.resolve(configDir, docTarget);
      this.assertPathInsideConfigDir(resolvedPath);
      return resolvedPath;
    }

    // 1) 允许 docTarget 直接对应 doc-targets/<name>.json
    const directPath = path.resolve(targetsDir, `${docTarget}.json`);
    if (await this.isReadableFile(directPath)) {
      return directPath;
    }

    // 2) 向后兼容：使用预定义映射（如 openai -> openai-docs.json）
    const mapped = DOC_TARGETS[docTarget];
    if (mapped) {
      const mappedPath = path.resolve(targetsDir, mapped);
      if (await this.isReadableFile(mappedPath)) {
        return mappedPath;
      }
    }

    throw new Error(`Doc target config not found for: ${docTarget}`);
  }

  /**
   * 确保路径在 config.json 所在目录内（防止路径遍历）
   * @private
   */
  assertPathInsideConfigDir(targetPath) {
    const configDir = path.resolve(path.dirname(this.configPath));
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(configDir, resolvedTarget);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Unsafe doc target path (outside config dir): ${targetPath}`);
    }
  }

  /**
   * 判断文件是否可读且为普通文件
   * @private
   */
  async isReadableFile(filePath) {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      const stats = await fs.promises.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 读取并解析 JSON 文件
   * @private
   */
  async readJsonFile(filePath) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
  }

  /**
   * 深度合并对象：对象递归合并，数组/基本类型覆盖
   * @private
   */
  deepMerge(target, source) {
    if (!target || typeof target !== 'object') target = {};
    if (!source || typeof source !== 'object') return target;

    const result = { ...target };

    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepMerge(result[key] || {}, value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 解析路径为绝对路径
   * @private
   */
  resolvePath(inputPath) {
    if (!inputPath) {
      return inputPath;
    }

    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }

    // 相对于配置文件目录解析
    const configDir = path.dirname(this.configPath);
    return path.resolve(configDir, inputPath);
  }

  /**
   * 从URL提取域名
   * @private
   */
  extractDomainsFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // 添加主域名和相关子域名
      const domains = [hostname];

      // 如果是子域名，也添加主域名
      const parts = hostname.split('.');
      if (parts.length > 2) {
        const mainDomain = parts.slice(-2).join('.');
        if (!domains.includes(mainDomain)) {
          domains.push(mainDomain);
        }
      }

      this.logger.debug(`Extracted domains from ${url}:`, domains);
      return domains;
    } catch (error) {
      this.logger.warn(`Failed to extract domain from URL ${url}:`, error);
      return [];
    }
  }

  /**
   * 获取配置对象
   * @returns {Object} 配置对象
   */
  get() {
    if (!this.loaded || !this.config) {
      throw new Error('Configuration not loaded. Call load() method first.');
    }
    return this.config;
  }

  /**
   * 获取配置的特定部分
   * @param {string} key - 配置键名，支持点分隔的路径
   * @param {*} defaultValue - 默认值
   * @returns {*} 配置值
   */
  getValue(key, defaultValue = undefined) {
    if (!this.loaded || !this.config) {
      throw new Error('Configuration not loaded. Call load() method first.');
    }

    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 检查配置是否已加载
   * @returns {boolean}
   */
  isLoaded() {
    return this.loaded;
  }

  /**
   * 重新加载配置
   * @returns {Promise<Object>}
   */
  async reload() {
    this.logger.info('Reloading configuration...');
    this.config = null;
    this.loaded = false;
    return await this.load();
  }

  /**
   * 获取配置摘要信息
   * @returns {Object}
   */
  getSummary() {
    if (!this.loaded || !this.config) {
      return {
        loaded: false,
        configPath: this.configPath,
      };
    }

    return {
      loaded: true,
      configPath: this.configPath,
      rootURL: this.config.rootURL,
      pdfDir: this.config.pdfDir,
      concurrency: this.config.concurrency,
      allowedDomains: this.config.allowedDomains,
      logLevel: this.config.logLevel,
      loadTime: this.config._runtime?.loadTime,
    };
  }
}

/**
 * 便捷函数：加载配置
 * @param {string} configPath - 配置文件路径
 * @returns {Promise<Object>} 配置对象
 */
async function loadConfig(configPath = null) {
  const loader = new ConfigLoader(configPath);
  return await loader.load();
}

/**
 * 便捷函数：创建配置加载器实例
 * @param {string} configPath - 配置文件路径
 * @returns {ConfigLoader} 配置加载器实例
 */
function createConfigLoader(configPath = null) {
  return new ConfigLoader(configPath);
}

export { ConfigLoader, loadConfig, createConfigLoader };
