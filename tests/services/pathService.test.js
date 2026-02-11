// tests/services/pathService.test.js
import { PathService } from '../../src/services/pathService.js';
import path from 'path';

// Mock URL utilities
jest.mock('../../src/utils/url.js', () => ({
  getUrlHash: jest.fn((url) => 'a1b2c3d4'),
  extractSubfolder: jest.fn((url) => {
    if (url.includes('/app/')) {
      const match = url.match(/\/app\/([^/]+)/);
      return match ? { type: 'app', name: match[1] } : null;
    }
    if (url.includes('/pages/')) {
      const match = url.match(/\/pages\/([^/]+)/);
      return match ? { type: 'pages', name: match[1] } : null;
    }
    return null;
  }),
}));

describe('PathService', () => {
  let pathService;
  const mockConfig = {
    pdfDir: '/home/user/pdfs',
    output: {
      tempDirectory: '.temp',
    },
  };

  beforeEach(() => {
    pathService = new PathService(mockConfig);
    jest.clearAllMocks();
  });

  describe('determineDirectory', () => {
    test('应该为app路径确定正确的目录', () => {
      const url = 'https://nextjs.org/app/dashboard/docs';
      const dir = pathService.determineDirectory(url);

      expect(dir).toBe(path.join(mockConfig.pdfDir, 'app-dashboard'));
    });

    test('应该为pages路径确定正确的目录', () => {
      const url = 'https://nextjs.org/pages/api/routes';
      const dir = pathService.determineDirectory(url);

      expect(dir).toBe(path.join(mockConfig.pdfDir, 'pages-api'));
    });

    test('应该为不匹配的URL使用主机名', () => {
      const url = 'https://example.com/docs/guide';
      const dir = pathService.determineDirectory(url);

      expect(dir).toBe(path.join(mockConfig.pdfDir, 'example.com-docs'));
    });

    test('应该处理无效URL', () => {
      const url = 'invalid-url';
      const dir = pathService.determineDirectory(url);

      expect(dir).toBe(path.join(mockConfig.pdfDir, 'misc-docs'));
    });
  });

  describe('getPdfPath', () => {
    test('应该使用数字索引生成PDF路径', () => {
      const url = 'https://nextjs.org/docs/getting-started';
      const pdfPath = pathService.getPdfPath(url, { useHash: false, index: 5 });

      expect(pdfPath).toBe(
        path.join(mockConfig.pdfDir, 'nextjs.org-docs', '005-getting-started.pdf')
      );
    });

    test('应该使用哈希生成PDF路径', () => {
      const url = 'https://nextjs.org/docs/getting-started';
      const pdfPath = pathService.getPdfPath(url, { useHash: true });

      expect(pdfPath).toBe(
        path.join(mockConfig.pdfDir, 'nextjs.org-docs', 'a1b2c3d4-getting-started.pdf')
      );
    });

    test('应该处理没有文件名的URL', () => {
      const url = 'https://nextjs.org/';
      const pdfPath = pathService.getPdfPath(url, { useHash: false, index: 1 });

      expect(pdfPath).toBe(path.join(mockConfig.pdfDir, 'nextjs.org-docs', '001-nextjs-org.pdf'));
    });

    test('应该清理文件名中的特殊字符', () => {
      const url = "https://nextjs.org/docs/what's-new?version=13";
      const pdfPath = pathService.getPdfPath(url, { useHash: false, index: 10 });

      expect(pdfPath).toContain('010-what-s-new-version-13.pdf');
    });

    test('应该在没有useHash和index时使用简单文件名', () => {
      const url = 'https://nextjs.org/docs/routing';
      const pdfPath = pathService.getPdfPath(url);

      expect(pdfPath).toBe(path.join(mockConfig.pdfDir, 'nextjs.org-docs', 'a1b2c3d4-routing.pdf'));
    });
  });

  describe('getMetadataPath', () => {
    test('应该返回articleTitles元数据路径', () => {
      const metaPath = pathService.getMetadataPath('articleTitles');
      expect(metaPath).toBe(path.join(mockConfig.pdfDir, 'metadata', 'articleTitles.json'));
    });

    test('应该返回failed元数据路径', () => {
      const metaPath = pathService.getMetadataPath('failed');
      expect(metaPath).toBe(path.join(mockConfig.pdfDir, 'metadata', 'failed.json'));
    });

    test('应该返回imageLoadFailures元数据路径', () => {
      const metaPath = pathService.getMetadataPath('imageLoadFailures');
      expect(metaPath).toBe(path.join(mockConfig.pdfDir, 'metadata', 'imageLoadFailures.json'));
    });

    test('应该返回progress元数据路径', () => {
      const metaPath = pathService.getMetadataPath('progress');
      expect(metaPath).toBe(path.join(mockConfig.pdfDir, 'metadata', 'progress.json'));
    });

    test('应该返回urlMapping元数据路径', () => {
      const metaPath = pathService.getMetadataPath('urlMapping');
      expect(metaPath).toBe(path.join(mockConfig.pdfDir, 'metadata', 'urlMapping.json'));
    });

    test('应该为未知类型抛出错误', () => {
      expect(() => pathService.getMetadataPath('unknown')).toThrow('未知的元数据类型: unknown');
    });
  });

  describe('getFinalPdfPath', () => {
    test('应该生成带日期的最终PDF路径', () => {
      const mockDate = new Date('2024-03-15');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      const finalPath = pathService.getFinalPdfPath('nextjs-docs');

      expect(finalPath).toBe(path.join(mockConfig.pdfDir, 'finalPdf', 'nextjs-docs_20240315.pdf'));

      Date.mockRestore();
    });
  });

  describe('getLogPath', () => {
    test('应该返回combined日志路径', () => {
      const logPath = pathService.getLogPath('combined');
      expect(logPath).toBe(path.join(process.cwd(), 'logs', 'combined.log'));
    });

    test('应该返回error日志路径', () => {
      const logPath = pathService.getLogPath('error');
      expect(logPath).toBe(path.join(process.cwd(), 'logs', 'error.log'));
    });

    test('应该返回progress日志路径', () => {
      const logPath = pathService.getLogPath('progress');
      expect(logPath).toBe(path.join(process.cwd(), 'logs', 'progress.log'));
    });

    test('应该处理自定义日志类型', () => {
      const logPath = pathService.getLogPath('custom');
      expect(logPath).toBe(path.join(process.cwd(), 'logs', 'custom.log'));
    });

    test('应该使用默认combined类型', () => {
      const logPath = pathService.getLogPath();
      expect(logPath).toBe(path.join(process.cwd(), 'logs', 'combined.log'));
    });
  });

  describe('parsePdfFileName', () => {
    test('应该解析数字索引文件名', () => {
      const result = pathService.parsePdfFileName('005-getting-started.pdf');

      expect(result).toEqual({
        prefix: '005',
        originalName: 'getting-started',
        isNumericIndex: true,
        isHash: false,
        index: 5,
      });
    });

    test('应该解析哈希前缀文件名', () => {
      const result = pathService.parsePdfFileName('a1b2c3d4-routing-guide.pdf');

      expect(result).toEqual({
        prefix: 'a1b2c3d4',
        originalName: 'routing-guide',
        isNumericIndex: false,
        isHash: true,
        index: null,
      });
    });

    test('应该解析没有前缀的文件名', () => {
      const result = pathService.parsePdfFileName('simplefile.pdf');

      expect(result).toEqual({
        prefix: null,
        originalName: 'simplefile',
        isNumericIndex: false,
        isHash: false,
        index: null,
      });
    });

    test('应该处理多个连字符的文件名', () => {
      const result = pathService.parsePdfFileName('001-api-routes-middleware.pdf');

      expect(result).toEqual({
        prefix: '001',
        originalName: 'api-routes-middleware',
        isNumericIndex: true,
        isHash: false,
        index: 1,
      });
    });
  });

  describe('getTempPath', () => {
    test('应该返回临时文件路径', () => {
      const tempPath = pathService.getTempPath('temp-file.txt');
      expect(tempPath).toBe(path.join(mockConfig.pdfDir, '.temp', 'temp-file.txt'));
    });
  });

  describe('getTempDirectory', () => {
    test('应该返回配置的临时目录', () => {
      const tempDir = pathService.getTempDirectory();
      expect(tempDir).toBe(path.resolve('.temp'));
    });

    test('应该返回默认临时目录当配置不存在时', () => {
      const serviceWithoutConfig = new PathService({ pdfDir: '/pdfs' });
      const tempDir = serviceWithoutConfig.getTempDirectory();
      expect(tempDir).toBe(path.resolve('.temp'));
    });
  });

  describe('generateIndexedFileName', () => {
    test('应该生成索引文件名', () => {
      const url = 'https://nextjs.org/docs/routing';
      const fileName = pathService.generateIndexedFileName(url, 42);

      expect(fileName).toContain('042-routing.pdf');
    });
  });

  describe('generateHashedFileName', () => {
    test('应该生成哈希文件名', () => {
      const url = 'https://nextjs.org/docs/routing';
      const fileName = pathService.generateHashedFileName(url);

      expect(fileName).toContain('a1b2c3d4-routing.pdf');
    });
  });

  describe('validateFileName', () => {
    test('应该验证索引文件名', () => {
      const result = pathService.validateFileName('003-api-routes.pdf');

      expect(result).toEqual({
        isValid: true,
        type: 'indexed',
        index: 3,
        originalName: 'api-routes',
      });
    });

    test('应该验证哈希文件名', () => {
      const result = pathService.validateFileName('deadbeef-config.pdf');

      expect(result).toEqual({
        isValid: true,
        type: 'hashed',
        index: null,
        originalName: 'config',
      });
    });

    test('应该验证简单文件名', () => {
      const result = pathService.validateFileName('guide.pdf');

      expect(result).toEqual({
        isValid: true,
        type: 'simple',
        index: null,
        originalName: 'guide',
      });
    });

    test('应该标记无效格式的文件名', () => {
      const result = pathService.validateFileName('invalid-prefix-file.pdf');

      expect(result).toEqual({
        isValid: false, // 无效，因为有前缀但不是数字或哈希
        type: 'simple',
        index: null,
        originalName: 'prefix-file',
      });
    });
  });

  describe('getTranslationCacheDirectory', () => {
    test('应该在临时目录下生成翻译缓存目录', () => {
      const dir = pathService.getTranslationCacheDirectory();
      expect(dir).toBe(path.join(path.resolve('.temp'), 'translation_cache'));
    });

    test('应该拒绝越界的缓存目录', () => {
      const unsafeService = new PathService({
        pdfDir: '/home/user/pdfs',
        output: {
          tempDirectory: '/../outside',
        },
      });

      expect(() => unsafeService.getTranslationCacheDirectory()).toThrow(
        'Unsafe translation cache directory'
      );
    });
  });
});
