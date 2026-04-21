import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/services/markdownService.test.js
import { MarkdownService } from '../../src/services/markdownService.js';

describe('MarkdownService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('convertHtmlToMarkdown 应该将简单 HTML 转为 Markdown', () => {
    const service = new MarkdownService({ logger });
    const html = '<h1>Title</h1><p>Content</p>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('Title');
    expect(markdown).toContain('Content');
  });

  test('convertHtmlToMarkdown 应该将根相对图片 URL 规范为绝对地址', () => {
    const service = new MarkdownService({ logger });
    const html = '<p><img src="/images/hero.png" alt="Hero"></p>';

    const markdown = service.convertHtmlToMarkdown(html, {
      pageUrl: 'https://developers.openai.com/codex/overview',
    });

    expect(markdown).toContain('![Hero](https://developers.openai.com/images/hero.png)');
  });

  test('normalizeResourceUrls 应该处理 markdown 链接、图片和 srcset', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '![Screenshot](/images/app.webp)',
      '[Guide](/guides/quickstart)',
      '<img src="./relative.png" alt="Relative">',
      '<source srcset="/img-1x.webp 1x, ../img-2x.webp 2x">',
    ].join('\n');

    const result = service.normalizeResourceUrls(
      markdown,
      'https://developers.openai.com/codex/reference/page'
    );

    expect(result).toContain('![Screenshot](https://developers.openai.com/images/app.webp)');
    expect(result).toContain('[Guide](https://developers.openai.com/guides/quickstart)');
    expect(result).toContain('<img src="https://developers.openai.com/codex/reference/relative.png"');
    expect(result).toContain(
      '<source srcset="https://developers.openai.com/img-1x.webp 1x, https://developers.openai.com/codex/img-2x.webp 2x">'
    );
  });

  test('convertHtmlToMarkdown 应该使用 * 而不是 _ 作为强调符号', () => {
    const service = new MarkdownService({ logger });
    const html = '<p>One person said that iterating with Claude has been <em>more</em> fun.</p>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('*more*');
    expect(markdown).not.toContain('_more_');
  });

  test('convertHtmlToMarkdown 应该使用 ** 而不是 __ 作为 strong 符号', () => {
    const service = new MarkdownService({ logger });
    const html = '<p>This is <strong>very</strong> important.</p>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('**very**');
    expect(markdown).not.toContain('__very__');
  });

  test('convertHtmlToMarkdown 应该使用 ~~ 作为删除线符号', () => {
    const service = new MarkdownService({ logger });

    const html = '<p>This is <del>deleted</del> text.</p>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('~~deleted~~');
  });

  test('convertHtmlToMarkdown 应该去重图片后的重复斜体图注', () => {
    const service = new MarkdownService({ logger });
    const html =
      '<figure><img src="/img.png" alt="Figure 1: Caption here"><figcaption><em>Figure 1: Caption here</em></figcaption></figure>';

    const markdown = service.convertHtmlToMarkdown(html);
    const lines = markdown.split('\n');

    // 应该保留一行带有 Figure 1 caption 的图片 Markdown
    const imageLines = lines.filter((line) => line.includes('![Figure 1: Caption here]'));
    expect(imageLines.length).toBe(1);

    // 同一段落中不应再出现重复的斜体图注行
    const duplicateItalic = lines.some((line) =>
      line.trim().match(/^[_*]Figure 1: Caption here[_*]$/)
    );
    expect(duplicateItalic).toBe(false);
  });

  test('convertHtmlToMarkdown 应该剥离 <script>/<style>/<noscript> 内容', () => {
    // Regression: OpenAI 文档页面的 Next.js 构建会在正文 DOM 中嵌入 <script>，
    // 其压缩后的 JS 含有裸露 `&` 字符，会让 Pandoc/XeLaTeX 以
    // `Misplaced alignment tab character &.` 报错并中止 PDF 生成。
    // 这里确保 script/style/noscript 的内容完全不进入 Markdown。
    const service = new MarkdownService({ logger });
    const html = [
      '<p>Before</p>',
      '<script>window._(HY||(e=>{let t=e=>e&1;}));</script>',
      '<style>.foo { color: red; }</style>',
      '<noscript>Please enable JS</noscript>',
      '<p>After</p>',
    ].join('');

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('Before');
    expect(markdown).toContain('After');
    expect(markdown).not.toContain('window._');
    expect(markdown).not.toContain('window.\\_');
    expect(markdown).not.toContain('color: red');
    expect(markdown).not.toContain('Please enable JS');
  });

  test('sanitizeMarkdown 应该移除 OpenAI 页面交互残留并保留示例 prompt', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      'Copy Page',
      '',
      '![](https://developers.openai.com/codex/colorcons/brain.png)Tell me about this projectCopied![](https://developers.openai.com/codex/colorcons/search.png)Find and fix bugs in my codebase with minimal, high-confidence changes.Copied',
      '',
      '[',
      '',
      'Previous',
      '',
      'Settings',
      '',
      '](/codex/app/settings)[',
      '',
      'Next',
      '',
      'Automations',
      '',
      '](/codex/app/automations)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/app/review',
    });

    expect(result).not.toContain('Copy Page');
    expect(result).toContain('- Tell me about this project');
    expect(result).toContain('- Find and fix bugs in my codebase with minimal, high-confidence changes.');
    expect(result).not.toContain('Previous');
    expect(result).not.toContain('Automations');
  });

  test('sanitizeMarkdown 应该对 Quickstart 的页签摘要做兜底格式化', () => {
    const service = new MarkdownService({ logger });
    const markdown =
      'AppRecommendedIDE extensionCodex in your IDECLICodex in your terminalCloudCodex in your browser';

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/quickstart',
    });

    expect(result).toContain('- App (Recommended)');
    expect(result).toContain('- IDE extension');
    expect(result).toContain('- CLI');
    expect(result).toContain('- Cloud');
  });

  test('sanitizeMarkdown 应该收敛 OpenAI 文档相邻的 light/dark 主题截图', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '![Assigning Codex to a Linear issue (light mode)](https://developers.openai.com/images/codex/integrations/linear-assign-codex-light.webp)![Assigning Codex to a Linear issue (dark mode)](https://developers.openai.com/images/codex/integrations/linear-assign-codex-dark.webp)',
      '',
      '![plugin-creator skill in Codex](https://developers.openai.com/images/codex/plugins/plugin-creator.png)',
      '',
      '![how to invoke the plugin-creator skill](https://developers.openai.com/images/codex/plugins/plugin-creator-invoke.png)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/integrations/linear',
    });

    expect(result).toContain(
      '![Assigning Codex to a Linear issue](https://developers.openai.com/images/codex/integrations/linear-assign-codex-light.webp)'
    );
    expect(result).not.toContain('linear-assign-codex-dark.webp');
    expect(result).toContain('plugin-creator.png');
    expect(result).toContain('plugin-creator-invoke.png');
  });

  test('代码块应保留语言标识', () => {
    const service = new MarkdownService({ logger });
    const html = '<pre><code class="language-js">const x = 1;</code></pre>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('```js');
    expect(markdown).toContain('const x = 1;');
  });

  test('addFrontmatter 应该在开头添加 YAML frontmatter', () => {
    const service = new MarkdownService({
      logger,
      config: {
        markdown: {
          includeFrontmatter: true,
        },
      },
    });

    const markdown = 'Content';
    const result = service.addFrontmatter(markdown, {
      title: 'Test',
      index: 1,
    });

    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('title: Test');
    expect(result).toContain('index: 1');
    expect(result).toContain('Content');
  });

  test('parseFrontmatter 应该解析 YAML frontmatter 并返回内容', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '---',
      'title: Test',
      'index: 2',
      'published: true',
      '---',
      '',
      '# Heading',
      'Body',
    ].join('\n');

    const { metadata, content } = service.parseFrontmatter(markdown);

    expect(metadata).toEqual({
      title: 'Test',
      index: 2,
      published: true,
    });
    expect(content).toContain('# Heading');
    expect(content).toContain('Body');
  });

  test('extractAndConvertPage 应该调用 page.evaluate 并返回 Markdown', async () => {
    const service = new MarkdownService({ logger });
    const page = {
      url: vi.fn().mockReturnValue('https://developers.openai.com/codex/intro'),
      evaluate: vi.fn(async () => ({
        html: '<h1>Title</h1><p><img src="/images/body.png" alt="Body"></p>',
        svgCount: 0,
      })),
    };

    const markdown = await service.extractAndConvertPage(page, 'main');

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(markdown).toContain('Title');
    expect(markdown).toContain('![Body](https://developers.openai.com/images/body.png)');
  });
});
