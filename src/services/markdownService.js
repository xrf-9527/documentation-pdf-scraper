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
      const markdown = this._normalizeFigureCaptions(normalizedMarkdown);
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
    const { html, svgCount } = await page.evaluate((contentSelector) => {
      const container = document.querySelector(contentSelector);
      if (!container) {
        return { html: '', svgCount: 0 };
      }

      const clone = container.cloneNode(true);
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
      };
    }, selector);

    this.logger?.debug?.('从页面提取 HTML 完成', {
      hasContent: !!html,
      svgCount,
    });

    return this.convertHtmlToMarkdown(html, {
      debugMeta: { svgCount },
      pageUrl,
    });
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
