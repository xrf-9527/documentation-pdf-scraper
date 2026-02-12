import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/services/fileService.test.js
import { FileService } from '../../src/services/fileService.js';
import { consoleLogger } from '../../src/utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('FileService', () => {
  let fileService;
  let testDir;

  beforeEach(async () => {
    fileService = new FileService(consoleLogger);
    // 使用临时目录进行测试
    testDir = path.join(os.tmpdir(), 'fileservice-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试目录
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('ensureDirectory', () => {
    test('应该创建不存在的目录', async () => {
      const newDir = path.join(testDir, 'new-dir');
      await fileService.ensureDirectory(newDir);

      const stats = await fs.stat(newDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test('对已存在的目录不应该报错', async () => {
      await expect(fileService.ensureDirectory(testDir)).resolves.not.toThrow();
    });
  });

  describe('readJson/writeJson', () => {
    test('应该正确读写JSON文件', async () => {
      const filePath = path.join(testDir, 'test.json');
      const testData = { name: 'test', value: 123, nested: { key: 'value' } };

      await fileService.writeJson(filePath, testData);
      const readData = await fileService.readJson(filePath);

      expect(readData).toEqual(testData);
    });

    test('读取不存在的文件时应返回默认值', async () => {
      const filePath = path.join(testDir, 'nonexistent.json');
      const defaultValue = { default: true };

      const result = await fileService.readJson(filePath, defaultValue);
      expect(result).toEqual(defaultValue);
    });
  });

  describe('writeText', () => {
    test('应该正确写入文本文件', async () => {
      const filePath = path.join(testDir, 'test.txt');
      const content = 'hello world';

      await fileService.writeText(filePath, content);

      const readContent = await fs.readFile(filePath, 'utf8');
      expect(readContent).toBe(content);
    });
  });

  describe('appendToJsonArray', () => {
    test('应该正确追加到JSON数组', async () => {
      const filePath = path.join(testDir, 'array.json');

      await fileService.appendToJsonArray(filePath, { id: 1 });
      await fileService.appendToJsonArray(filePath, { id: 2 });

      const result = await fileService.readJson(filePath);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('removeFromJsonArray', () => {
    test('应该从JSON数组中移除匹配的项', async () => {
      const filePath = path.join(testDir, 'array.json');
      const initialData = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ];

      await fileService.writeJson(filePath, initialData);
      await fileService.removeFromJsonArray(filePath, (item) => item.id === 2);

      const result = await fileService.readJson(filePath);
      expect(result).toEqual([
        { id: 1, name: 'a' },
        { id: 3, name: 'c' },
      ]);
    });
  });

  describe('updateJson', () => {
    test('should serialize concurrent JSON updates without corruption', async () => {
      const filePath = path.join(testDir, 'titles.json');
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          fileService.updateJson(filePath, {}, (draft) => {
            draft[String(i)] = `title-${i}`;
            return draft;
          })
        )
      );

      const data = await fileService.readJson(filePath, {});
      expect(Object.keys(data)).toHaveLength(50);
    });

    test('should recover when file has invalid JSON and recoverInvalidJson is enabled', async () => {
      const filePath = path.join(testDir, 'broken.json');
      await fs.writeFile(filePath, '{"key":"value"}\n}', 'utf8');

      const result = await fileService.updateJson(
        filePath,
        {},
        (draft) => {
          draft.fixed = true;
          return draft;
        },
        { recoverInvalidJson: true }
      );

      expect(result).toEqual({ fixed: true });
      expect(await fileService.readJson(filePath, {})).toEqual({ fixed: true });
    });

    test('should not recover non-parse read errors even when recoverInvalidJson is enabled', async () => {
      const dirPath = path.join(testDir, 'as-directory');
      await fs.mkdir(dirPath, { recursive: true });

      const updater = vi.fn((draft) => {
        draft.changed = true;
        return draft;
      });

      await expect(
        fileService.updateJson(dirPath, {}, updater, { recoverInvalidJson: true })
      ).rejects.toThrow();

      expect(updater).not.toHaveBeenCalled();
    });
  });
});
