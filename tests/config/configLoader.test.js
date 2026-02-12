import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/config/configLoader.test.js
import { ConfigLoader, loadConfig, createConfigLoader } from '../../src/config/configLoader.js';
import fs from 'fs';
import path from 'path';

// Mock dependencies
vi.mock('fs', () => {
  const mockFs = {
    promises: {
      readFile: vi.fn(),
      access: vi.fn(),
      stat: vi.fn(),
    },
    constants: {
      R_OK: 4,
    },
  };

  return {
    default: mockFs,
    ...mockFs,
  };
});

vi.mock('../../src/config/configValidator.js', () => ({
  validateConfig: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import mocked modules
import { validateConfig } from '../../src/config/configValidator.js';
import { createLogger } from '../../src/utils/logger.js';

describe('ConfigLoader', () => {
  let configLoader;
  let mockLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createLogger();
    configLoader = new ConfigLoader();
  });

  describe('constructor', () => {
    test('应该使用默认配置路径', () => {
      const loader = new ConfigLoader();
      expect(loader.configPath).toBe(path.join(process.cwd(), 'config.json'));
      expect(loader.config).toBeNull();
      expect(loader.loaded).toBe(false);
    });

    test('应该使用提供的配置路径', () => {
      const customPath = '/custom/path/config.json';
      const loader = new ConfigLoader(customPath);
      expect(loader.configPath).toBe(customPath);
    });
  });

  describe('load', () => {
    const mockConfigData = {
      rootURL: 'https://example.com',
      pdfDir: './pdfs',
      navLinksSelector: 'nav a',
      contentSelector: 'main',
    };

    beforeEach(() => {
      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfigData));
      validateConfig.mockReturnValue({
        config: { ...mockConfigData, processed: true },
      });
    });

    test('应该成功加载和验证配置', async () => {
      const config = await configLoader.load();

      expect(fs.promises.access).toHaveBeenCalledWith(configLoader.configPath, fs.constants.R_OK);
      expect(fs.promises.stat).toHaveBeenCalledWith(configLoader.configPath);
      expect(fs.promises.readFile).toHaveBeenCalledWith(configLoader.configPath, 'utf8');
      expect(validateConfig).toHaveBeenCalled();
      expect(config.processed).toBe(true);
      expect(configLoader.loaded).toBe(true);
    });

    test('应该处理配置文件不存在', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.promises.access.mockRejectedValue(error);

      await expect(configLoader.load()).rejects.toThrow(
        `Configuration file not found: ${configLoader.configPath}`
      );
    });

    test('应该处理配置文件不可读', async () => {
      const error = new Error('EACCES');
      error.code = 'EACCES';
      fs.promises.access.mockRejectedValue(error);

      await expect(configLoader.load()).rejects.toThrow(
        `Configuration file is not readable: ${configLoader.configPath}`
      );
    });

    test('应该处理非文件路径', async () => {
      fs.promises.stat.mockResolvedValue({ isFile: () => false });

      await expect(configLoader.load()).rejects.toThrow(
        `Configuration path is not a file: ${configLoader.configPath}`
      );
    });

    test('应该处理JSON解析错误', async () => {
      fs.promises.readFile.mockResolvedValue('invalid json');

      await expect(configLoader.load()).rejects.toThrow('Configuration loading failed:');
    });

    test('应该处理验证错误', async () => {
      validateConfig.mockImplementation(() => {
        throw new Error('Validation failed');
      });

      await expect(configLoader.load()).rejects.toThrow(
        'Configuration loading failed: Validation failed'
      );
    });

    test('应该根据 docTarget 合并 doc-targets 配置', async () => {
      const baseConfig = {
        docTarget: 'claude-code',
        pdfDir: 'pdfs',
        concurrency: 5,
      };
      const targetConfig = {
        rootURL: 'https://example.com',
        baseUrl: 'https://example.com',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      const targetPath = path.resolve(process.cwd(), 'doc-targets', 'claude-code.json');

      fs.promises.readFile.mockImplementation(async (filePath) => {
        if (filePath === configLoader.configPath) {
          return JSON.stringify(baseConfig);
        }
        if (filePath === targetPath) {
          return JSON.stringify(targetConfig);
        }
        throw new Error(`Unexpected readFile: ${filePath}`);
      });

      validateConfig.mockImplementation((config) => ({ config }));

      const config = await configLoader.load();

      expect(config.docTarget).toBe('claude-code');
      expect(config.rootURL).toBe('https://example.com');
      expect(config.baseUrl).toBe('https://example.com');
      expect(config.navLinksSelector).toBe('nav a');
      expect(config.contentSelector).toBe('main');
      expect(config.pdfDir).toBe(path.resolve(process.cwd(), 'pdfs'));
      expect(config.allowedDomains).toContain('example.com');
    });

    test('应该支持 openclaw 别名并合并 openclaw-zh-cn 配置', async () => {
      const baseConfig = {
        docTarget: 'openclaw',
        pdfDir: 'pdfs',
        concurrency: 5,
      };
      const targetConfig = {
        rootURL: 'https://docs.openclaw.ai/zh-CN',
        baseUrl: 'https://docs.openclaw.ai/zh-CN',
        navLinksSelector: 'nav a',
        contentSelector: '#content-area',
      };

      const targetPath = path.resolve(process.cwd(), 'doc-targets', 'openclaw-zh-cn.json');
      const directPath = path.resolve(process.cwd(), 'doc-targets', 'openclaw.json');

      fs.promises.access.mockImplementation(async (filePath) => {
        if (filePath === configLoader.configPath || filePath === targetPath) {
          return;
        }
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      });

      fs.promises.stat.mockImplementation(async (filePath) => {
        if (filePath === configLoader.configPath || filePath === targetPath) {
          return { isFile: () => true };
        }
        if (filePath === directPath) {
          const error = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        return { isFile: () => true };
      });

      fs.promises.readFile.mockImplementation(async (filePath) => {
        if (filePath === configLoader.configPath) {
          return JSON.stringify(baseConfig);
        }
        if (filePath === targetPath) {
          return JSON.stringify(targetConfig);
        }
        throw new Error(`Unexpected readFile: ${filePath}`);
      });

      validateConfig.mockImplementation((config) => ({ config }));

      const config = await configLoader.load();

      expect(config.docTarget).toBe('openclaw');
      expect(config.rootURL).toBe('https://docs.openclaw.ai/zh-CN');
      expect(config.baseUrl).toBe('https://docs.openclaw.ai/zh-CN');
      expect(config.navLinksSelector).toBe('nav a');
      expect(config.contentSelector).toBe('#content-area');
      expect(config.pdfDir).toBe(path.resolve(process.cwd(), 'pdfs'));
      expect(config.allowedDomains).toContain('docs.openclaw.ai');
    });
  });

  describe('processConfig', () => {
    test('应该处理路径配置', async () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: 'relative/path',
        filesystem: {
          tempDirectory: 'temp',
          metadataDirectory: 'metadata',
        },
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));

      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      const processedConfig = configLoader.config;
      expect(path.isAbsolute(processedConfig.pdfDir)).toBe(true);
      expect(path.isAbsolute(processedConfig.filesystem.tempDirectory)).toBe(true);
      expect(path.isAbsolute(processedConfig.filesystem.metadataDirectory)).toBe(true);
    });

    test('应该从URL提取域名', async () => {
      const config = {
        rootURL: 'https://docs.example.com/guide',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));

      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      const processedConfig = configLoader.config;
      expect(processedConfig.allowedDomains).toContain('docs.example.com');
      expect(processedConfig.allowedDomains).toContain('example.com');
    });

    test('应该添加运行时信息', async () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));

      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      const processedConfig = configLoader.config;
      expect(processedConfig._runtime).toBeDefined();
      expect(processedConfig._runtime.configPath).toBe(configLoader.configPath);
      expect(processedConfig._runtime.loadTime).toBeDefined();
      expect(processedConfig._runtime.nodeVersion).toBe(process.version);
      expect(processedConfig._runtime.platform).toBe(process.platform);
    });

    test('应该处理已存在的allowedDomains', async () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        allowedDomains: ['custom.com'],
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));

      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      const processedConfig = configLoader.config;
      expect(processedConfig.allowedDomains).toEqual(['custom.com']);
    });
  });

  describe('get', () => {
    test('应该返回已加载的配置', async () => {
      const mockConfig = { test: 'config' };
      configLoader.config = mockConfig;
      configLoader.loaded = true;

      expect(configLoader.get()).toBe(mockConfig);
    });

    test('应该在未加载时抛出错误', () => {
      expect(() => configLoader.get()).toThrow(
        'Configuration not loaded. Call load() method first.'
      );
    });
  });

  describe('getValue', () => {
    beforeEach(() => {
      configLoader.config = {
        rootURL: 'https://example.com',
        browser: {
          headless: true,
          viewport: {
            width: 1920,
            height: 1080,
          },
        },
        pdf: {
          format: 'A4',
        },
      };
      configLoader.loaded = true;
    });

    test('应该获取顶层配置值', () => {
      expect(configLoader.getValue('rootURL')).toBe('https://example.com');
    });

    test('应该获取嵌套配置值', () => {
      expect(configLoader.getValue('browser.headless')).toBe(true);
      expect(configLoader.getValue('browser.viewport.width')).toBe(1920);
    });

    test('应该为不存在的键返回默认值', () => {
      expect(configLoader.getValue('nonexistent', 'default')).toBe('default');
      expect(configLoader.getValue('browser.nonexistent', 'default')).toBe('default');
    });

    test('应该在未加载时抛出错误', () => {
      configLoader.loaded = false;
      expect(() => configLoader.getValue('any')).toThrow(
        'Configuration not loaded. Call load() method first.'
      );
    });

    test('应该处理undefined默认值', () => {
      expect(configLoader.getValue('nonexistent')).toBeUndefined();
    });
  });

  describe('isLoaded', () => {
    test('应该返回加载状态', () => {
      expect(configLoader.isLoaded()).toBe(false);

      configLoader.loaded = true;
      expect(configLoader.isLoaded()).toBe(true);
    });
  });

  describe('reload', () => {
    test('应该重新加载配置', async () => {
      const mockConfigData = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfigData));
      validateConfig.mockReturnValue({ config: mockConfigData });

      configLoader.config = { old: 'config' };
      configLoader.loaded = true;

      const result = await configLoader.reload();

      expect(configLoader.config).toEqual(mockConfigData);
      expect(configLoader.loaded).toBe(true);
      expect(result).toEqual(mockConfigData);
    });
  });

  describe('getSummary', () => {
    test('应该返回未加载状态的摘要', () => {
      const summary = configLoader.getSummary();

      expect(summary).toEqual({
        loaded: false,
        configPath: configLoader.configPath,
      });
    });

    test('应该返回已加载配置的摘要', () => {
      configLoader.config = {
        rootURL: 'https://example.com',
        pdfDir: '/path/to/pdfs',
        concurrency: 5,
        allowedDomains: ['example.com'],
        logLevel: 'info',
        _runtime: {
          loadTime: '2024-03-15T10:00:00Z',
        },
      };
      configLoader.loaded = true;

      const summary = configLoader.getSummary();

      expect(summary).toEqual({
        loaded: true,
        configPath: configLoader.configPath,
        rootURL: 'https://example.com',
        pdfDir: '/path/to/pdfs',
        concurrency: 5,
        allowedDomains: ['example.com'],
        logLevel: 'info',
        loadTime: '2024-03-15T10:00:00Z',
      });
    });
  });

  describe('resolvePath', () => {
    test('应该保持绝对路径不变', async () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: '/absolute/path',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));
      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      expect(configLoader.config.pdfDir).toBe('/absolute/path');
    });

    test('应该相对于配置文件目录解析相对路径', async () => {
      configLoader = new ConfigLoader('/custom/config/app.json');

      const config = {
        rootURL: 'https://example.com',
        pdfDir: './output',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));
      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      expect(configLoader.config.pdfDir).toBe(path.resolve('/custom/config', './output'));
    });
  });

  describe('extractDomainsFromUrl', () => {
    test('应该处理无效的URL', async () => {
      const config = {
        rootURL: 'invalid-url',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(config));
      validateConfig.mockImplementation((config) => ({ config }));

      await configLoader.load();

      expect(configLoader.config.allowedDomains).toEqual([]);
    });
  });
});

describe('便捷函数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadConfig', () => {
    test('应该创建加载器并返回配置', async () => {
      const mockConfig = { test: 'config' };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      validateConfig.mockReturnValue({ config: mockConfig });

      const result = await loadConfig('/custom/config.json');

      expect(result).toEqual(mockConfig);
    });

    test('应该使用默认路径', async () => {
      const mockConfig = { test: 'config' };

      fs.promises.access.mockResolvedValue();
      fs.promises.stat.mockResolvedValue({ isFile: () => true });
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      validateConfig.mockReturnValue({ config: mockConfig });

      await loadConfig();

      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join(process.cwd(), 'config.json'),
        'utf8'
      );
    });
  });

  describe('createConfigLoader', () => {
    test('应该创建ConfigLoader实例', () => {
      const loader = createConfigLoader('/custom/config.json');

      expect(loader).toBeInstanceOf(ConfigLoader);
      expect(loader.configPath).toBe('/custom/config.json');
    });

    test('应该使用默认路径创建实例', () => {
      const loader = createConfigLoader();

      expect(loader).toBeInstanceOf(ConfigLoader);
      expect(loader.configPath).toBe(path.join(process.cwd(), 'config.json'));
    });
  });
});
