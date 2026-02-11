// tests/services/markdownService.test.js
import { MarkdownService } from '../../src/services/markdownService.js';

describe('MarkdownService', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('convertHtmlToMarkdown 应该将简单 HTML 转为 Markdown', () => {
    const service = new MarkdownService({ logger });
    const html = '<h1>Title</h1><p>Content</p>';

    const markdown = service.convertHtmlToMarkdown(html);

    expect(markdown).toContain('Title');
    expect(markdown).toContain('Content');
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
      evaluate: jest.fn(async () => ({
        html: '<h1>Title</h1><p>Body</p>',
        svgCount: 0,
      })),
    };

    const markdown = await service.extractAndConvertPage(page, 'main');

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(markdown).toContain('Title');
    expect(markdown).toContain('Body');
  });
});
