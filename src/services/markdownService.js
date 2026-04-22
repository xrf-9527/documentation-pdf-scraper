// src/services/markdownService.js
import TurndownService from 'turndown';

/**
 * MarkdownService
 * - 将 HTML 内容转换为 Markdown
 * - 从 Puppeteer 页面提取内容并预处理（例如 SVG）
 * - 处理 YAML frontmatter 的添加与解析
 */
export class MarkdownService {
  constructor(options = {}) {
    this.logger = options.logger;
    this.config = options.config || {};
    this.markdownConfig = this.config.markdown || options.markdown || {};

    const turndownOptions = {
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      ...options.turndownOptions,
    };

    this.turndown = new TurndownService(turndownOptions);

    // 剥离非正文且可能污染 LaTeX 的元素。
    // 背景：某些站点（例如 developers.openai.com 的 Next.js 构建）会把
    // 压缩后的 JavaScript 直接嵌入正文容器内的 <script> 标签，其中裸露的
    // `&` 字符会让 Pandoc → XeLaTeX 以 `Misplaced alignment tab character &.`
    // 报错并中止 PDF 生成。CSS 字面量同理。统一在此剥离，使 Markdown 工作流
    // 无需依赖 pdfStyleService（后者仅在 enablePDFStyleProcessing=true 时生效）。
    this.turndown.remove(['script', 'noscript', 'style', 'template']);

    // 使用 `*text*` 而不是 `_text_` 来表示 HTML <em>/<i> 强调，
    // 这样生成的 Markdown 更符合 Pandoc / CommonMark 对“词内部强调优先使用 *”的最佳实践，
    // 避免在中英文混排场景下由下划线强调带来的歧义。
    this.turndown.addRule('emphasis', {
      filter: ['em', 'i'],
      replacement: (content) => {
        if (!content) return '';
        return `*${content}*`;
      },
    });

    // 使用 `**text**` 而不是 `__text__` 表示 HTML <strong>/<b> 的粗体，
    // 统一 strong 风格，便于在 Pandoc / CommonMark 中与 * / ** 规则配合使用。
    this.turndown.addRule('strong', {
      filter: ['strong', 'b'],
      replacement: (content) => {
        if (!content) return '';
        return `**${content}**`;
      },
    });

    // 使用 `~~text~~` 表示删除线，将 HTML <del>/<s>/<strike> 统一为 GFM/Pandoc
    // 常用的删除风格，便于在 Markdown → PDF 流水线中得到一致展示。
    this.turndown.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
      replacement: (content) => {
        if (!content) return '';
        return `~~${content}~~`;
      },
    });

    // 保留代码块语言标识（```js``` 等）
    this.turndown.addRule('fencedCodeBlockWithLanguage', {
      filter: (node) => {
        return node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
      },
      replacement: (content, node) => {
        const codeElement = node.firstChild;
        const className = codeElement.className || '';

        const langMatch = className.match(/language-([\w-]+)/) || className.match(/lang-([\w-]+)/);

        const lang = langMatch ? langMatch[1] : '';
        const code = codeElement.textContent || '';

        const fence = '```';
        const langSuffix = lang ? `${lang}` : '';

        return `\n${fence}${langSuffix}\n${code.replace(/\n$/, '')}\n${fence}\n`;
      },
    });
  }

  /**
   * 将相对资源 URL 规范化为绝对 URL，避免 Pandoc 在 PDF 阶段把站点内资源
   * 误当成本地文件路径处理（例如 `/images/...`）。
   *
   * @param {string} markdown
   * @param {string} pageUrl
   * @returns {string}
   */
  normalizeResourceUrls(markdown, pageUrl) {
    if (!markdown || typeof markdown !== 'string' || !pageUrl) {
      return markdown;
    }

    let normalized = markdown;

    // Markdown links/images: ![alt](/img.png) / [text](/guide)
    normalized = normalized.replace(
      /(!?\[[^\]]*]\(\s*)(<)?((?:\/{1,2}|\.{1,2}\/)[^)\s>]+(?:\?[^)\s>]*)?(?:#[^)\s>]*)?)(>)?((?:\s+["'][^"']*["'])?\s*\))/g,
      (match, prefix, openBracket = '', target, closeBracket = '', suffix) => {
        const resolved = this._resolveResourceUrl(target, pageUrl);
        return resolved ? `${prefix}${openBracket}${resolved}${closeBracket}${suffix}` : match;
      }
    );

    // Raw HTML img/a tags embedded in markdown.
    normalized = normalized.replace(
      /(<(?:img|a)\b[^>]*?\b(?:src|href)=["'])([^"']+)(["'][^>]*>)/gi,
      (match, prefix, target, suffix) => {
        const resolved = this._resolveResourceUrl(target, pageUrl);
        return resolved ? `${prefix}${resolved}${suffix}` : match;
      }
    );

    // Raw HTML source tags with srcset, e.g. <source srcset="/foo.webp 1x, /bar.webp 2x">
    normalized = normalized.replace(
      /(<source\b[^>]*?\bsrcset=["'])([^"']+)(["'][^>]*>)/gi,
      (match, prefix, srcset, suffix) => {
        const resolved = this._resolveSrcset(srcset, pageUrl);
        return resolved ? `${prefix}${resolved}${suffix}` : match;
      }
    );

    return normalized;
  }

  /**
   * 将单个相对 URL 解析为绝对 URL。
   *
   * @param {string} target
   * @param {string} pageUrl
   * @returns {string}
   * @private
   */
  _resolveResourceUrl(target, pageUrl) {
    if (!target || typeof target !== 'string' || !pageUrl) {
      return target;
    }

    const trimmed = target.trim();
    if (!trimmed) return target;

    // 已经是绝对 URL、锚点、内联数据或非网页协议时不处理。
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(trimmed)) {
      return trimmed;
    }

    const isRelativePath =
      trimmed.startsWith('/') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../') ||
      trimmed.startsWith('//');

    if (!isRelativePath) {
      return trimmed;
    }

    try {
      return new URL(trimmed, pageUrl).toString();
    } catch (error) {
      this.logger?.debug?.('资源 URL 规范化失败，保留原值', {
        pageUrl,
        target: trimmed,
        error: error.message,
      });
      return trimmed;
    }
  }

  /**
   * 解析 srcset 中的多个资源 URL。
   *
   * @param {string} srcset
   * @param {string} pageUrl
   * @returns {string}
   * @private
   */
  _resolveSrcset(srcset, pageUrl) {
    if (!srcset || typeof srcset !== 'string') {
      return srcset;
    }

    return srcset
      .split(',')
      .map((entry) => {
        const trimmed = entry.trim();
        if (!trimmed) return trimmed;

        const [target, ...descriptors] = trimmed.split(/\s+/);
        const resolved = this._resolveResourceUrl(target, pageUrl);

        return [resolved, ...descriptors].join(' ').trim();
      })
      .join(', ');
  }

  /**
   * 规范化图像与图注：
   * - 如果某行是斜体（例如 _Figure 1: ..._ 或 *Figure 1: ...*），
   * - 且其前一行（忽略空行）是 Markdown 图片行，并且两者文本几乎相同，
   *   则视为重复图注，删除斜体行，仅保留图片行作为 caption。
   * 这样可以与 Pandoc 的 implicit_figures 行为对齐：
   *   一张图片（单独成段）= 一个 figure + 一个 caption（来自 alt 文本）。
   * @param {string} markdown
   * @returns {string}
   */
  _normalizeFigureCaptions(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return markdown;
    }

    const lines = markdown.split('\n');

    const normalizeText = (text) => {
      if (!text) return '';
      return (
        text
          .trim()
          // 去掉首尾的强调符号（_ 或 *）
          .replace(/^[*_]+/, '')
          .replace(/[*_]+$/, '')
          .trim()
          // 去掉结尾的句号/感叹号等常见标点
          .replace(/[。．.!！]+$/u, '')
          .trim()
          .toLowerCase()
      );
    };

    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 匹配整行斜体：_text_ 或 *text*
      const italicMatch = trimmed.match(/^([*_])(.+)\1$/);
      if (italicMatch) {
        const italicText = italicMatch[2].trim();

        // 向上寻找上一行非空行
        let prevIndex = i - 1;
        while (prevIndex >= 0 && lines[prevIndex].trim() === '') {
          prevIndex--;
        }

        if (prevIndex >= 0) {
          const prevTrimmed = lines[prevIndex].trim();
          // 匹配单独一行的图片语法，允许可选的属性块：
          // ![alt](src) 或 ![alt](src){ ... }
          const imageMatch = prevTrimmed.match(/^!\[([^\]]+)\]\([^)]*\)\s*(\{[^}]*\})?$/);
          if (imageMatch) {
            const altText = imageMatch[1].trim();
            const normAlt = normalizeText(altText);
            const normItalic = normalizeText(italicText);

            if (normAlt && normAlt === normItalic) {
              // 认为是重复图注：跳过当前斜体行，不输出
              continue;
            }
          }
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  /**
   * 将 HTML 字符串转换为 Markdown
   * @param {string} html
   * @returns {string}
   */
  convertHtmlToMarkdown(html, options = {}) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    try {
      const rawMarkdown = this.turndown.turndown(html);
      const normalizedMarkdown = this.normalizeResourceUrls(rawMarkdown, options.pageUrl);
      const dedupedMarkdown = this._normalizeFigureCaptions(normalizedMarkdown);
      const markdown = this.sanitizeMarkdown(dedupedMarkdown, options);
      this.logger?.debug?.('HTML 转 Markdown 完成', {
        length: markdown.length,
        ...options.debugMeta,
      });
      return markdown;
    } catch (error) {
      this.logger?.error?.('HTML 转 Markdown 失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 从 Puppeteer 页面中提取内容区域，并转换为 Markdown
   * - 对 SVG 进行预处理：提取有意义的文本，忽略纯数字刻度
   * @param {import('puppeteer').Page} page
   * @param {string} selector
   * @returns {Promise<string>}
   */
  async extractAndConvertPage(page, selector) {
    const pageUrl = typeof page.url === 'function' ? page.url() : undefined;
    const { html, svgCount, openAiModelSections = [] } = await page.evaluate((contentSelector, currentPageUrl) => {
      const container = document.querySelector(contentSelector);
      if (!container) {
        return { html: '', svgCount: 0, openAiModelSections: [] };
      }

      const clone = container.cloneNode(true);
      const normalizeWhitespace = (text = '') => text.replace(/\s+/g, ' ').trim();
      const isOpenAiDocsPage = (() => {
        if (!currentPageUrl) return false;
        try {
          return new URL(currentPageUrl).hostname === 'developers.openai.com';
        } catch {
          return false;
        }
      })();
      let openAiModelSections = [];

      const getVisibleText = (element) => {
        const textClone = element.cloneNode(true);
        textClone
          .querySelectorAll(
            'script, style, noscript, template, img, svg, [aria-hidden="true"], [aria-live], .sr-only, [hidden]'
          )
          .forEach((node) => node.remove());

        return normalizeWhitespace(textClone.textContent || '');
      };

      if (isOpenAiDocsPage) {
        const decodeAstroValue = (value) => {
          if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number') {
            const [type, payload] = value;

            if (type === 1 && Array.isArray(payload)) {
              return payload.map(decodeAstroValue);
            }

            return decodeAstroValue(payload);
          }

          if (Array.isArray(value)) {
            return value.map(decodeAstroValue);
          }

          if (value && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value).map(([key, nestedValue]) => [key, decodeAstroValue(nestedValue)])
            );
          }

          return value;
        };

        const parseModelCard = (island) => {
          if (!island) return null;

          let props = {};
          try {
            props = decodeAstroValue(JSON.parse(island.getAttribute('props') || '{}'));
          } catch {
            props = {};
          }

          const name = normalizeWhitespace(
            props.name
              || island.querySelector('img')?.getAttribute('alt')
              || island.querySelector('.heading-md, .heading-sm, h3, h4')?.textContent
              || ''
          );
          const description = normalizeWhitespace(
            props.description || island.querySelector('p')?.textContent || ''
          );
          const command = normalizeWhitespace(
            island.querySelector('.font-mono')?.textContent || (name ? `codex -m ${name}` : '')
          );
          const features = Array.isArray(props.data?.features)
            ? props.data.features
              .map((feature) => {
                const title = normalizeWhitespace(feature?.title || '');
                if (!title) return null;

                return {
                  title,
                  value: typeof feature?.value === 'boolean' ? feature.value : normalizeWhitespace(feature?.value || ''),
                  iconCount: Array.isArray(feature?.icons) ? feature.icons.length : 0,
                };
              })
              .filter(Boolean)
            : [];

          if (!name && !description && !command && features.length === 0) {
            return null;
          }

          return {
            name,
            description,
            command,
            features,
          };
        };

        const collectModelSections = () => {
          if (!/\/codex\/models\/?$/.test(currentPageUrl || '')) {
            return [];
          }

          const sections = [];
          const sectionHeadings = Array.from(clone.querySelectorAll('h2'));

          sectionHeadings.forEach((heading) => {
            const headingText = normalizeWhitespace(heading.textContent || '');
            if (!['Recommended models', 'Alternative models'].includes(headingText)) {
              return;
            }

            let grid = heading.nextElementSibling;
            while (grid && !grid.querySelector?.('astro-island[component-url*="ModelDetails"]')) {
              if (/^H2$/i.test(grid.tagName)) {
                grid = null;
                break;
              }
              grid = grid.nextElementSibling;
            }

            if (!grid) {
              return;
            }

            const cards = Array.from(
              grid.querySelectorAll('astro-island[component-url*="ModelDetails"]')
            )
              .map(parseModelCard)
              .filter(Boolean);

            if (cards.length === 0) {
              return;
            }

            const notes = [];
            let sibling = grid.nextElementSibling;
            while (sibling && !/^H2$/i.test(sibling.tagName)) {
              const text = getVisibleText(sibling);
              if (text && !sibling.querySelector?.('astro-island[component-url*="ModelDetails"]')) {
                notes.push(text);
              }
              sibling = sibling.nextElementSibling;
            }

            sections.push({
              heading: headingText,
              cards,
              notes,
            });
          });

          return sections;
        };

        openAiModelSections = collectModelSections();

        clone
          .querySelectorAll(
            'script, noscript, style, template, [data-page-copy-action], .page-copy-action, [data-anchor-id], [data-codex-screenshot-overlay]'
          )
          .forEach((node) => node.remove());

        clone.querySelectorAll('nav').forEach((nav) => {
          const text = normalizeWhitespace(nav.textContent || '');
          if (/\bPrevious\b/.test(text) && /\bNext\b/.test(text)) {
            nav.remove();
          }
        });

        const normalizePanelLabel = (label) => {
          if (!label) return '';

          const lower = label.toLowerCase();
          if (lower === 'app') return 'App (Recommended)';
          if (lower === 'ide') return 'IDE extension';
          if (lower === 'cli') return 'CLI';
          if (lower === 'cloud') return 'Cloud';

          return label;
        };

        clone.querySelectorAll('[role="tablist"]').forEach((tabList) => tabList.remove());

        const tabPanels = Array.from(clone.querySelectorAll('[data-panel][role="region"], [role="tabpanel"]'));
        if (tabPanels.length > 1) {
          tabPanels.forEach((panel) => {
            panel.removeAttribute('hidden');
            panel.setAttribute('aria-hidden', 'false');

            const label = normalizePanelLabel(
              normalizeWhitespace(panel.getAttribute('aria-label') || panel.getAttribute('data-panel') || '')
            );

            if (!label || !panel.parentNode) {
              return;
            }

            const previousElement = panel.previousElementSibling;
            if (
              previousElement &&
              /^H[1-6]$/.test(previousElement.tagName) &&
              normalizeWhitespace(previousElement.textContent || '') === label
            ) {
              return;
            }

            const heading = document.createElement('h3');
            heading.textContent = label;
            panel.parentNode.insertBefore(heading, panel);
          });
        }

        clone.querySelectorAll('[data-codex-screenshot-root]').forEach((root) => {
          const inlineImage =
            root.querySelector('img[data-codex-screenshot-inline-image]') ||
            Array.from(root.querySelectorAll('img')).find(
              (image) => !image.closest('[data-codex-screenshot-overlay]')
            );

          if (!inlineImage) {
            root.remove();
            return;
          }

          const figure = document.createElement('figure');
          const imageClone = inlineImage.cloneNode(true);
          imageClone.removeAttribute('style');
          imageClone.removeAttribute('class');
          figure.appendChild(imageClone);
          root.replaceWith(figure);
        });

        clone.querySelectorAll('button').forEach((button) => {
          const label = button.getAttribute('aria-label') || '';
          const text = getVisibleText(button);
          const copiedBadge = Array.from(button.querySelectorAll('[aria-hidden="true"]')).some((node) =>
            /copied/i.test(node.textContent || '')
          );
          const hasExampleIcon = !!button.querySelector('img[src*="/codex/colorcons/"]');

          if (copiedBadge || hasExampleIcon) {
            if (!text) {
              button.remove();
              return;
            }

            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            button.replaceWith(paragraph);
            return;
          }

          if (!text || /copy|close|open/i.test(label)) {
            button.remove();
          }
        });
      }

      const svgs = clone.querySelectorAll('svg');

      svgs.forEach((svg) => {
        try {
          const texts = [];

          const titleEl = svg.querySelector('title');
          if (titleEl && titleEl.textContent) {
            texts.push(titleEl.textContent.trim());
          }

          const descEl = svg.querySelector('desc');
          if (descEl && descEl.textContent) {
            texts.push(descEl.textContent.trim());
          }

          const textNodes = Array.from(svg.querySelectorAll('text'))
            .map((node) => node.textContent || '')
            .map((t) => t.trim())
            .filter((t) => t && !/^[\d\s.,%-]+$/.test(t)); // 过滤纯数字刻度

          texts.push(...textNodes);

          if (texts.length > 0) {
            const figure = document.createElement('figure');
            const caption = document.createElement('figcaption');
            caption.textContent = texts.join(' | ');

            svg.parentNode.insertBefore(figure, svg);
            figure.appendChild(svg);
            figure.appendChild(caption);
          }
        } catch {
          // SVG 处理失败不应该阻塞整体流程
          // 这里不在浏览器环境里打印日志，交给外层处理
        }
      });

      return {
        html: clone.innerHTML,
        svgCount: svgs.length,
        openAiModelSections,
      };
    }, selector, pageUrl);

    this.logger?.debug?.('从页面提取 HTML 完成', {
      hasContent: !!html,
      svgCount,
      openAiModelSections: openAiModelSections.length,
    });

    let markdown = this.convertHtmlToMarkdown(html, {
      debugMeta: { svgCount },
      pageUrl,
    });

    markdown = this._normalizeOpenAiModelsPage(markdown, openAiModelSections, pageUrl);

    return markdown;
  }

  /**
   * 对 Markdown 做轻量级站点感知清洗，移除交互残留并保留正文可读性。
   *
   * @param {string} markdown
   * @param {Object} options
   * @returns {string}
   */
  sanitizeMarkdown(markdown, options = {}) {
    if (!markdown || typeof markdown !== 'string') {
      return '';
    }

    let sanitized = markdown;

    sanitized = sanitized.replace(/^\s*Copy Page\s*$/gim, '');
    sanitized = sanitized.replace(/^\s*Copied\s*$/gim, '');

    if (this._isOpenAiDocsPage(options.pageUrl)) {
      sanitized = this._normalizeOpenAiWrappedCardLinks(sanitized, options.pageUrl);
      sanitized = this._normalizeOpenAiExampleTaskCards(sanitized);
      sanitized = this._stripOpenAiPagerNavigation(sanitized);
      sanitized = this._normalizeOpenAiQuickstartTabSummary(sanitized);
      sanitized = this._normalizeOpenAiCliSetupCards(sanitized, options.pageUrl);
      sanitized = this._collapseOpenAiThemeVariantPairs(sanitized);
      sanitized = this._simplifyOpenAiUseCasesIndex(sanitized, options.pageUrl);
    }

    sanitized = this._dedupeConsecutiveImageParagraphs(sanitized);

    return sanitized.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * 将 Codex Models 页里被扁平化的模型卡片重建为紧凑、适合 PDF 的 Markdown。
   *
   * @param {string} markdown
   * @param {Array<{ heading: string, cards: Array<Object>, notes?: string[] }>} modelSections
   * @param {string} pageUrl
   * @returns {string}
   * @private
   */
  _normalizeOpenAiModelsPage(markdown, modelSections = [], pageUrl = '') {
    if (!markdown || !/\/codex\/models\/?$/.test(pageUrl) || !Array.isArray(modelSections) || modelSections.length === 0) {
      return markdown;
    }

    const iconScaleByTitle = {};
    for (const section of modelSections) {
      for (const card of section.cards || []) {
        for (const feature of card.features || []) {
          if (!feature?.title || !feature.iconCount) {
            continue;
          }

          iconScaleByTitle[feature.title] = Math.max(
            iconScaleByTitle[feature.title] || 0,
            feature.iconCount
          );
        }
      }
    }

    const wrapKnownModelNames = (text) => {
      if (!text) return text;

      return text.replace(/\b(gpt-\d+(?:\.\d+)?(?:-[a-z0-9]+)*)\b/gi, '`$1`');
    };

    const formatFeature = (feature) => {
      if (!feature?.title) return '';

      if (typeof feature.value === 'boolean') {
        return `- ${feature.title}: ${feature.value ? 'Yes' : 'No'}`;
      }

      if (typeof feature.value === 'string' && feature.value.trim()) {
        return `- ${feature.title}: ${feature.value.trim()}`;
      }

      if (feature.iconCount) {
        const max = iconScaleByTitle[feature.title] || feature.iconCount;
        return `- ${feature.title}: ${feature.iconCount}/${max}`;
      }

      return `- ${feature.title}`;
    };

    const formatCard = (card) => {
      if (!card?.name) return '';

      const parts = [`### ${card.name}`];

      if (card.description) {
        parts.push('', card.description);
      }

      if (card.command) {
        parts.push('', '```bash', card.command, '```');
      }

      const featureLines = (card.features || []).map(formatFeature).filter(Boolean);
      if (featureLines.length > 0) {
        parts.push('', featureLines.join('\n'));
      }

      return parts.join('\n');
    };

    const escapeHeading = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let normalized = markdown;
    for (let index = 0; index < modelSections.length; index++) {
      const section = modelSections[index];
      if (!section?.heading || !Array.isArray(section.cards) || section.cards.length === 0) {
        continue;
      }

      const nextHeading = modelSections[index + 1]?.heading || 'Other models';
      const sectionBody = section.cards
        .map(formatCard)
        .filter(Boolean)
        .join('\n\n');
      const noteBody = (section.notes || [])
        .map((note) => wrapKnownModelNames(note))
        .filter(Boolean)
        .join('\n\n');
      const replacement = [sectionBody, noteBody].filter(Boolean).join('\n\n');

      if (!replacement) {
        continue;
      }

      const pattern = new RegExp(
        `(## ${escapeHeading(section.heading)}\\n\\n)([\\s\\S]*?)(?=\\n## ${escapeHeading(nextHeading)}\\n|$)`
      );

      normalized = normalized.replace(pattern, `$1${replacement}\n\n`);
    }

    return normalized;
  }

  /**
   * 判断是否为 developers.openai.com 文档页面。
   *
   * @param {string} pageUrl
   * @returns {boolean}
   * @private
   */
  _isOpenAiDocsPage(pageUrl) {
    if (!pageUrl || typeof pageUrl !== 'string') {
      return false;
    }

    try {
      return new URL(pageUrl).hostname === 'developers.openai.com';
    } catch {
      return false;
    }
  }

  /**
   * 修复 OpenAI 首页等页面中的“整块卡片是链接”被 Turndown 打碎后的残留 Markdown。
   *
   * 典型坏形态：
   * [
   *
   * ### Quickstart
   *
   * Download and start building with Codex.
   *
   * Get started](https://...)
   *
   * 期望输出：
   * ### Quickstart
   *
   * Download and start building with Codex.
   *
   * [Get started](https://...)
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _normalizeOpenAiWrappedCardLinks(markdown, pageUrl = '') {
    if (!markdown) return markdown;

    let normalized = markdown;

    normalized = normalized.replace(/^\s*\[\]\([^)]+\)\s*$/gm, '');

    normalized = normalized.replace(
      /\[\s*((?:!\[[^\]]*]\([^)]*\)\s*)+)\n*(#{1,6}\s+[^\n]+)\n+([\s\S]*?)(?:\n+\]\(([^)\n]+)\)|\]\(([^)\n]+)\))(?=\s*(?:\n|$|\[))/g,
      (match, images, heading, body, lineBreakUrl, inlineUrl) => {
        const resolvedUrl = this._resolveResourceUrl((lineBreakUrl || inlineUrl || '').trim(), pageUrl);
        const normalizedImages = images.trim();
        const normalizedBody = body.trim();
        const headingMatch = heading.trim().match(/^(#{1,6})\s+(.+)$/);

        if (!normalizedImages || !normalizedBody || !headingMatch) {
          return match;
        }

        const [, hashes, headingText] = headingMatch;
        const linkedHeading = `${hashes} [${headingText.trim()}](${resolvedUrl})`;

        return [normalizedImages, '', linkedHeading, '', normalizedBody, '', ''].join('\n');
      }
    );

    normalized = normalized.replace(
      /\[\s*((?:!\[[^\]]*]\([^)]*\)\s*)+)\n*([^\n#![][^)\n]*)\n+([\s\S]*?)(?:\n+\]\(([^)\n]+)\)|\]\(([^)\n]+)\))(?=\s*(?:\n|$|\[))/g,
      (match, images, title, body, lineBreakUrl, inlineUrl) => {
        const resolvedUrl = this._resolveResourceUrl((lineBreakUrl || inlineUrl || '').trim(), pageUrl);
        const normalizedImages = images.trim();
        const normalizedTitle = title.trim();
        const normalizedBody = body.trim();

        if (!normalizedImages || !normalizedTitle || !normalizedBody || !resolvedUrl) {
          return match;
        }

        return [
          normalizedImages,
          '',
          `### [${normalizedTitle}](${resolvedUrl})`,
          '',
          normalizedBody,
          '',
          '',
        ].join('\n');
      }
    );

    normalized = normalized.replace(
      /\[\s*\n+(#{1,6}\s+[^\n]+)\n+([\s\S]*?)\n+\]\(([^)\n]+)\)(?=\s*(?:\n|$|\[))/g,
      (match, heading, body, url) => {
        const headingMatch = heading.trim().match(/^(#{1,6})\s+(.+)$/);
        const normalizedBody = body.trim();
        const normalizedUrl = this._resolveResourceUrl(url.trim(), pageUrl);

        if (!headingMatch || !normalizedBody || !normalizedUrl) {
          return match;
        }

        const [, hashes, headingText] = headingMatch;
        const linkedHeading = `${hashes} [${headingText.trim()}](${normalizedUrl})`;

        return [linkedHeading, '', normalizedBody, '', ''].join('\n');
      }
    );

    normalized = normalized.replace(
      /\[\s*\n+(#{1,6}\s+[^\n]+)\n+([\s\S]*?)\n+([^\]\n]+)\]\(([^)\n]+)\)(?=\s*(?:\n|$|\[))/g,
      (match, heading, body, label, url) => {
        const normalizedHeading = heading.trim();
        const normalizedBody = body.trim();
        const normalizedLabel = label.trim();
        const normalizedUrl = this._resolveResourceUrl(url.trim(), pageUrl);

        if (!normalizedHeading || !normalizedBody || !normalizedLabel || !normalizedUrl) {
          return match;
        }

        return [
          normalizedHeading,
          '',
          normalizedBody,
          '',
          `[${normalizedLabel}](${normalizedUrl})`,
          '',
          '',
        ].join('\n');
      }
    );

    normalized = normalized.replace(
      /(\[[^\]\n]+]\([^)]+\))(?=\[[^\]\n]+]\([^)]+\))/g,
      '$1\n'
    );

    normalized = normalized.replace(
      /^\[([^\n\]]+\[[^\]]+]\([^)]+\)[^\n]*)$/gm,
      '$1'
    );

    return normalized;
  }

  /**
   * 将 OpenAI 文档里的示例 prompt 卡片还原为普通项目符号列表。
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _normalizeOpenAiExampleTaskCards(markdown) {
    if (!markdown) return markdown;

    return markdown.replace(
      /(?:!\[[^\]]*]\([^)]*\)\s*[^!\n]+?\s*Copied\s*)+/g,
      (match) => {
        const prompts = Array.from(
          match.matchAll(/!\[[^\]]*]\([^)]*\)\s*([^!\n]+?)\s*Copied/gi),
          (entry) => entry[1].trim()
        ).filter(Boolean);

        if (prompts.length === 0) {
          return match;
        }

        return prompts.map((prompt) => `- ${prompt}`).join('\n');
      }
    );
  }

  /**
   * 移除 OpenAI 文档底部的上一页/下一页导航块。
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _stripOpenAiPagerNavigation(markdown) {
    if (!markdown) return markdown;

    const strippedPair = markdown.replace(
      /\[\s*Previous[\s\S]*?]\([^)]+\)\s*\[\s*Next[\s\S]*?]\([^)]+\)\s*$/m,
      ''
    );

    return strippedPair.replace(
      /\[\s*(?:Previous|Next)\s*[\s\S]*?]\([^)]+\)\s*$/m,
      ''
    );
  }

  /**
   * 兜底清理 Quickstart 页签按钮串成一行的残留文本。
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _normalizeOpenAiQuickstartTabSummary(markdown) {
    if (!markdown) return markdown;

    return markdown.replace(
      /^AppRecommendedIDE extensionCodex in your IDECLICodex in your terminalCloudCodex in your browser$/m,
      ['- App (Recommended)', '- IDE extension', '- CLI', '- Cloud'].join('\n')
    );
  }

  /**
   * 清理 Codex CLI 首页中由步骤卡片转换出来的重复数字与冗余标签。
   *
   * @param {string} markdown
   * @param {string} pageUrl
   * @returns {string}
   * @private
   */
  _normalizeOpenAiCliSetupCards(markdown, pageUrl = '') {
    if (!markdown || !/\/codex\/cli\/?$/.test(pageUrl)) {
      return markdown;
    }

    return markdown
      .replace(/^(\d+)\.\s+\1\s*$/gm, '$1.')
      .replace(/^\s*[A-Za-z][A-Za-z\s]+ command\s*$/gm, '');
  }

  /**
   * 精简 Codex use-cases 首页里的筛选按钮与装饰性大图，避免目录页在 PDF 中被图片撑成多页。
   *
   * @param {string} markdown
   * @param {string} pageUrl
   * @returns {string}
   * @private
   */
  _simplifyOpenAiUseCasesIndex(markdown, pageUrl = '') {
    if (!markdown || !/\/codex\/use-cases\/?$/.test(pageUrl)) {
      return markdown;
    }

    return markdown
      .replace(
        /^\[(?:[^\]]+)]\([^)]*\?search=[^)]+\)(?:\s+\[(?:[^\]]+)]\([^)]*\?search=[^)]+\))*\s*$/gm,
        ''
      )
      .replace(
        /^(?:#{1,6}\s+)?No use cases match these filters\s*\n+Try clearing a few filters or searching for a broader term\.\s*$/m,
        ''
      )
      .replace(/^\s*(?:!\[[^\]]*]\([^)]+\)\s*)+\s*$/gm, '');
  }

  /**
   * 将 OpenAI 文档中相邻的浅色/深色主题截图收敛为单张截图，避免在 PDF 中拼成超宽图片。
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _collapseOpenAiThemeVariantPairs(markdown) {
    if (!markdown) return markdown;

    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;

    return markdown.replace(
      /!\[[^\]]*]\([^)]+\)\s*!\[[^\]]*]\([^)]+\)/g,
      (match) => {
        const images = Array.from(match.matchAll(imagePattern), (entry) => ({
          raw: entry[0],
          alt: entry[1] || '',
          target: entry[2] || '',
        }));

        if (images.length < 2) {
          return match;
        }

        const [first, second] = images;
        if (!this._isOpenAiThemeVariantPair(first, second)) {
          return match;
        }

        const preferred = images.find((image) => /(?:^|[-_/])(light)(?:[-_.]|$)/i.test(image.target))
          || first;

        const cleanedAlt = preferred.alt
          .replace(/\s*\((?:light|dark) mode\)\s*/gi, '')
          .trim();

        return `![${cleanedAlt}](${preferred.target})`;
      }
    );
  }

  /**
   * 判断两张图片是否仅为浅色/深色主题变体。
   *
   * @param {{ alt: string, target: string }} first
   * @param {{ alt: string, target: string }} second
   * @returns {boolean}
   * @private
   */
  _isOpenAiThemeVariantPair(first, second) {
    if (!first || !second) {
      return false;
    }

    const normalizeAlt = (alt) => alt
      .replace(/\s*\((?:light|dark) mode\)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const normalizeTarget = (target) => {
      const trimmed = (target || '').trim();
      const [urlPart] = trimmed.split(/\s+"/, 1);

      try {
        const url = new URL(urlPart);
        return url.pathname
          .replace(/-(?:light|dark)(?=\.[a-z0-9]+$)/i, '')
          .replace(/\.[a-z0-9]+$/i, '')
          .toLowerCase();
      } catch {
        return urlPart
          .replace(/-(?:light|dark)(?=\.[a-z0-9]+$)/i, '')
          .replace(/\.[a-z0-9]+$/i, '')
          .toLowerCase();
      }
    };

    const firstAlt = normalizeAlt(first.alt);
    const secondAlt = normalizeAlt(second.alt);
    const firstTarget = normalizeTarget(first.target);
    const secondTarget = normalizeTarget(second.target);

    if (!firstTarget || !secondTarget || firstTarget !== secondTarget) {
      return false;
    }

    return firstAlt === secondAlt || !firstAlt || !secondAlt;
  }

  /**
   * 删除相邻的重复图片段落，避免同一张截图因浅色/弹层结构被重复保留。
   *
   * @param {string} markdown
   * @returns {string}
   * @private
   */
  _dedupeConsecutiveImageParagraphs(markdown) {
    if (!markdown) return markdown;

    const paragraphs = markdown.split(/\n{2,}/);
    const result = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      const previous = result[result.length - 1]?.trim();
      const isImageParagraph = /^(!\[[^\]]*]\([^)]*\)\s*)+$/.test(trimmed);

      if (isImageParagraph && previous === trimmed) {
        continue;
      }

      result.push(paragraph);
    }

    return result.join('\n\n');
  }

  /**
   * 为 Markdown 内容添加 YAML frontmatter
   * @param {string} markdown
   * @param {Object} metadata
   * @returns {string}
   */
  addFrontmatter(markdown, metadata = {}) {
    const includeFrontmatter = this.markdownConfig.includeFrontmatter !== false;

    if (!includeFrontmatter) {
      return markdown;
    }

    if (!metadata || Object.keys(metadata).length === 0) {
      return markdown;
    }

    // 如果已经存在 frontmatter，则不重复添加
    if (markdown.startsWith('---\n')) {
      return markdown;
    }

    const lines = ['---'];

    Object.entries(metadata).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      lines.push(`${key}: ${String(value)}`);
    });

    lines.push('---', '');

    const frontmatter = lines.join('\n');
    return `${frontmatter}${markdown}`;
  }

  /**
   * 解析 Markdown 中的 YAML frontmatter
   * 仅支持简单的 key: value 形式
   * @param {string} markdown
   * @returns {{ metadata: Object, content: string }}
   */
  parseFrontmatter(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return { metadata: {}, content: '' };
    }

    const lines = markdown.split('\n');
    if (lines.length === 0 || lines[0].trim() !== '---') {
      return { metadata: {}, content: markdown };
    }

    const metadata = {};
    let i = 1;

    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') {
        i++;
        break;
      }

      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (!match) {
        continue;
      }

      const key = match[1].trim();
      const rawValue = match[2].trim();

      let value = rawValue;
      if (rawValue === 'true' || rawValue === 'false') {
        value = rawValue === 'true';
      } else if (!Number.isNaN(Number(rawValue)) && rawValue !== '') {
        value = Number(rawValue);
      }

      metadata[key] = value;
    }

    const content = lines.slice(i).join('\n').replace(/^\n+/, '');
    return { metadata, content };
  }
}
