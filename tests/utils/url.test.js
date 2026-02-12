import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/utils/url.test.js
import { normalizeUrl, getUrlHash, validateUrl, extractSubfolder } from '../../src/utils/url.js';

describe('URL工具函数', () => {
  describe('normalizeUrl', () => {
    test('应该移除尾部斜杠', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    test('应该排序查询参数', () => {
      expect(normalizeUrl('https://example.com/?b=2&a=1')).toBe('https://example.com/?a=1&b=2');
    });

    test('应该移除hash', () => {
      expect(normalizeUrl('https://example.com/path#section')).toBe('https://example.com/path');
    });

    test('处理无效URL时返回原值', () => {
      expect(normalizeUrl('invalid-url')).toBe('invalid-url');
    });
  });

  describe('getUrlHash', () => {
    test('应该生成8位hash', () => {
      const hash = getUrlHash('https://example.com/test');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    test('相同URL应该生成相同hash', () => {
      const url = 'https://example.com/test';
      expect(getUrlHash(url)).toBe(getUrlHash(url));
    });
  });

  describe('validateUrl', () => {
    test('允许域名内的URL', () => {
      expect(validateUrl('https://example.com/test', ['example.com'])).toBe(true);
    });

    test('拒绝不在允许列表中的域名', () => {
      expect(validateUrl('https://other.com/test', ['example.com'])).toBe(false);
    });

    test('处理无效URL', () => {
      expect(validateUrl('invalid-url', ['example.com'])).toBe(false);
    });
  });

  describe('extractSubfolder', () => {
    test('应该提取app路径', () => {
      expect(extractSubfolder('https://example.com/app/dashboard/')).toEqual({
        type: 'app',
        name: 'dashboard',
      });
    });

    test('应该提取pages路径', () => {
      expect(extractSubfolder('https://example.com/pages/api/')).toEqual({
        type: 'pages',
        name: 'api',
      });
    });

    test('对不匹配的URL返回null', () => {
      expect(extractSubfolder('https://example.com/docs/')).toBeNull();
    });
  });
});
