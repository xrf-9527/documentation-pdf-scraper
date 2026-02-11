import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pLimit from 'p-limit';
import { createLogger } from '../utils/logger.js';
import { delay, retry } from '../utils/common.js';
import { GeminiClient } from './geminiClient.js';

/**
 * Translation Service
 * Handles content translation using gemini-cli with caching and concurrency control
 */
export class TranslationService {
  constructor(options = {}) {
    const { config = {}, logger, pathService, client } = options;

    this.config = config;
    this.logger = logger || createLogger({ logLevel: config.logLevel });
    this.pathService = pathService || null;

    this.logger.info('TranslationService constructor called', {
      configKeys: Object.keys(config || {}),
    });

    const translationConfig = config.translation || {};

    // 使用 null 合并运算符以保留合法的 0 / false 等显式配置值
    this.enabled = translationConfig.enabled ?? false;
    this.bilingual = translationConfig.bilingual ?? false;
    this.targetLanguage = translationConfig.targetLanguage ?? 'Chinese';
    this.concurrency = translationConfig.concurrency ?? 1;

    // 超时与重试配置（支持从配置覆盖）
    this.timeoutMs = translationConfig.timeout ?? 60000;
    this.maxRetries = translationConfig.maxRetries ?? 3;
    this.retryDelay = translationConfig.retryDelay ?? 2000;

    // 新增：段落级重试与抖动策略配置（AWS/Netflix 最佳实践）
    this.maxSegmentRetries = translationConfig.maxSegmentRetries ?? 2;
    this.maxDelay = translationConfig.maxDelay ?? 30000;
    this.jitterStrategy = translationConfig.jitterStrategy ?? 'decorrelated';

    this.logger.info('TranslationService enabled:', {
      enabled: this.enabled,
      targetLanguage: this.targetLanguage,
      bilingual: this.bilingual,
      concurrency: this.concurrency,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      maxSegmentRetries: this.maxSegmentRetries,
      maxDelay: this.maxDelay,
      jitterStrategy: this.jitterStrategy,
    });

    // 外部可注入自定义客户端（方便测试或替换实现）
    this.client = client || null;

    // Cache directory
    this.cacheDir = this._resolveCacheDir();
    this.cacheMemory = new Map();
    this.cacheWriteQueue = Promise.resolve();
    this.cacheInitPromise = this._ensureCacheDir();
  }

  _resolveCacheDir() {
    if (this.pathService && typeof this.pathService.getTranslationCacheDirectory === 'function') {
      return this.pathService.getTranslationCacheDirectory();
    }
    return path.join(process.cwd(), '.temp', 'translation_cache');
  }

  async _ensureCacheDir() {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Normalize CJK intraword emphasis to use `*` instead of `_`.
   *
   * According to CommonMark and Pandoc best practices, intraword underscores
   * should generally NOT be treated as emphasis, in order to avoid breaking
   * identifiers like foo_bar_baz. This helper rewrites the specific pattern
   * of Chinese characters emphasized inline as `变得_更_有趣` into
   * `变得*更*有趣`, which Pandoc will reliably render as italics.
   *
   * The regex is intentionally conservative and only targets runs of
   * CJK characters on both sides of the emphasized text to avoid touching
   * English identifiers or code.
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _normalizeCjkEmphasis(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return markdown;
    }

    // 处理典型模式：中文 + _中文+_ + 中文，例如：变得_更_有趣
    // 覆盖基本汉字和扩展 A 区间（U+3400-U+9FFF）
    const cjkIntrawordUnderscore = /([\u3400-\u9fff])_([\u3400-\u9fff]+)_([\u3400-\u9fff])/g;

    return markdown.replace(cjkIntrawordUnderscore, '$1*$2*$3');
  }

  _getCacheKey(text) {
    const mode = this.bilingual ? 'bilingual' : 'single';
    const keyBase = `${this.targetLanguage}:${mode}:${text}`;
    return crypto.createHash('md5').update(keyBase).digest('hex');
  }

  async _getFromCache(text) {
    const key = this._getCacheKey(text);
    if (this.cacheMemory.has(key)) {
      return this.cacheMemory.get(key);
    }

    const cachePath = path.join(this.cacheDir, `${key}.json`);

    try {
      await this.cacheInitPromise;
      const data = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
      this.cacheMemory.set(key, data.translation);
      return data.translation;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }

      this.logger.warn('Failed to read from cache', { error: error.message });
      return null;
    }
  }

  async _saveToCache(text, translation) {
    const key = this._getCacheKey(text);
    const cachePath = path.join(this.cacheDir, `${key}.json`);
    this.cacheMemory.set(key, translation);

    const payload = JSON.stringify({
      original: text,
      translation,
      timestamp: Date.now(),
    });

    const writeTask = async () => {
      await this.cacheInitPromise;
      await fs.promises.writeFile(cachePath, payload);
    };

    this.cacheWriteQueue = this.cacheWriteQueue.then(writeTask).catch((error) => {
      this.logger.warn('Failed to write to cache', { error: error.message });
    });

    return this.cacheWriteQueue;
  }

  async _flushCacheWrites() {
    try {
      await this.cacheWriteQueue;
    } catch {
      // Errors are handled in _saveToCache to keep translation flow resilient.
    }
  }

  /**
   * Translate page content
   * @param {import('puppeteer').Page} page
   */
  async translatePage(page) {
    if (!this.enabled) {
      this.logger.debug('Translation disabled, skipping');
      return;
    }

    this.logger.info(
      `Starting translation to ${this.targetLanguage} (Bilingual: ${this.bilingual})`
    );

    try {
      // 1. Identify translatable elements
      const elementsToTranslate = await page.evaluate(() => {
        const textTags = [
          'p',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'li',
          'th',
          'td',
          'figcaption',
          'blockquote',
        ];
        const elements = [];

        const isValid = (el) => {
          if (!el.offsetParent) return false;
          const text = el.innerText.trim();
          if (text.length < 2) return false;
          if (el.closest('pre') || el.closest('code') || el.closest('.no-translate')) return false;
          if (/^[\d\s\W]+$/.test(text)) return false;
          return true;
        };

        textTags.forEach((tag) => {
          document.querySelectorAll(tag).forEach((el, index) => {
            const hasBlockChildren = Array.from(el.children).some((child) => {
              const display = window.getComputedStyle(child).display;
              return (
                ['block', 'table', 'flex', 'grid'].includes(display) &&
                !['span', 'a', 'strong', 'em', 'b', 'i', 'code'].includes(
                  child.tagName.toLowerCase()
                )
              );
            });

            if (!hasBlockChildren && isValid(el)) {
              const id = `translate - ${tag} -${index} -${Math.random().toString(36).substr(2, 9)} `;
              el.setAttribute('data-translate-id', id);
              elements.push({
                id,
                text: el.innerText.trim(),
                tagName: tag,
              });
            }
          });
        });

        return elements;
      });

      this.logger.info(`Found ${elementsToTranslate.length} elements to translate`);

      if (elementsToTranslate.length === 0) {
        return;
      }

      // 2. Check cache and filter
      const uncachedElements = [];
      const cachedTranslations = {};

      for (const item of elementsToTranslate) {
        const cached = await this._getFromCache(item.text);
        if (cached) {
          cachedTranslations[item.id] = cached;
        } else {
          uncachedElements.push(item);
        }
      }

      this.logger.info(
        `Cache hit: ${elementsToTranslate.length - uncachedElements.length}/${elementsToTranslate.length}`
      );

      // 3. Process uncached elements in batches
      if (uncachedElements.length > 0) {
        const batchSize = 10;
        const batches = [];
        for (let i = 0; i < uncachedElements.length; i += batchSize) {
          batches.push(uncachedElements.slice(i, i + batchSize));
        }

        this.logger.info(`Starting DOM translation batches`, {
          totalBatches: batches.length,
          totalItems: uncachedElements.length,
          batchSize,
          concurrency: this.concurrency,
        });

        // 使用 p-limit 控制并发，并为每个批次提供重试
        const limit = pLimit(this.concurrency || 1);
        let completedBatches = 0;
        let failedBatches = 0;

        const tasks = batches.map((batch, batchIndex) =>
          limit(async () => {
            const batchStartTime = Date.now();
            this.logger.debug(`Starting DOM batch ${batchIndex + 1}/${batches.length}`, {
              itemCount: batch.length,
            });

            try {
              // 为每个批次添加独立的超时保护
              const batchTimeout = this.timeoutMs || 60000;
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                  () =>
                    reject(
                      new Error(`DOM batch ${batchIndex + 1} timeout after ${batchTimeout}ms`)
                    ),
                  batchTimeout
                );
              });

              const translatePromise = this._translateBatchWithRetry(batch);
              const res = await Promise.race([translatePromise, timeoutPromise]);

              if (res) {
                const cacheWriteTasks = [];
                Object.entries(res).forEach(([id, text]) => {
                  const originalItem = batch.find((item) => item.id === id);
                  if (originalItem) {
                    cacheWriteTasks.push(this._saveToCache(originalItem.text, text));
                    cachedTranslations[id] = text;
                  }
                });
                await Promise.all(cacheWriteTasks);
              }

              completedBatches++;
              this.logger.info(`DOM batch ${batchIndex + 1}/${batches.length} completed`, {
                elapsed: Date.now() - batchStartTime,
                progress: `${completedBatches}/${batches.length}`,
              });
            } catch (err) {
              failedBatches++;
              this.logger.error(
                `DOM batch ${batchIndex + 1}/${batches.length} failed after retries`,
                {
                  error: err.message,
                  elapsed: Date.now() - batchStartTime,
                  progress: `${completedBatches}/${batches.length}`,
                }
              );
            } finally {
              // 轻微延迟，避免打爆速率限制
              await delay(200);
            }
          })
        );

        // 为整个批处理过程添加总超时
        const totalTimeout = (this.timeoutMs || 60000) * batches.length;
        const totalTimeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`Total DOM translation timeout after ${totalTimeout}ms`)),
            totalTimeout
          );
        });

        try {
          await Promise.race([Promise.all(tasks), totalTimeoutPromise]);
          this.logger.info('All DOM translation batches completed', {
            completed: completedBatches,
            failed: failedBatches,
            total: batches.length,
          });
        } catch (err) {
          this.logger.warn('DOM translation batches did not complete in time', {
            error: err.message,
            completed: completedBatches,
            failed: failedBatches,
            total: batches.length,
          });
          // 即使超时，也继续处理已完成的翻译
        }
      }

      // 4. Apply all translations (cached + new)
      if (Object.keys(cachedTranslations).length > 0) {
        await page.evaluate(
          (translations, bilingual) => {
            Object.entries(translations).forEach(([id, translatedText]) => {
              const el = document.querySelector(`[data-translate-id="${id}"]`);
              if (el) {
                if (bilingual) {
                  const originalText = el.innerHTML;
                  if (el.querySelector('.translated-text')) return;

                  el.innerHTML = `
                                    <div class="original-text" style="opacity: 0.7; font-size: 0.9em; margin-bottom: 4px;">${originalText}</div>
                                    <div class="translated-text" style="color: #000; font-weight: 500;">${translatedText}</div>
                                `;
                } else {
                  el.innerText = translatedText;
                }
                el.removeAttribute('data-translate-id');
              }
            });
          },
          cachedTranslations,
          this.bilingual
        );
      }

      this.logger.info('Translation completed');
    } catch (error) {
      this.logger.error('Translation failed', { error: error.message });
    }
  }

  /**
   * Translate Markdown content instead of DOM.
   * 保留 frontmatter 和代码块，只翻译普通文本段落。
   * @param {string} markdownContent
   * @returns {Promise<string>}
   */
  async translateMarkdown(markdownContent) {
    if (!this.enabled) {
      this.logger.debug('Translation disabled for markdown, returning original');
      return markdownContent;
    }

    if (!markdownContent || typeof markdownContent !== 'string') {
      return markdownContent;
    }

    const lines = markdownContent.split('\n');
    const outputLines = [];
    const segments = [];
    const imageCaptions = [];
    let currentTextLines = [];
    let inFrontmatter = false;
    let inCodeBlock = false;

    const flushCurrentSegment = () => {
      if (currentTextLines.length === 0) return;
      const text = currentTextLines.join('\n').trim();
      currentTextLines = [];
      if (!text) return;

      const id = `md-${segments.length}`;
      segments.push({ id, text });
      outputLines.push(`__MD_SEGMENT_${id}__`);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 处理文件开头的 YAML frontmatter
      if (i === 0 && trimmed === '---') {
        inFrontmatter = true;
        outputLines.push(line);
        continue;
      }

      if (inFrontmatter) {
        outputLines.push(line);
        if (trimmed === '---') {
          inFrontmatter = false;
        }
        continue;
      }

      // 处理代码块 fence（``` 或 ~~~）
      const fenceMatch = trimmed.match(/^(```|~~~)/);
      if (fenceMatch) {
        flushCurrentSegment();
        inCodeBlock = !inCodeBlock;
        outputLines.push(line);
        continue;
      }

      if (inCodeBlock) {
        outputLines.push(line);
        continue;
      }

      // 空行：结束当前段落
      if (trimmed === '') {
        flushCurrentSegment();
        outputLines.push(line);
        continue;
      }

      // 纯图片行（例如 `![alt](src)` 或 `![alt](src){...}`）在结构上不应生成第二个 `![]()`，
      // 但在双语模式下我们希望图注也是双语：
      // - 保持这行图片本身不变（继续作为 Pandoc implicit_figures 的唯一 figure+caption 来源）
      // - 单独翻译 alt 文本，并在图片下方追加一行译文（例如 `_图 1：..._`）
      const isStandaloneImage = /^!\[[^\]]*\]\([^)]*\)\s*(\{[^}]*\})?$/.test(trimmed);
      if (isStandaloneImage) {
        // 在进入图片行前先结束当前段落
        flushCurrentSegment();

        if (this.bilingual) {
          const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*(\{[^}]*\})?$/);
          const altText = imgMatch && imgMatch[1] ? imgMatch[1].trim() : '';
          if (altText) {
            const id = `img-${imageCaptions.length}`;
            imageCaptions.push({
              id,
              altText,
              outputIndex: outputLines.length,
            });
          }
        }

        outputLines.push(line);
        continue;
      }

      // 结构性行（标题/列表项）尽量作为单独段落，方便上下文清晰
      const isHeading = /^#{1,6}\s+/.test(trimmed);
      const isListItem = /^(\*|-|\+)\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);

      if ((isHeading || isListItem) && currentTextLines.length > 0) {
        flushCurrentSegment();
      }

      // 其他行：加入可翻译段落
      currentTextLines.push(line);
    }

    // 结束时刷新残留段落
    flushCurrentSegment();

    if (segments.length === 0) {
      return markdownContent;
    }

    // 查缓存
    const cachedTranslations = {};
    const uncachedSegments = [];

    for (const seg of segments) {
      const cached = await this._getFromCache(seg.text);
      if (cached) {
        cachedTranslations[seg.id] = cached;
      } else {
        uncachedSegments.push(seg);
      }
    }

    this.logger.info('Markdown translation segments', {
      total: segments.length,
      fromCache: segments.length - uncachedSegments.length,
      uncached: uncachedSegments.length,
    });

    // 处理未命中缓存的段落
    if (uncachedSegments.length > 0) {
      const batchSize = 5; // 减小批次大小，降低超时风险
      const batches = [];
      for (let i = 0; i < uncachedSegments.length; i += batchSize) {
        batches.push(uncachedSegments.slice(i, i + batchSize));
      }

      this.logger.info(`Starting Markdown translation batches`, {
        totalBatches: batches.length,
        batchSize,
        concurrency: this.concurrency,
      });

      const limit = pLimit(this.concurrency || 1);
      let completedBatches = 0;
      let failedBatches = 0;

      const tasks = batches.map((batch, batchIndex) =>
        limit(async () => {
          const batchStartTime = Date.now();
          this.logger.debug(`Starting batch ${batchIndex + 1}/${batches.length}`, {
            segmentCount: batch.length,
          });

          try {
            // 为每个批次添加独立的超时保护
            const batchTimeout = this.timeoutMs || 60000;
            let batchTimeoutId;
            const timeoutPromise = new Promise((_, reject) => {
              batchTimeoutId = setTimeout(
                () => reject(new Error(`Batch ${batchIndex + 1} timeout after ${batchTimeout}ms`)),
                batchTimeout
              );
              // 避免测试环境中因挂起的定时器导致 Jest 报告 open handles
              if (batchTimeoutId && typeof batchTimeoutId.unref === 'function') {
                batchTimeoutId.unref();
              }
            });

            const translatePromise = this._translateBatchWithRetry(batch);
            let res;
            try {
              res = await Promise.race([translatePromise, timeoutPromise]);
            } finally {
              if (batchTimeoutId) {
                clearTimeout(batchTimeoutId);
              }
            }

            if (res) {
              const cacheWriteTasks = [];
              Object.entries(res).forEach(([id, translated]) => {
                const originalItem = batch.find((item) => item.id === id);
                if (originalItem) {
                  cacheWriteTasks.push(this._saveToCache(originalItem.text, translated));
                  cachedTranslations[id] = translated;
                }
              });
              await Promise.all(cacheWriteTasks);
            }

            completedBatches++;
            this.logger.info(`Batch ${batchIndex + 1}/${batches.length} completed`, {
              elapsed: Date.now() - batchStartTime,
              progress: `${completedBatches}/${batches.length}`,
            });
          } catch (err) {
            failedBatches++;
            this.logger.error(`Batch ${batchIndex + 1}/${batches.length} failed after retries`, {
              error: err.message,
              elapsed: Date.now() - batchStartTime,
              progress: `${completedBatches}/${batches.length}`,
            });
          } finally {
            await delay(200);
          }
        })
      );

      // 为整个批处理过程添加总超时
      const totalTimeout = (this.timeoutMs || 60000) * batches.length;
      let totalTimeoutId;
      const totalTimeoutPromise = new Promise((_, reject) => {
        totalTimeoutId = setTimeout(
          () => reject(new Error(`Total translation timeout after ${totalTimeout}ms`)),
          totalTimeout
        );
        // 同样避免在测试环境中保持事件循环存活
        if (totalTimeoutId && typeof totalTimeoutId.unref === 'function') {
          totalTimeoutId.unref();
        }
      });

      try {
        await Promise.race([Promise.all(tasks), totalTimeoutPromise]);
        this.logger.info('All Markdown translation batches completed', {
          completed: completedBatches,
          failed: failedBatches,
          total: batches.length,
        });
      } catch (err) {
        this.logger.warn('Markdown translation batches did not complete in time', {
          error: err.message,
          completed: completedBatches,
          failed: failedBatches,
          total: batches.length,
        });
        // 即使超时，也继续处理已完成的翻译
      } finally {
        if (totalTimeoutId) {
          clearTimeout(totalTimeoutId);
        }
      }
    }

    // 如果是双语模式，为图片 alt 文本单独做一次翻译，用于在图片下方追加译文图注
    const captionTranslations = {};
    if (this.bilingual && imageCaptions.length > 0) {
      const uncachedCaptionSegs = [];

      for (const cap of imageCaptions) {
        const cached = await this._getFromCache(cap.altText);
        if (cached) {
          captionTranslations[cap.id] = cached;
        } else if (cap.altText) {
          uncachedCaptionSegs.push({ id: cap.id, text: cap.altText });
        }
      }

      if (uncachedCaptionSegs.length > 0) {
        try {
          const result = await this._translateBatchWithRetry(uncachedCaptionSegs);
          if (result) {
            const cacheWriteTasks = [];
            Object.entries(result).forEach(([id, translated]) => {
              const originalItem = uncachedCaptionSegs.find((item) => item.id === id);
              if (originalItem) {
                cacheWriteTasks.push(this._saveToCache(originalItem.text, translated));
              }
              captionTranslations[id] = translated;
            });
            await Promise.all(cacheWriteTasks);
          }
        } catch (err) {
          this.logger.warn('Image caption translation failed, will use original captions', {
            error: err.message,
            count: uncachedCaptionSegs.length,
          });
        }
      }

      // 将译文挂回 imageCaptions，方便重建 Markdown 时插入
      for (const cap of imageCaptions) {
        const translated = captionTranslations[cap.id];
        if (typeof translated === 'string') {
          cap.translated = translated;
        }
      }
    }

    // 重建 Markdown：用翻译结果替换占位符，并在图片下方追加译文图注（仅双语模式）
    const idToOriginal = {};
    for (const seg of segments) {
      idToOriginal[seg.id] = seg.text;
    }

    const finalLines = outputLines.map((line, index) => {
      const match = line.match(/^__MD_SEGMENT_(.+)__$/);
      if (match) {
        const id = match[1];
        const original = idToOriginal[id] || '';
        const translated = cachedTranslations[id] || original;

        if (this.bilingual) {
          return `${original}\n\n${translated}`;
        }

        return translated;
      }

      // 为图片行追加一行译文图注：
      // ![Figure 1: ...](/img)
      // _图 1：..._
      if (this.bilingual && imageCaptions.length > 0) {
        const cap = imageCaptions.find((c) => c.outputIndex === index);
        if (cap && typeof cap.translated === 'string') {
          const translatedCaption = cap.translated.trim();
          if (translatedCaption && translatedCaption !== cap.altText.trim()) {
            return `${line}\n_${translatedCaption}_`;
          }
        }
      }

      return line;
    });

    // 在最终返回前，按规范将中文句子内部的 `_字_` 形式转换为 `*字*`
    // 这是 Pandoc 和 CommonMark 推荐的写法，可以避免 intraword underscore
    // 被忽略为普通字符，从而确保中文斜体在 PDF 中正常生效。
    return this._normalizeCjkEmphasis(finalLines.join('\n'));
  }

  /**
   * Translate a batch of elements using spawn
   * @param {Array} batch
   * @returns {Promise<Object>} Map of id -> translated text
   */
  async _translateBatch(batch) {
    const inputMap = {};
    batch.forEach((item) => {
      inputMap[item.id] = item.text;
    });

    const instructions = `
You are a professional technical translator for developer-facing documentation.
Your task is to translate ONLY the JSON object values into ${this.targetLanguage}.

Input format:
- You receive a single JSON object: { "<id>": "<text>", ... }.
- Keys are opaque IDs and must stay exactly the same.

Output requirements:
- Return EXACTLY ONE JSON object with the same keys and translated values.
- Do NOT add, remove, rename, or reorder any keys.
- Do NOT add any comments, explanations, or extra fields.
- Do NOT output any text before or after the JSON.
- The output must be directly parseable by JSON.parse (no trailing commas, no code fences, no Markdown wrapping).

Content rules:
- The values may contain Markdown formatting (headings, lists, links, emphasis) and code snippets.
- Preserve all Markdown syntax characters (such as #, *, -, _, [, ], (, ), backticks, and code fences).
- Preserve code blocks, inline code, command-line examples, configuration keys, and file paths.
- Do NOT translate code identifiers, API names, library/package names, CLI commands, configuration keys, or URLs.

	Placeholders and tags:
	- Do NOT modify or translate placeholders such as {name}, {{ user }}, \${var}, %s, %{count}, or similar patterns.
	- Do NOT translate HTML/JSX tag names or attribute names (for example <Button onClick={handleClick}>).
	- Keep anything inside angle brackets that looks like a tag or generic type parameter unchanged.

Style guidelines:
- Use clear, concise, formal language suitable for technical documentation for software engineers.
- Prefer terminology commonly used by professional developers when there are multiple valid translations.

Output ONLY the final JSON object with translated values.
	`;

    if (!this.client) {
      this.client = new GeminiClient({
        timeoutMs: this.timeoutMs,
        logger: this.logger,
      });
    }

    return this.client.translateJson({
      instructions,
      inputMap,
    });
  }

  /**
   * Translate a single segment (for individual retry)
   * @param {Object} segment - { id, text }
   * @returns {Promise<Object>} { id: translatedText }
   */
  async _translateSingleSegment(segment) {
    return this._translateBatch([segment]);
  }

  /**
   * Batch translation with segment-level retry (best practice)
   * First attempts batch translation, then retries failed segments individually
   * Uses exponential backoff with decorrelated jitter
   * Note: This method is "best-effort" and may return partial results when
   * some segments permanently fail; callers should handle untranslated
   * segments gracefully (they will keep the original content).
   * @param {Array} batch - Array of { id, text } objects
   * @returns {Promise<Object>} Map of id -> translated text
   */
  async _translateBatchWithRetry(batch) {
    const maxSegmentRetries = this.maxSegmentRetries ?? 2;
    const jitterStrategy = this.jitterStrategy ?? 'decorrelated';
    const maxDelay = this.maxDelay ?? 30000;

    // First attempt: try the entire batch
    let results = {};
    let failedSegments = [...batch];

    try {
      const batchResult = await retry(() => this._translateBatch(batch), {
        maxAttempts: this.maxRetries,
        delay: this.retryDelay,
        backoff: 2,
        maxDelay,
        jitterStrategy,
        onRetry: (attempt, error, waitTime) => {
          this.logger.warn('Retrying translation batch', {
            attempt,
            maxAttempts: this.maxRetries,
            error: error.message,
            waitTime: `${waitTime} ms`,
            jitterStrategy,
          });
        },
      });

      if (batchResult) {
        results = { ...batchResult };
        // Identify segments that did not return any result
        // 注意：不能用“真假值”判断，否则空字符串会被误判为失败
        failedSegments = batch.filter((seg) => !(seg.id in batchResult));
      }
    } catch (batchError) {
      this.logger.warn('Batch translation failed, will retry individual segments', {
        error: batchError.message,
        segmentCount: batch.length,
      });
    }

    // Second phase: retry failed segments individually
    if (failedSegments.length > 0 && failedSegments.length < batch.length) {
      this.logger.info('Retrying failed segments individually', {
        failedCount: failedSegments.length,
        totalCount: batch.length,
      });
    }

    for (const segment of failedSegments) {
      try {
        const segmentResult = await retry(() => this._translateSingleSegment(segment), {
          maxAttempts: maxSegmentRetries,
          delay: this.retryDelay,
          backoff: 2,
          maxDelay,
          jitterStrategy,
          onRetry: (attempt, error, waitTime) => {
            this.logger.warn('Retrying single segment', {
              segmentId: segment.id,
              attempt,
              maxAttempts: maxSegmentRetries,
              error: error.message,
              waitTime: `${waitTime} ms`,
            });
          },
        });

        if (segmentResult && segmentResult[segment.id]) {
          results[segment.id] = segmentResult[segment.id];
          this.logger.debug('Segment retry succeeded', { segmentId: segment.id });
        }
      } catch (segmentError) {
        this.logger.error('Segment retry exhausted', {
          segmentId: segment.id,
          text: segment.text.substring(0, 50) + '...',
          error: segmentError.message,
        });
        // Continue with other segments even if one fails
      }
    }

    // Log final stats
    const successCount = Object.keys(results).length;
    const failCount = batch.length - successCount;

    if (failCount > 0) {
      this.logger.warn('Batch completed with some failures', {
        success: successCount,
        failed: failCount,
        total: batch.length,
      });
    }

    return results;
  }
}
