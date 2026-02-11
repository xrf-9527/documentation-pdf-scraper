// tests/config/configValidator.test.js
import {
  validateConfig,
  validateConfigAsync,
  validatePartialConfig,
  getConfigSchema,
  getDefaultConfig,
  ValidationError,
} from '../../src/config/configValidator.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('ConfigValidator', () => {
  describe('validateConfig', () => {
    test('应该验证有效的最小配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.config).toBeDefined();
      expect(result.config.rootURL).toBe('https://example.com');
    });

    test('应该验证 navExcludeSelector 配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        navExcludeSelector: '.nav-tabs, [role=tablist]',
        contentSelector: 'main',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.config.navExcludeSelector).toBe('.nav-tabs, [role=tablist]');
    });

    test('navExcludeSelector 应该 trim 并将空值视为关闭', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        navExcludeSelector: '   ',
        contentSelector: 'main',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.config.navExcludeSelector).toBe('');
    });

    test('应该为缺少的必需字段返回错误', () => {
      const config = {
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      expect(() => validateConfig(config)).toThrow(ValidationError);
    });

    test('应该验证URL格式', () => {
      const config = {
        rootURL: 'not-a-valid-url',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      expect(() => validateConfig(config)).toThrow(ValidationError);
    });

    test('应该应用默认值', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      const result = validateConfig(config);

      expect(result.config.concurrency).toBe(5);
      expect(result.config.screenshotDelay).toBe(500);
      expect(result.config.maxRetries).toBe(3);
      expect(result.config.retryDelay).toBe(1000);
      expect(result.config.pageTimeout).toBe(30000);
      expect(result.config.logLevel).toBe('info');
    });

    test('应该验证数字范围', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        concurrency: 15, // 超过最大值10
      };

      expect(() => validateConfig(config)).toThrow(ValidationError);
    });

    test('应该验证浏览器配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        browser: {
          headless: false,
          slowMo: 100,
          viewport: {
            width: 1280,
            height: 720,
          },
        },
      };

      const result = validateConfig(config);

      expect(result.config.browser.headless).toBe(false);
      expect(result.config.browser.slowMo).toBe(100);
      expect(result.config.browser.viewport.width).toBe(1280);
    });

    test('应该验证PDF配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        pdf: {
          engine: 'puppeteer',
          format: 'A3',
          margin: {
            top: '2cm',
            bottom: '2cm',
          },
          quality: 'high',
        },
      };

      const result = validateConfig(config);

      expect(result.config.pdf.engine).toBe('puppeteer');
      expect(result.config.pdf.format).toBe('A3');
      expect(result.config.pdf.margin.top).toBe('2cm');
      expect(result.config.pdf.quality).toBe('high');
    });

    test('应该拒绝无效的PDF引擎', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        pdf: {
          engine: 'invalid-engine',
        },
      };

      expect(() => validateConfig(config)).toThrow(ValidationError);
    });

    test('应该只接受puppeteer作为PDF引擎', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        pdf: {
          engine: 'puppeteer',
        },
      };

      const result = validateConfig(config);
      expect(result.config.pdf.engine).toBe('puppeteer');
    });

    test('应该验证Python配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        python: {
          executable: '/usr/bin/python3',
          timeout: 120000,
          env: {
            PYTHONPATH: '/custom/path',
          },
        },
      };

      const result = validateConfig(config);

      expect(result.config.python.executable).toBe('/usr/bin/python3');
      expect(result.config.python.timeout).toBe(120000);
      expect(result.config.python.env.PYTHONPATH).toBe('/custom/path');
    });

    test('应该处理baseUrl配置', () => {
      const config = {
        rootURL: 'https://example.com/docs',
        baseUrl: 'https://example.com/docs/api',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      const result = validateConfig(config);

      expect(result.config.baseUrl).toBe('https://example.com/docs/api');
    });

    test('应该验证状态管理配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        state: {
          saveInterval: 60000,
          backupCount: 5,
          autoSave: false,
        },
      };

      const result = validateConfig(config);

      expect(result.config.state.saveInterval).toBe(60000);
      expect(result.config.state.backupCount).toBe(5);
      expect(result.config.state.autoSave).toBe(false);
    });

    test('应该验证网络配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        network: {
          requestTimeout: 60000,
          maxRedirects: 10,
          retryOn429: false,
        },
      };

      const result = validateConfig(config);

      expect(result.config.network.requestTimeout).toBe(60000);
      expect(result.config.network.maxRedirects).toBe(10);
      expect(result.config.network.retryOn429).toBe(false);
    });

    test('应该验证翻译配置并应用默认值', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        translation: {
          enabled: true,
        },
      };

      const result = validateConfig(config);

      expect(result.config.translation.enabled).toBe(true);
      expect(result.config.translation.maxSegmentRetries).toBe(2);
      expect(result.config.translation.maxDelay).toBe(30000);
      expect(result.config.translation.jitterStrategy).toBe('decorrelated');
    });

    test('应该保留自定义翻译重试配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        translation: {
          enabled: true,
          maxSegmentRetries: 5,
          maxDelay: 10000,
          jitterStrategy: 'full',
        },
      };

      const result = validateConfig(config);

      expect(result.config.translation.enabled).toBe(true);
      expect(result.config.translation.maxSegmentRetries).toBe(5);
      expect(result.config.translation.maxDelay).toBe(10000);
      expect(result.config.translation.jitterStrategy).toBe('full');
    });

    test('应该验证 markdownSource 配置', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        markdownSource: {
          enabled: true,
          urlSuffix: '.md',
        },
      };

      const result = validateConfig(config);

      expect(result.config.markdownSource.enabled).toBe(true);
      expect(result.config.markdownSource.urlSuffix).toBe('.md');
    });

    test('markdownSource 应该应用默认 urlSuffix', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        markdownSource: {
          enabled: true,
        },
      };

      const result = validateConfig(config);

      expect(result.config.markdownSource.enabled).toBe(true);
      expect(result.config.markdownSource.urlSuffix).toBe('.md');
    });

    test('应该剥离未知字段', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        unknownField: 'should be removed',
      };

      const result = validateConfig(config);

      expect(result.config.unknownField).toBeUndefined();
    });

    test('应该允许未知字段当选项指定时', () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        customField: 'keep this',
      };

      const result = validateConfig(config, { allowUnknown: true, stripUnknown: false });

      expect(result.config.customField).toBe('keep this');
    });
  });

  describe('validateConfigAsync', () => {
    test('应该异步验证配置', async () => {
      const config = {
        rootURL: 'https://example.com',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      const result = await validateConfigAsync(config);

      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
    });

    test('应该异步处理验证错误', async () => {
      const config = {
        rootURL: 'invalid-url',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
      };

      await expect(validateConfigAsync(config)).rejects.toThrow(ValidationError);
    });
  });

  describe('validatePartialConfig', () => {
    test('应该验证部分配置', () => {
      const partialConfig = {
        concurrency: 3,
        logLevel: 'debug',
      };

      const result = validatePartialConfig(partialConfig);

      expect(result.valid).toBe(true);
      expect(result.config.concurrency).toBe(3);
      expect(result.config.logLevel).toBe('debug');
      expect(result.errors).toEqual([]);
    });

    test('应该验证指定的必需字段', () => {
      const partialConfig = {
        pdfDir: './pdfs',
      };

      const result = validatePartialConfig(partialConfig, ['rootURL', 'pdfDir']);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.some((e) => e.path.join('.').includes('rootURL'))).toBe(true);
    });

    test('应该允许未知字段在部分验证中', () => {
      const partialConfig = {
        concurrency: 3,
        customField: 'value',
      };

      const result = validatePartialConfig(partialConfig);

      expect(result.valid).toBe(true);
      expect(result.config.customField).toBe('value');
    });

    test('应该处理无效的部分配置', () => {
      const partialConfig = {
        concurrency: 20, // 超过最大值
      };

      const result = validatePartialConfig(partialConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('getConfigSchema', () => {
    test('应该返回配置模式描述', () => {
      const schema = getConfigSchema();

      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.keys).toBeDefined();
      expect(schema.keys.rootURL).toBeDefined();
      expect(schema.keys.pdfDir).toBeDefined();
    });
  });

  describe('getDefaultConfig', () => {
    test('应该返回默认配置', () => {
      const defaultConfig = getDefaultConfig();

      expect(defaultConfig).toBeDefined();
      expect(defaultConfig.concurrency).toBe(5);
      expect(defaultConfig.screenshotDelay).toBe(500);
      expect(defaultConfig.maxRetries).toBe(3);
      expect(defaultConfig.logLevel).toBe('info');
      expect(defaultConfig.allowedDomains).toEqual(['rc.nextjs.org', 'nextjs.org']);
      expect(defaultConfig.browser.headless).toBe(true);
      expect(defaultConfig.pdf.engine).toBe('puppeteer');
      expect(defaultConfig.pdf.format).toBe('A4');
    });

    test('默认配置应该包含所有嵌套对象', () => {
      const defaultConfig = getDefaultConfig();

      expect(defaultConfig.browser).toBeDefined();
      expect(defaultConfig.queue).toBeDefined();
      expect(defaultConfig.images).toBeDefined();
      expect(defaultConfig.filesystem).toBeDefined();
      expect(defaultConfig.output).toBeDefined();
      expect(defaultConfig.pdf).toBeDefined();
      expect(defaultConfig.python).toBeDefined();
      expect(defaultConfig.state).toBeDefined();
      expect(defaultConfig.monitoring).toBeDefined();
      expect(defaultConfig.network).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    test('应该创建自定义验证错误', () => {
      const error = new ValidationError('Test error', {
        field: 'testField',
        value: 'invalid',
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Test error');
      expect(error.details).toEqual({
        field: 'testField',
        value: 'invalid',
      });
    });

    test('应该捕获堆栈跟踪', () => {
      const error = new ValidationError('Stack trace test');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ValidationError');
    });
  });

  describe('复杂配置场景', () => {
    test('应该验证完整的生产配置', () => {
      const config = {
        rootURL: 'https://nextjs.org/docs',
        baseUrl: 'https://nextjs.org/docs/api',
        pdfDir: './output/pdfs',
        concurrency: 8,
        screenshotDelay: 1000,
        navLinksSelector: 'nav.sidebar a[href]',
        contentSelector: 'main article',
        ignoreURLs: ['/docs/api/deprecated', '/docs/test'],
        maxRetries: 5,
        retryDelay: 2000,
        pageTimeout: 60000,
        imageTimeout: 15000,
        allowedDomains: ['nextjs.org', 'vercel.com'],
        logLevel: 'debug',
        browser: {
          headless: true,
          slowMo: 50,
          viewport: { width: 1920, height: 1080 },
          userAgent: 'Mozilla/5.0 PDF Scraper',
        },
        pdf: {
          engine: 'puppeteer',
          format: 'A4',
          margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
          printBackground: true,
          quality: 'high',
        },
        python: {
          executable: 'python3',
          timeout: 300000,
        },
        state: {
          saveInterval: 60000,
          autoSave: true,
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.config.concurrency).toBe(8);
      expect(result.config.pdf.engine).toBe('puppeteer');
      expect(result.config.browser.userAgent).toBe('Mozilla/5.0 PDF Scraper');
    });

    test('应该收集多个验证错误', () => {
      const config = {
        rootURL: 'invalid-url',
        pdfDir: './pdfs',
        navLinksSelector: 'nav a',
        contentSelector: 'main',
        concurrency: 20,
        logLevel: 'invalid-level',
        pdf: {
          engine: 'invalid-engine',
          format: 'invalid-format',
        },
      };

      try {
        validateConfig(config);
        throw new Error('应该抛出验证错误');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.details.details).toBeDefined();
        expect(error.details.details.length).toBeGreaterThan(1);
      }
    });
  });
});
