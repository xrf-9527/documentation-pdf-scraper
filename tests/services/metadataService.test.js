// tests/services/metadataService.test.js
import { MetadataService } from '../../src/services/metadataService.js';

describe('MetadataService', () => {
  let metadataService;
  let mockFileService;
  let mockPathService;
  let mockLogger;

  beforeEach(() => {
    // Mock dependencies
    mockFileService = {
      readJson: jest.fn(),
      writeJson: jest.fn(),
      updateJson: jest.fn(),
      appendToJsonArray: jest.fn(),
      removeFromJsonArray: jest.fn(),
    };

    mockPathService = {
      getMetadataPath: jest.fn((type) => `/metadata/${type}.json`),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    };

    metadataService = new MetadataService(mockFileService, mockPathService, mockLogger);
  });

  describe('saveArticleTitle', () => {
    test('saveArticleTitle should use atomic updateJson instead of read+write', async () => {
      mockFileService.updateJson = jest.fn().mockResolvedValue({});

      await metadataService.saveArticleTitle(2, '标题');

      expect(mockFileService.updateJson).toHaveBeenCalledWith(
        '/metadata/articleTitles.json',
        {},
        expect.any(Function),
        { recoverInvalidJson: true }
      );
    });

    test('应该保存文章标题', async () => {
      mockFileService.updateJson.mockResolvedValue({ 1: '旧标题', 2: '新文章标题' });

      await metadataService.saveArticleTitle(2, '新文章标题');

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('articleTitles');
      expect(mockFileService.updateJson).toHaveBeenCalledWith(
        '/metadata/articleTitles.json',
        {},
        expect.any(Function),
        { recoverInvalidJson: true }
      );

      const updater = mockFileService.updateJson.mock.calls[0][2];
      const updated = updater({ 1: '旧标题' });
      expect(updated).toEqual({
        1: '旧标题',
        2: '新文章标题',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('保存文章标题: [2] 新文章标题');
    });

    test('应该覆盖已存在的标题', async () => {
      mockFileService.updateJson.mockResolvedValue({ 1: '更新的标题' });

      await metadataService.saveArticleTitle(1, '更新的标题');

      const updater = mockFileService.updateJson.mock.calls[0][2];
      const updated = updater({ 1: '旧标题' });
      expect(updated).toEqual({
        1: '更新的标题',
      });
    });

    test('应该在空对象上保存标题', async () => {
      mockFileService.updateJson.mockResolvedValue({ 1: '第一个标题' });

      await metadataService.saveArticleTitle(1, '第一个标题');

      const updater = mockFileService.updateJson.mock.calls[0][2];
      const updated = updater({});
      expect(updated).toEqual({
        1: '第一个标题',
      });
    });
  });

  describe('getArticleTitles', () => {
    test('应该获取所有文章标题', async () => {
      const titles = { 1: '标题1', 2: '标题2' };
      mockFileService.readJson.mockResolvedValue(titles);

      const result = await metadataService.getArticleTitles();

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('articleTitles');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/articleTitles.json', {});
      expect(result).toEqual(titles);
    });

    test('应该在文件不存在时返回空对象', async () => {
      mockFileService.readJson.mockResolvedValue({});

      const result = await metadataService.getArticleTitles();

      expect(result).toEqual({});
    });
  });

  describe('logFailedLink', () => {
    test('应该记录失败的链接', async () => {
      const error = new Error('Network error');
      const mockDate = new Date('2024-03-15T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      await metadataService.logFailedLink('http://example.com', 5, error);

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('failed');
      expect(mockFileService.appendToJsonArray).toHaveBeenCalledWith('/metadata/failed.json', {
        url: 'http://example.com',
        index: 5,
        error: 'Network error',
        timestamp: '2024-03-15T10:00:00.000Z',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('记录失败链接: http://example.com', {
        error: 'Network error',
      });

      Date.mockRestore();
    });

    test('应该处理字符串错误', async () => {
      await metadataService.logFailedLink('http://example.com', 5, 'String error');

      expect(mockFileService.appendToJsonArray).toHaveBeenCalledWith(
        '/metadata/failed.json',
        expect.objectContaining({
          error: 'String error',
        })
      );
    });

    test('应该处理没有message的错误对象', async () => {
      const errorWithoutMessage = { code: 'ENOTFOUND' };

      await metadataService.logFailedLink('http://example.com', 5, errorWithoutMessage);

      expect(mockFileService.appendToJsonArray).toHaveBeenCalledWith(
        '/metadata/failed.json',
        expect.objectContaining({
          error: '[object Object]', // String(errorWithoutMessage) returns '[object Object]'
        })
      );
    });
  });

  describe('getFailedLinks', () => {
    test('应该获取所有失败的链接', async () => {
      const failedLinks = [
        { url: 'http://example1.com', error: 'Error 1' },
        { url: 'http://example2.com', error: 'Error 2' },
      ];
      mockFileService.readJson.mockResolvedValue(failedLinks);

      const result = await metadataService.getFailedLinks();

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('failed');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/failed.json', []);
      expect(result).toEqual(failedLinks);
    });

    test('应该在文件不存在时返回空数组', async () => {
      mockFileService.readJson.mockResolvedValue([]);

      const result = await metadataService.getFailedLinks();

      expect(result).toEqual([]);
    });
  });

  describe('removeFromFailedLinks', () => {
    test('应该从失败列表中移除指定URL', async () => {
      await metadataService.removeFromFailedLinks('http://example.com');

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('failed');
      expect(mockFileService.removeFromJsonArray).toHaveBeenCalledWith(
        '/metadata/failed.json',
        expect.any(Function)
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('从失败列表移除: http://example.com');

      // 测试过滤函数
      const filterFn = mockFileService.removeFromJsonArray.mock.calls[0][1];
      expect(filterFn({ url: 'http://example.com' })).toBe(true);
      expect(filterFn({ url: 'http://other.com' })).toBe(false);
    });
  });

  describe('logImageLoadFailure', () => {
    test('应该记录新的图片加载失败', async () => {
      mockFileService.readJson.mockResolvedValue([]);
      const mockDate = new Date('2024-03-15T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      await metadataService.logImageLoadFailure('http://example.com/image.jpg', 3);

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('imageLoadFailures');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/imageLoadFailures.json', []);
      expect(mockFileService.writeJson).toHaveBeenCalledWith('/metadata/imageLoadFailures.json', [
        {
          url: 'http://example.com/image.jpg',
          index: 3,
          timestamp: '2024-03-15T10:00:00.000Z',
        },
      ]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '记录图片加载失败: http://example.com/image.jpg'
      );

      Date.mockRestore();
    });

    test('应该避免重复记录', async () => {
      mockFileService.readJson.mockResolvedValue([
        { url: 'http://example.com/image.jpg', index: 3 },
      ]);

      await metadataService.logImageLoadFailure('http://example.com/image.jpg', 3);

      expect(mockFileService.writeJson).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('应该允许相同URL但不同index的记录', async () => {
      mockFileService.readJson.mockResolvedValue([
        { url: 'http://example.com/image.jpg', index: 3 },
      ]);

      await metadataService.logImageLoadFailure('http://example.com/image.jpg', 5);

      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/metadata/imageLoadFailures.json',
        expect.arrayContaining([
          { url: 'http://example.com/image.jpg', index: 3 },
          expect.objectContaining({
            url: 'http://example.com/image.jpg',
            index: 5,
          }),
        ])
      );
    });
  });

  describe('getImageLoadFailures', () => {
    test('应该获取图片加载失败列表', async () => {
      const failures = [
        { url: 'http://example.com/img1.jpg', index: 1 },
        { url: 'http://example.com/img2.jpg', index: 2 },
      ];
      mockFileService.readJson.mockResolvedValue(failures);

      const result = await metadataService.getImageLoadFailures();

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('imageLoadFailures');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/imageLoadFailures.json', []);
      expect(result).toEqual(failures);
    });
  });

  describe('saveUrlMapping', () => {
    test('应该保存URL到文件路径的映射', async () => {
      mockFileService.readJson.mockResolvedValue({
        'http://old.com': { path: '/pdfs/old.pdf' },
      });
      const mockDate = new Date('2024-03-15T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      await metadataService.saveUrlMapping('http://example.com', '/pdfs/example.pdf');

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('urlMapping');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/urlMapping.json', {});
      expect(mockFileService.writeJson).toHaveBeenCalledWith('/metadata/urlMapping.json', {
        'http://old.com': { path: '/pdfs/old.pdf' },
        'http://example.com': {
          path: '/pdfs/example.pdf',
          timestamp: '2024-03-15T10:00:00.000Z',
        },
      });

      Date.mockRestore();
    });

    test('应该覆盖已存在的映射', async () => {
      mockFileService.readJson.mockResolvedValue({
        'http://example.com': { path: '/pdfs/old-path.pdf' },
      });

      await metadataService.saveUrlMapping('http://example.com', '/pdfs/new-path.pdf');

      expect(mockFileService.writeJson).toHaveBeenCalledWith(
        '/metadata/urlMapping.json',
        expect.objectContaining({
          'http://example.com': expect.objectContaining({
            path: '/pdfs/new-path.pdf',
          }),
        })
      );
    });
  });

  describe('getUrlMapping', () => {
    test('应该获取URL映射', async () => {
      const mapping = {
        'http://example1.com': { path: '/pdfs/1.pdf' },
        'http://example2.com': { path: '/pdfs/2.pdf' },
      };
      mockFileService.readJson.mockResolvedValue(mapping);

      const result = await metadataService.getUrlMapping();

      expect(mockPathService.getMetadataPath).toHaveBeenCalledWith('urlMapping');
      expect(mockFileService.readJson).toHaveBeenCalledWith('/metadata/urlMapping.json', {});
      expect(result).toEqual(mapping);
    });
  });
});
