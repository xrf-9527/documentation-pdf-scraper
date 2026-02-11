// tests/services/translationService.test.js
import fs from 'fs';
import path from 'path';
import { TranslationService } from '../../src/services/translationService.js';

// Mock p-limit (ESM-only) to avoid Jest ESM parsing issues
jest.mock('p-limit', () => {
  return jest.fn(() => {
    const limit = (fn, ...args) => fn(...args);
    limit.activeCount = 0;
    limit.pendingCount = 0;
    limit.clearQueue = () => {};
    return limit;
  });
});

describe('TranslationService', () => {
  const baseConfig = {
    logLevel: 'error',
    translation: {
      enabled: true,
      bilingual: false,
      targetLanguage: 'Simplified Chinese (简体中文)',
      concurrency: 2,
      timeout: 60000,
      maxRetries: 3,
      retryDelay: 2000,
    },
  };

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const cacheDir = path.join(process.cwd(), '.temp', 'translation_cache');

  beforeEach(() => {
    // 清理缓存目录，避免不同测试之间互相影响
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // 测试结束后清理缓存目录
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test('_getCacheKey 应该是稳定且区分模式的', () => {
    const service = new TranslationService({ config: baseConfig, logger });
    const text = 'Hello world';

    const key1 = service._getCacheKey(text);
    const key2 = service._getCacheKey(text);
    expect(key1).toBe(key2);

    const bilingualService = new TranslationService({
      config: {
        ...baseConfig,
        translation: {
          ...baseConfig.translation,
          bilingual: true,
        },
      },
      logger,
    });

    const bilingualKey = bilingualService._getCacheKey(text);
    expect(bilingualKey).not.toBe(key1);
  });

  test('_saveToCache 和 _getFromCache 应该能正确读写缓存', async () => {
    const service = new TranslationService({ config: baseConfig, logger });
    const text = 'Some text';
    const translation = '某些文本';

    const saveResult = service._saveToCache(text, translation);
    const readResult = service._getFromCache(text);

    expect(saveResult).toBeInstanceOf(Promise);
    expect(readResult).toBeInstanceOf(Promise);

    await saveResult;
    const cached = await service._getFromCache(text);

    expect(cached).toBe(translation);
  });

  test('构造函数在缺少翻译配置时应该使用默认超时与重试参数', () => {
    const service = new TranslationService({
      config: {
        logLevel: 'error',
        translation: {
          enabled: true,
        },
      },
      logger,
    });

    expect(service.timeoutMs).toBeGreaterThanOrEqual(60000);
    expect(service.maxRetries).toBe(3);
    expect(service.retryDelay).toBe(2000);
  });

  test('translateMarkdown 应该保留 frontmatter 和代码块，并在双语模式下追加译文', async () => {
    const service = new TranslationService({
      config: {
        logLevel: 'error',
        translation: {
          enabled: true,
          bilingual: true,
          targetLanguage: 'Simplified Chinese (简体中文)',
          concurrency: 1,
          timeout: 60000,
          maxRetries: 1,
          retryDelay: 0,
        },
      },
      logger,
    });

    // 替换实际的批量翻译，实现一个可预测的伪翻译
    service._translateBatchWithRetry = jest.fn(async (batch) => {
      const result = {};
      batch.forEach((seg) => {
        result[seg.id] = `T(${seg.text})`;
      });
      return result;
    });

    const markdown = [
      '---',
      'title: Test',
      '---',
      '',
      '# Heading',
      '',
      'Paragraph line 1.',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
    ].join('\n');

    const translated = await service.translateMarkdown(markdown);

    // frontmatter 应该保留
    expect(translated.startsWith('---\n')).toBe(true);
    expect(translated).toContain('title: Test');

    // 代码块应保持原样
    expect(translated).toContain('```js');
    expect(translated).toContain('const a = 1;');

    // 段落原文和伪翻译都应该存在（双语模式）
    expect(translated).toContain('Paragraph line 1.');
    expect(translated).toContain('T(Paragraph line 1.');
  });

  test('translateMarkdown 应该将中文句子内部的 `_字_` 规范化为 `*字*` 以符合 Pandoc/Markdown 最佳实践', async () => {
    const service = new TranslationService({
      config: {
        logLevel: 'error',
        translation: {
          enabled: true,
          bilingual: true,
          targetLanguage: 'Simplified Chinese (简体中文)',
          concurrency: 1,
          timeout: 60000,
          maxRetries: 1,
          retryDelay: 0,
        },
      },
      logger,
    });

    // 伪造翻译结果：英文原文被翻译成包含中文 `_更_` 的句子
    service._translateBatchWithRetry = jest.fn(async (batch) => {
      const result = {};
      batch.forEach((seg) => {
        if (seg.text.includes('iterating with Claude has been')) {
          result[seg.id] =
            '有人说与 Claude 一起迭代变得_更_有趣，因为他们可以比对人类更挑剔地提出反馈意见。';
        } else {
          result[seg.id] = `T(${seg.text})`;
        }
      });
      return result;
    });

    const markdown = [
      '---',
      'title: Test',
      '---',
      '',
      'One person said that iterating with Claude has been _more_ fun, because they can be more picky with their feedback than with humans.',
      '',
    ].join('\n');

    const translated = await service.translateMarkdown(markdown);

    // 英文部分保持原样（不触碰 `_more_`）
    expect(translated).toContain(
      'One person said that iterating with Claude has been _more_ fun, because they can be more picky with their feedback than with humans.'
    );

    // 中文内部的 `_更_` 应当被规范化为 `*更*`，以便 Pandoc 正确解析为斜体
    expect(translated).toContain('迭代变得*更*有趣');
    expect(translated).not.toContain('迭代变得_更_有趣');
  });

  test('translateMarkdown 应为图片行添加译文图注但不复制图片', async () => {
    const service = new TranslationService({
      config: {
        ...baseConfig,
        translation: {
          ...baseConfig.translation,
          enabled: true,
          bilingual: true,
        },
      },
      logger,
    });

    // 替换实际的批量翻译，实现一个可预测的伪翻译
    const batchSpy = jest.fn(async (batch) => {
      const result = {};
      batch.forEach((seg) => {
        result[seg.id] = `T(${seg.text})`;
      });
      return result;
    });
    service._translateBatchWithRetry = batchSpy;

    const markdown = [
      '![Figure 1: Caption here](/image.png)',
      '',
      'Paragraph under image.',
      '',
    ].join('\n');

    const translated = await service.translateMarkdown(markdown);

    // 图片行应当只出现一次，不应生成第二个 `![]()`
    const imageOccurrences = (translated.match(/!\[Figure 1: Caption here]\(\/image\.png\)/g) || [])
      .length;
    expect(imageOccurrences).toBe(1);

    // 段落仍然应被翻译（双语模式：原文 + 译文）
    expect(translated).toContain('Paragraph under image.');
    expect(translated).toContain('T(Paragraph under image.)');

    // 图注应当在图片下方以单独一行形式出现（这里使用伪翻译占位）
    expect(translated).toContain('_T(Figure 1: Caption here)_');

    // 批量翻译的文本中应该包含图片行的 alt 文本（用于生成译文图注）
    const allTexts = batchSpy.mock.calls.flatMap((call) => call[0].map((seg) => seg.text));
    expect(allTexts.some((t) => t === 'Figure 1: Caption here')).toBe(true);
  });

  test('constructor should preserve explicit 0 values in translation config', () => {
    const service = new TranslationService({
      config: {
        logLevel: 'error',
        translation: {
          enabled: true,
          retryDelay: 0,
          maxSegmentRetries: 0,
          maxDelay: 0,
        },
      },
      logger,
    });

    expect(service.retryDelay).toBe(0);
    expect(service.maxSegmentRetries).toBe(0);
    expect(service.maxDelay).toBe(0);
  });

  test('_translateBatchWithRetry should not treat empty-string translations as failures', async () => {
    const service = new TranslationService({ config: baseConfig, logger });

    const batch = [
      { id: 'seg1', text: 'Text 1' },
      { id: 'seg2', text: 'Text 2' },
    ];

    // Mock batch translation result: seg1 -> '' (empty string), seg2 -> non-empty
    const batchResult = {
      seg1: '',
      seg2: 'Translated 2',
    };

    service._translateBatch = jest.fn(async () => batchResult);
    service._translateSingleSegment = jest.fn();

    const result = await service._translateBatchWithRetry(batch);

    expect(result).toEqual(batchResult);
    // No segment-level retries should be triggered for empty-string translations
    expect(service._translateSingleSegment).not.toHaveBeenCalled();
  });
});
