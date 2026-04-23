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

  test('convertHtmlToMarkdown 应该将 HTML table 转为可读的 Markdown 表格', () => {
    const service = new MarkdownService({ logger });
    const html = [
      '<table>',
      '<thead><tr><th></th><th>Action</th><th>macOS shortcut</th></tr></thead>',
      '<tbody>',
      '<tr><td><strong>Thread</strong></td><td></td><td></td></tr>',
      '<tr><td></td><td>Previous thread</td><td><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>[</kbd></td></tr>',
      '<tr><td></td><td>Next thread</td><td><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>]</kbd></td></tr>',
      '</tbody>',
      '</table>',
    ].join('');

    const markdown = service.convertHtmlToMarkdown(html, {
      pageUrl: 'https://developers.openai.com/codex/app/commands',
    });

    expect(markdown).toContain('|   | Action | macOS shortcut |');
    expect(markdown).toContain('| **Thread** |   |   |');
    expect(markdown).toContain('|   | Previous thread | `Cmd` + `Shift` + `[` |');
    expect(markdown).toContain('|   | Next thread | `Cmd` + `Shift` + `]` |');
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

  test('convertHtmlToMarkdown 应该将图片后直接粘连的正文拆成独立段落', () => {
    const service = new MarkdownService({ logger });
    const html =
      '<p><img src="/images/guide.png" alt="">In this guide, we share practical examples.</p>';

    const markdown = service.convertHtmlToMarkdown(html, {
      pageUrl: 'https://developers.openai.com/codex/guides/build-ai-native-engineering-team',
    });

    expect(markdown).toContain(
      '![](https://developers.openai.com/images/guide.png)\n\nIn this guide, we share practical examples.'
    );
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

  test('sanitizeMarkdown 应该修复带图片的 OpenAI 卡片整块链接并补全相对链接', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '[',
      '',
      '![](https://developers.openai.com/codex/use-cases/gh-pr-use-case.png)',
      '',
      '### Review pull requests faster',
      '',
      'Catch regressions and potential issues before human review.',
      '',
      'Integrations Workflow',
      '',
      '](/codex/use-cases/github-code-reviews)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/use-cases',
    });

    expect(result).toContain(
      '### [Review pull requests faster](https://developers.openai.com/codex/use-cases/github-code-reviews)'
    );
    expect(result).toContain('Catch regressions and potential issues before human review.');
    expect(result).toContain('Integrations Workflow');
  });

  test('sanitizeMarkdown 应该正确拆分粘连的 OpenAI 集合卡片', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '[',
      '',
      '![](https://developers.openai.com/codex/use-cases/background-codex-collection1.png) ![](https://developers.openai.com/codex/use-cases/production-systems-illustration.png)',
      '',
      '## Production systems',
      '',
      'Use Codex to navigate real codebases, make controlled changes, codify repeatable work, and keep production quality high.](/codex/use-cases/collections/production-systems) [![](https://developers.openai.com/codex/use-cases/background-codex-collection2.png) ![](https://developers.openai.com/codex/use-cases/analysis-collaboration-illustration.png)',
      '',
      '## Productivity and collaboration',
      '',
      'Work with Codex to analyze data and complex source material, combine multiple apps and services, and turn insights into action.](/codex/use-cases/collections/productivity-and-collaboration)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/use-cases',
    });

    expect(result).toContain(
      '## [Production systems](https://developers.openai.com/codex/use-cases/collections/production-systems)'
    );
    expect(result).toContain(
      '## [Productivity and collaboration](https://developers.openai.com/codex/use-cases/collections/productivity-and-collaboration)'
    );
    expect(result).not.toContain('](/codex/use-cases/collections/production-systems) [![]');
  });

  test('sanitizeMarkdown 应该精简 Codex Use Cases 首页里的筛选按钮和装饰性大图', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '# Codex Use Cases',
      '',
      '[Workflow](https://developers.openai.com/codex/use-cases?search=Workflow) [Integrations](https://developers.openai.com/codex/use-cases?search=Integrations) [Knowledge Work](https://developers.openai.com/codex/use-cases?search=Knowledge+Work)',
      '',
      '## Collections',
      '',
      '![](https://developers.openai.com/codex/use-cases/background-codex-collection1.png) ![](https://developers.openai.com/codex/use-cases/production-systems-illustration.png)',
      '',
      '## [Production systems](https://developers.openai.com/codex/use-cases/collections/production-systems)',
      '',
      'Use Codex to navigate real codebases, make controlled changes, codify repeatable work, and keep production quality high.',
      '',
      '## All use cases',
      '',
      '![](https://developers.openai.com/images/codex/codex-wallpaper-1.webp)',
      '',
      '### [Add iOS app intents](https://developers.openai.com/codex/use-cases/ios-app-intents)',
      '',
      'Use Codex to make your app’s actions and content available to Shortcuts, Siri, Spotlight...',
      '',
      'iOS Code',
      '',
      '## No use cases match these filters',
      '',
      'Try clearing a few filters or searching for a broader term.',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/use-cases',
    });

    expect(result).toContain('# Codex Use Cases');
    expect(result).toContain(
      '## [Production systems](https://developers.openai.com/codex/use-cases/collections/production-systems)'
    );
    expect(result).toContain(
      '### [Add iOS app intents](https://developers.openai.com/codex/use-cases/ios-app-intents)'
    );
    expect(result).not.toContain('?search=Workflow');
    expect(result).not.toContain('background-codex-collection1.png');
    expect(result).not.toContain('codex-wallpaper-1.webp');
    expect(result).not.toContain('No use cases match these filters');
  });

  test('sanitizeMarkdown 不应在非 OpenAI 页面误删正文里的 Copied', () => {
    const service = new MarkdownService({ logger });
    const markdown = ['# Heading', '', 'Copied', '', 'Regular content'].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://example.com/docs/page',
    });

    expect(result).toContain('Copied');
    expect(result).toContain('Regular content');
  });

  test('sanitizeMarkdown 应该清理 Codex CLI 首页步骤卡片里的重复数字和 command 标签', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '1.  1',
      '',
      '    ### Install',
      '',
      '    Install the Codex CLI with npm.',
      '',
      '    npm install command',
      '',
      '    npm i -g @openai/codex',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/cli',
    });

    expect(result).toContain('1.');
    expect(result).not.toContain('1.  1');
    expect(result).not.toContain('npm install command');
  });

  test('sanitizeMarkdown 应该只移除尾部 pager 而不误删快捷键方括号', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      'Action',
      '',
      'Previous thread',
      '',
      'Cmd + Shift + \\[',
      '',
      '[Previous Settings](/codex/app/settings)',
      '',
      '[Next Windows](/codex/app/windows)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/app/commands',
    });

    expect(result).toContain('Previous thread');
    expect(result).toContain('Cmd + Shift + \\[');
    expect(result).not.toContain('Previous Settings');
    expect(result).not.toContain('Next Windows');
  });

  test('sanitizeMarkdown 不应把尾部正常链接误判为 pager', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '# Agents.md',
      '',
      'Learn how to customize repository instructions.',
      '',
      '[Next steps](https://developers.openai.com/codex/guides/next-steps)',
    ].join('\n');

    const result = service.sanitizeMarkdown(markdown, {
      pageUrl: 'https://developers.openai.com/codex/guides/agents-md',
    });

    expect(result).toContain('[Next steps](https://developers.openai.com/codex/guides/next-steps)');
  });

  test('normalizeOpenAiModelsPage 应该把 Codex Models 卡片重建为紧凑可读的列表', () => {
    const service = new MarkdownService({ logger });
    const markdown = [
      '# Codex Models',
      '',
      '## Recommended models',
      '',
      '![gpt-5.4](https://developers.openai.com/images/api/models/gpt-5.4.jpg)',
      '',
      'gpt-5.4',
      '',
      'Flagship frontier model for professional work.',
      '',
      'codex -m gpt-5.4',
      '',
      'Capability',
      '',
      'Speed',
      '',
      'Codex CLI & SDK',
      '',
      'Codex Cloud',
      '',
      'For most tasks in Codex, start with `gpt-5.4`.',
      '',
      '## Alternative models',
      '',
      'gpt-5.2',
      '',
      'Previous general-purpose model.',
      '',
      'codex -m gpt-5.2',
      '',
      'Show details',
      '',
      '## Other models',
      '',
      'When you sign in with ChatGPT, Codex works best with the models listed above.',
    ].join('\n');

    const result = service._normalizeOpenAiModelsPage(
      markdown,
      [
        {
          heading: 'Recommended models',
          cards: [
            {
              name: 'gpt-5.4',
              description: 'Flagship frontier model for professional work.',
              command: 'codex -m gpt-5.4',
              features: [
                { title: 'Capability', iconCount: 5, value: '' },
                { title: 'Speed', iconCount: 3, value: '' },
                { title: 'Codex CLI & SDK', value: true, iconCount: 0 },
                { title: 'Codex Cloud', value: false, iconCount: 0 },
              ],
            },
          ],
          notes: ['For most tasks in Codex, start with gpt-5.4.'],
        },
        {
          heading: 'Alternative models',
          cards: [
            {
              name: 'gpt-5.2',
              description: 'Previous general-purpose model.',
              command: 'codex -m gpt-5.2',
              features: [
                { title: 'Capability', iconCount: 4, value: '' },
                { title: 'Speed', iconCount: 3, value: '' },
                { title: 'Codex CLI & SDK', value: true, iconCount: 0 },
              ],
            },
          ],
          notes: [],
        },
      ],
      'https://developers.openai.com/codex/models'
    );

    expect(result).toContain('### gpt-5.4');
    expect(result).toContain('```bash\ncodex -m gpt-5.4\n```');
    expect(result).toContain('- Capability: 5/5');
    expect(result).toContain('- Speed: 3/3');
    expect(result).toContain('- Codex CLI & SDK: Yes');
    expect(result).toContain('- Codex Cloud: No');
    expect(result).toContain('For most tasks in Codex, start with `gpt-5.4`.');
    expect(result).toContain('### gpt-5.2');
    expect(result).not.toContain('![gpt-5.4]');
    expect(result).not.toContain('Show details');
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

  test('_getOpenAiPagerLinkInfo 和 _shouldStripOpenAiPagerLinkGroup 应该区分真正 pager 与普通 Next 链接', () => {
    const service = new MarkdownService({ logger });
    const previousInfo = service._getOpenAiPagerLinkInfo('Previous Settings', ['Previous', 'Settings']);
    const nextInfo = service._getOpenAiPagerLinkInfo('Next Automations', ['Next', 'Automations']);
    const nextStepsInfo = service._getOpenAiPagerLinkInfo('Next steps', ['Next steps']);

    expect(previousInfo).toEqual({
      kind: 'previous',
      exact: true,
      hasTitle: true,
    });
    expect(nextInfo).toEqual({
      kind: 'next',
      exact: true,
      hasTitle: true,
    });
    expect(nextStepsInfo).toEqual({
      kind: 'next',
      exact: false,
      hasTitle: true,
    });

    expect(
      service._shouldStripOpenAiPagerLinkGroup([previousInfo, nextInfo], { requireExact: true })
    ).toBe(true);
    expect(
      service._shouldStripOpenAiPagerLinkGroup([nextStepsInfo], { requireExact: true })
    ).toBe(false);
    expect(service._shouldStripOpenAiPagerLinkGroup([nextStepsInfo])).toBe(false);
  });
});
