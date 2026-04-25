import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/services/pandocPdfService.test.js
import { PandocPdfService } from '../../src/services/pandocPdfService.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('PandocPdfService', () => {
  let service;
  let mockLogger;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), '.temp', 'test_pandoc');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    service = new PandocPdfService({
      logger: mockLogger,
      config: {
        markdownPdf: {
          highlightStyle: 'github',
          pdfOptions: {
            format: 'A4',
            margin: '20mm',
          },
        },
      },
    });
  });

  afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(service.pandocBinary).toBe('pandoc');
      expect(service.config).toBeDefined();
      expect(service.logger).toBe(mockLogger);
    });

    it('should accept custom pandoc binary path', () => {
      const customService = new PandocPdfService({
        pandocBinary: '/custom/path/pandoc',
      });
      expect(customService.pandocBinary).toBe('/custom/path/pandoc');
    });
  });

  describe('_buildPandocArgs', () => {
    it('should build basic args', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {});
      expect(args).toContain('input.md');
      expect(args).toContain('-o');
      expect(args).toContain('output.pdf');
      expect(args).toContain('--pdf-engine=xelatex');
    });

    it('should include format option', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        pdfOptions: { format: 'A4' },
      });
      expect(args).toContain('--variable');
      expect(args).toContain('papersize=a4');
    });

    it('should include margin option', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        pdfOptions: { margin: '1in' },
      });
      expect(args).toContain('--variable');
      expect(args).toContain('geometry:margin=1in');
    });

    it('should include TOC by default', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {});
      expect(args).toContain('--toc');
      expect(args).toContain('--toc-depth=3');
    });

    it('should exclude TOC when disabled', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        toc: false,
      });
      expect(args).not.toContain('--toc');
    });

    it('should include highlight style', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        highlightStyle: 'tango',
      });
      expect(args).toContain('--highlight-style');
      expect(args).toContain('tango');
    });

    it('should convert github style to pygments', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        highlightStyle: 'github',
      });
      expect(args).toContain('--highlight-style');
      expect(args).toContain('pygments');
      expect(args).not.toContain('github');
    });

    it('should default to a CI-safe open-source CJK font', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {});

      expect(args).toContain('CJKmainfont=Noto Sans CJK SC');
      expect(args).not.toContain('CJKmainfont=Arial Unicode MS');
    });

    it('should include a header file instead of raw header-includes latex', () => {
      const args = service._buildPandocArgs('input.md', 'output.pdf', {
        headerIncludePath: '/tmp/pandoc-header.tex',
      });

      expect(args).toContain('--include-in-header');
      expect(args).toContain('/tmp/pandoc-header.tex');
      expect(args.some((arg) => arg.includes('header-includes='))).toBe(false);
    });

    it('should build latex args without invoking pandoc pdf-engine orchestration', () => {
      const args = service._buildPandocLatexArgs('input.md', 'output.tex', {
        headerIncludePath: '/tmp/pandoc-header.tex',
      });

      expect(args).toContain('--standalone');
      expect(args).toContain('--to=latex');
      expect(args).not.toContain('--pdf-engine=xelatex');
    });

    it('should configure both Highlighting and plain verbatim blocks to wrap long lines', () => {
      const header = service._getPandocHeaderContent();

      expect(header).toContain(
        '\\RecustomVerbatimEnvironment{verbatim}{Verbatim}{breaklines,breakanywhere,fontsize=\\small}'
      );
      expect(header).toContain(
        '\\DefineVerbatimEnvironment{Highlighting}{Verbatim}{breaklines,breakanywhere,fontsize=\\small,commandchars=\\\\\\{\\}}'
      );
    });

    it('should allow overriding the CJK main font from config', () => {
      const customService = new PandocPdfService({
        logger: mockLogger,
        config: {
          markdownPdf: {
            cjkMainFont: 'Source Han Sans SC',
          },
        },
      });

      const args = customService._buildPandocArgs('input.md', 'output.pdf', {});

      expect(args).toContain('CJKmainfont=Source Han Sans SC');
    });
  });

  describe('convertContentToPdf', () => {
    it('should create temp file and convert content', async () => {
      const content = '# Test\n\nThis is a test.';
      const outputPath = path.join(tempDir, 'output.pdf');

      // Mock _runPandoc
      service._runPandoc = vi.fn().mockResolvedValue();

      await service.convertContentToPdf(content, outputPath);

      expect(service._runPandoc).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('开始使用 Pandoc'),
        expect.any(Object)
      );
    });

    it('should cleanup temp file after conversion', async () => {
      const content = '# Test';
      const outputPath = path.join(tempDir, 'output.pdf');

      service._runPandoc = vi.fn().mockResolvedValue();

      await service.convertContentToPdf(content, outputPath);

      // 检查临时文件是否被清理
      const tempFiles = fs
        .readdirSync(path.join(process.cwd(), '.temp'))
        .filter((f) => f.startsWith('temp_') && f.endsWith('.md'));

      expect(tempFiles.length).toBe(0);
    });

    it('should handle conversion errors', async () => {
      const content = '# Test';
      const outputPath = path.join(tempDir, 'output.pdf');

      service._runPandoc = vi.fn().mockRejectedValue(new Error('Pandoc error'));

      await expect(service.convertContentToPdf(content, outputPath)).rejects.toThrow(
        'Pandoc error'
      );

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('convertToPdf', () => {
    it('should convert markdown file to pdf', async () => {
      const inputPath = path.join(tempDir, 'input.md');
      const outputPath = path.join(tempDir, 'output.pdf');

      fs.writeFileSync(inputPath, '# Test\n\nContent', 'utf8');

      service._runPandoc = vi.fn().mockResolvedValue();

      await service.convertToPdf(inputPath, outputPath);

      expect(service._runPandoc).toHaveBeenCalledWith(
        expect.stringContaining('.temp/temp_'),
        outputPath,
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle file conversion errors', async () => {
      const inputPath = path.join(tempDir, 'input.md');
      const outputPath = path.join(tempDir, 'output.pdf');

      fs.writeFileSync(inputPath, '# Test', 'utf8');

      service._runPandoc = vi.fn().mockRejectedValue(new Error('File error'));

      await expect(service.convertToPdf(inputPath, outputPath)).rejects.toThrow('File error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('_cleanMarkdownContent', () => {
    it('should remove theme={null} from standard code blocks', () => {
      const input = '```markdown theme={null}\ncontent\n```';
      const expected = '```markdown\ncontent\n```';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe(expected);
    });

    it('should remove theme={null} from code blocks with 4 backticks', () => {
      const input = '````markdown theme={null}\ncontent\n````';
      const expected = '````markdown\ncontent\n````';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe(expected);
    });

    it('should remove generic props from code blocks with 4 backticks', () => {
      const input = '````javascript filename="test.js"\ncontent\n````';
      const expected = '````javascript\ncontent\n````';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe(expected);
    });

    it('should convert Info component with list items to fully-quoted blockquote', () => {
      const input = '<Info>\n- Step 1\n- Step 2\n</Info>';
      const result = service._cleanMarkdownContent(input);
      expect(result).toContain('> **Note:** - Step 1');
      expect(result).toContain('> - Step 2');
      // No unquoted list items
      expect(result).not.toMatch(/^- Step/m);
    });

    it('should convert Tip component with multiline content to blockquote', () => {
      const input = '<Tip>\nDo this first.\n- Option A\n- Option B\n</Tip>';
      const result = service._cleanMarkdownContent(input);
      expect(result).toContain('> **Tip:** Do this first.');
      expect(result).toContain('> - Option A');
      expect(result).toContain('> - Option B');
    });

    it('should convert Warning component to blockquote', () => {
      const input = '<Warning>\nDanger ahead!\n</Warning>';
      const result = service._cleanMarkdownContent(input);
      expect(result).toContain('> **Warning:** Danger ahead!');
    });

    it('should remove empty list items inside blockquotes', () => {
      const input = '> -\n> text after';
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toMatch(/^>\s*-\s*$/m);
    });

    it('should insert blank line between blockquote prose and list', () => {
      const input = '> Some text\n> - item 1';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe('> Some text\n>\n> - item 1');
    });

    it('should preserve reference tables with PDF-friendly column widths', () => {
      const input = [
        'Before.',
        '',
        '| Key | Type / Values | Details |',
        '| --- | --- | --- |',
        '| `approval_policy.granular.request_permissions` | `boolean` | When `true`, prompts from the `request_permissions` tool are allowed to surface. |',
        '| `approval_policy` | `untrusted \\| on-request \\| never` | Controls when Codex pauses for approval. |',
        '',
        'After.',
      ].join('\n');

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain('| Key | Type / Values | Details |');
      expect(result).toContain(
        '|:------------------------------------|:----------------------------|:----------------------------------------------------|'
      );
      expect(result).toContain(
        '\\texttt{approval\\_\\allowbreak{}policy.\\allowbreak{}granular.\\allowbreak{}request\\_\\allowbreak{}permissions}'
      );
      expect(result).toContain('`boolean`');
      expect(result).toContain(
        '\\texttt{untrusted |\\allowbreak{} on-\\allowbreak{}request |\\allowbreak{} never}'
      );
      expect(result).toContain('After.');
    });

    it('should preserve metric catalog tables with PDF-friendly column widths', () => {
      const input = [
        '| Metric | Type | Fields | Description |',
        '| --- | --- | --- | --- |',
        '| `websocket.request.duration_ms` | histogram | `success` | WebSocket request duration in milliseconds. |',
        '| `responses_api_engine_service_tbt.duration_ms` | histogram |   | Responses API engine service time-between-token timing. |',
      ].join('\n');

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain('| Metric | Type | Fields | Description |');
      expect(result).toContain(
        '|:------------------------------------------|:--------------|:------------------------------|:------------------------------------------------|'
      );
      expect(result).toContain(
        '\\texttt{websocket.\\allowbreak{}request.\\allowbreak{}duration\\_\\allowbreak{}ms}'
      );
      expect(result).toContain(
        '\\texttt{responses\\_\\allowbreak{}api\\_\\allowbreak{}engine\\_\\allowbreak{}service\\_\\allowbreak{}tbt.\\allowbreak{}duration\\_\\allowbreak{}ms}'
      );
    });

    it('should remove duplicate reference card blocks after a reference table', () => {
      const input = [
        '| Key | Type / Values | Details |',
        '| --- | --- | --- |',
        '| `approval_policy.granular.request_permissions` | `boolean` | Table details. |',
        '',
        'Key',
        '',
        '`approval_policy.granular.request_permissions`',
        '',
        'Type / Values',
        '',
        '`boolean`',
        '',
        'Details',
        '',
        'Duplicate card details.',
        '',
        'After.',
      ].join('\n');

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain('| Key | Type / Values | Details |');
      expect(result).toContain('Table details.');
      expect(result).not.toContain('Duplicate card details.');
      expect(result).toContain('After.');
    });

    it('should normalize card-only reference blocks when no table was present', () => {
      const input = [
        'Key',
        '',
        '`standalone.key`',
        '',
        'Type / Values',
        '',
        '`string`',
        '',
        'Details',
        '',
        'Only card details.',
      ].join('\n');

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain('**Key:** `standalone.key`');
      expect(result).toContain('**Type / Values:** string');
      expect(result).toContain('**Details:** Only card details.');
    });

    it('should convert long inline paths to breakable LaTeX paths', () => {
      const input =
        'Use `$REPO_ROOT/.agents/plugins/marketplace.json` for a repo-scoped list and keep `plugins[]` unchanged.';

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain(
        '\\texttt{\\$REPO\\_\\allowbreak{}ROOT/\\allowbreak{}.\\allowbreak{}agents/\\allowbreak{}plugins/\\allowbreak{}marketplace.\\allowbreak{}json}'
      );
      expect(result).toContain('`plugins[]`');
    });

    it('should not pair closing inline-code ticks with later inline-code openings', () => {
      const input =
        'Use `$REPO_ROOT/.agents/plugins/marketplace.json`, then add a `./`\\-prefixed path relative to the marketplace root and set `interface.displayName`.';

      const result = service._cleanMarkdownContent(input);

      expect(result).toContain(
        '\\texttt{\\$REPO\\_\\allowbreak{}ROOT/\\allowbreak{}.\\allowbreak{}agents/\\allowbreak{}plugins/\\allowbreak{}marketplace.\\allowbreak{}json}'
      );
      expect(result).toContain('`./`\\-prefixed path relative to the marketplace root');
      expect(result).toContain('`interface.displayName`');
      expect(result).not.toContain('\\texttt{\\-\\allowbreak{}prefixed');
    });

    it('should strip multi-line MDX export const declarations', () => {
      const input = [
        '# Quickstart',
        '',
        'export const InstallConfigurator = () => {',
        "  const TERM = { mac: 'curl -fsSL https://claude.ai/install.sh | bash' };",
        '  return <div>stuff</div>;',
        '};',
        '',
        '## Step 1',
        'Real content.',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('export const InstallConfigurator');
      expect(result).not.toContain('const TERM');
      expect(result).toContain('# Quickstart');
      expect(result).toContain('## Step 1');
      expect(result).toContain('Real content.');
    });

    it('should strip MDX export that uses template literals with backticks', () => {
      // Reproduces the quickstart.md Experiment helper shape that triggered
      // the CI LaTeX error: backtick template literals confused pandoc into
      // opening math mode inside escaped prose.
      const input = [
        'prefix text',
        '',
        'export const Experiment = ({flag, treatment, children}) => {',
        '  const ajsMatch = document.cookie.match(/(?:^|; )ajs=([^;]+)/);',
        '  const vid = decodeURIComponent(ajsMatch[1]).replace(/^"|"$/g, "");',
        '  document.cookie = `ajs=${vid}; domain=.claude.com`;',
        '  return treatment;',
        '};',
        '',
        'suffix text',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('export const Experiment');
      expect(result).not.toContain('document.cookie');
      expect(result).toContain('prefix text');
      expect(result).toContain('suffix text');
    });

    it('should strip JSX tag whose attribute value is a nested JSX element', () => {
      // Regression: `<Experiment treatment={<InstallConfigurator />} />`
      // A naive `<[A-Z]...[^>]*>` stops at the inner `/>` and leaves
      // `} />` behind as prose. The brace-aware scanner must drop the
      // whole outer tag.
      const input = [
        'before',
        '',
        '<Experiment flag="quickstart-install-configurator" treatment={<InstallConfigurator />} />',
        '',
        'after',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('Experiment');
      expect(result).not.toContain('InstallConfigurator');
      expect(result).not.toContain('} />');
      expect(result).not.toContain('/>');
      expect(result).toContain('before');
      expect(result).toContain('after');
    });

    it('should strip JSX tag with multiple nested JSX attribute values', () => {
      const input =
        '<Card icon={<Icon name="book" />} action={<Button label="Go" />}>Content</Card>';
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('<Card');
      expect(result).not.toContain('</Card');
      expect(result).not.toContain('<Icon');
      expect(result).not.toContain('<Button');
      expect(result).toContain('Content');
    });

    it('should strip MDX export containing embedded CSS template literal', () => {
      // Regression: CSS inside a JS template literal has bare `}` at column 0
      // (end of each CSS rule). Earlier regex stopped at the first such `}`
      // and left the rest of the CSS leaking into the PDF. The real closer is
      // always `};` with a semicolon.
      const input = [
        '# Quickstart',
        '',
        'export const InstallConfigurator = () => {',
        '  const STYLES = `',
        '.cc-ic {',
        '  --ic-slate: #141413;',
        '  font-size: 14px;',
        '}',
        '.dark .cc-ic {',
        '  --ic-slate: #f0eee6;',
        '}',
        '.cc-ic-tab-strip {',
        '  display: inline-flex;',
        '}',
        '`;',
        '  return <div className="cc-ic">hi</div>;',
        '};',
        '',
        '## Step 1',
        'Body.',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('cc-ic');
      expect(result).not.toContain('--ic-slate');
      expect(result).not.toContain('inline-flex');
      expect(result).not.toContain('export const InstallConfigurator');
      expect(result).toContain('# Quickstart');
      expect(result).toContain('## Step 1');
      expect(result).toContain('Body.');
    });

    it('should strip multiple consecutive MDX export blocks', () => {
      const input = [
        'export const A = () => {',
        '  return 1;',
        '};',
        '',
        'export const B = () => {',
        '  return 2;',
        '};',
        '',
        '# Real title',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toContain('export const A');
      expect(result).not.toContain('export const B');
      expect(result).toContain('# Real title');
    });

    it('should preserve webp markdown images for the conversion stage', () => {
      const input = '![App screenshot](https://developers.openai.com/images/app.webp)';
      const result = service._cleanMarkdownContent(input);

      expect(result).toBe('![App screenshot](https://developers.openai.com/images/app.webp)');
    });

    it('should keep images when fm=webp is rewritten to a safe output format', () => {
      const input =
        '![Chart](https://cdn.example.com/chart.webp?fm=webp&fit=max)';
      const result = service._cleanMarkdownContent(input);

      expect(result).toBe('![Chart](https://cdn.example.com/chart.webp?fm=png&fit=max)');
    });

    it('should preserve raw html img tags that point to webp assets for conversion', () => {
      const input =
        '<img src="https://developers.openai.com/images/app.webp" alt="App screenshot">';
      const result = service._cleanMarkdownContent(input);

      expect(result).toBe('<img src="https://developers.openai.com/images/app.webp" alt="App screenshot">');
    });

    it('should constrain standalone icon images to their website display size', () => {
      const input = '![](https://developers.openai.com/images/codex/codex-banner-icon.webp)';
      const result = service._cleanMarkdownContent(input);

      expect(result).toBe(
        '![](https://developers.openai.com/images/codex/codex-banner-icon.webp){width=40px}'
      );
    });

    it('should keep standalone icon card titles inline with their icon', () => {
      const input = [
        '![](https://developers.openai.com/images/codex/codex-banner-icon.webp)',
        '',
        '### [Use the Codex app on Windows](https://developers.openai.com/codex/app/windows)',
        '',
        'Work across projects in the native Windows app.',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);

      expect(result).toBe(
        [
          '![](https://developers.openai.com/images/codex/codex-banner-icon.webp){width=40px} **[Use the Codex app on Windows](https://developers.openai.com/codex/app/windows)**',
          '',
          'Work across projects in the native Windows app.',
        ].join('\n')
      );
    });

    it('should preserve export/import lines inside fenced code blocks', () => {
      // Python example containing `import`, and shell `export VAR=...` must
      // survive because they are inside fenced code blocks.
      const input = [
        '# Example',
        '',
        '```python',
        'import json',
        'import sys',
        'print(json.dumps({"ok": True}))',
        '```',
        '',
        '```bash',
        'export MAX_TOKENS=50000',
        'claude',
        '```',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).toContain('import json');
      expect(result).toContain('import sys');
      expect(result).toContain('export MAX_TOKENS=50000');
    });

    it('should strip top-level MDX import statements', () => {
      const input = [
        "import Foo from '@site/components/Foo';",
        'import Bar from "./Bar";',
        '',
        '# Page title',
        'body',
      ].join('\n');
      const result = service._cleanMarkdownContent(input);
      expect(result).not.toMatch(/^import\s/m);
      expect(result).toContain('# Page title');
      expect(result).toContain('body');
    });

    it('should handle mixed backtick lengths correctly', () => {
      const input =
        '````markdown theme={null}\n' + '```bash\n' + 'echo "hello"\n' + '```\n' + '````';
      const expected = '````markdown\n' + '```bash\n' + 'echo "hello"\n' + '```\n' + '````';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe(expected);
    });

    it('should preserve nested code fences when outer uses more backticks (regex fallback)', () => {
      // Regression: the regex fence splitter must match closing delimiter to
      // the opener's character AND length. A 3-backtick line inside a
      // 4-backtick block must NOT end the protected region.
      const input = [
        '````markdown',
        'export const SHOULD_SURVIVE = true;',
        '```bash',
        'export VAR=1',
        '```',
        '````',
        '',
        "import Leak from './leak';",
      ].join('\n');
      const result = service._stripMdxModuleDeclarations(input);
      // The export inside the 4-backtick block must survive
      expect(result).toContain('export const SHOULD_SURVIVE = true;');
      expect(result).toContain('export VAR=1');
      // The import outside the fence must be stripped
      expect(result).not.toMatch(/^import Leak/m);
    });
  });

  describe('_preparePdfImages', () => {
    it('should rewrite unsafe markdown images to local png files when conversion succeeds', async () => {
      vi.spyOn(service, '_materializePdfSafeImage').mockResolvedValue('/tmp/converted/app.png');

      const result = await service._preparePdfImages(
        '![App screenshot](https://developers.openai.com/images/app.webp)',
        tempDir
      );

      expect(result.content).toBe('![App screenshot](/tmp/converted/app.png)');
      expect(result.cleanupPaths).toHaveLength(1);
    });

    it('should preserve markdown image titles while extracting only the image url', async () => {
      const materializeSpy = vi
        .spyOn(service, '_materializePdfSafeImage')
        .mockResolvedValue('/tmp/converted/app.png');

      const result = await service._preparePdfImages(
        '![App screenshot](https://developers.openai.com/images/app.webp "caption")',
        tempDir
      );

      expect(materializeSpy).toHaveBeenCalledWith(
        'https://developers.openai.com/images/app.webp',
        expect.stringContaining('media-')
      );
      expect(result.content).toBe('![App screenshot](/tmp/converted/app.png "caption")');
    });

    it('should preserve markdown image attributes when rewriting remote images', async () => {
      vi.spyOn(service, '_materializePdfSafeImage').mockResolvedValue('/tmp/converted/icon.png');

      const result = await service._preparePdfImages(
        '![](https://developers.openai.com/images/codex/codex-banner-icon.webp){width=40px}',
        tempDir
      );

      expect(result.content).toBe('![](/tmp/converted/icon.png){width=40px}');
    });

    it('should downgrade unsafe markdown images to plain links when conversion fails', async () => {
      vi.spyOn(service, '_materializePdfSafeImage').mockRejectedValue(new Error('boom'));

      const result = await service._preparePdfImages(
        '![App screenshot](https://developers.openai.com/images/app.webp)',
        tempDir
      );

      expect(result.content).toBe('[App screenshot](https://developers.openai.com/images/app.webp)');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should rewrite unsafe raw html img tags to local markdown images', async () => {
      vi.spyOn(service, '_materializePdfSafeImage').mockResolvedValue('/tmp/converted/review.png');

      const result = await service._preparePdfImages(
        '<img src="https://developers.openai.com/images/app.webp" alt="Review pane">',
        tempDir
      );

      expect(result.content).toBe('![Review pane](/tmp/converted/review.png)');
    });

    it('should not rewrite markdown or html image examples inside fenced code blocks', async () => {
      const materializeSpy = vi
        .spyOn(service, '_materializePdfSafeImage')
        .mockResolvedValue('/tmp/converted/review.png');

      const input = [
        '```md',
        '![Example](https://developers.openai.com/images/example.webp "caption")',
        '<img src="https://developers.openai.com/images/example-html.webp" alt="HTML example">',
        '```',
        '',
        '<img src="https://developers.openai.com/images/review.webp" alt="Review pane">',
      ].join('\n');

      const result = await service._preparePdfImages(input, tempDir);

      expect(materializeSpy).toHaveBeenCalledTimes(1);
      expect(materializeSpy).toHaveBeenCalledWith(
        'https://developers.openai.com/images/review.webp',
        expect.stringContaining('media-')
      );
      expect(result.content).toBe([
        '```md',
        '![Example](https://developers.openai.com/images/example.webp "caption")',
        '<img src="https://developers.openai.com/images/example-html.webp" alt="HTML example">',
        '```',
        '',
        '![Review pane](/tmp/converted/review.png)',
      ].join('\n'));
    });
  });

  describe('_extractPdfUnsafeImageUrls', () => {
    it('should extract only the image url when markdown image has an optional title', () => {
      expect(
        service._extractPdfUnsafeImageUrls(
          '![App screenshot](https://developers.openai.com/images/app.webp "caption")'
        )
      ).toEqual(['https://developers.openai.com/images/app.webp']);
    });

    it('should ignore fenced code block image examples', () => {
      const input = [
        '```md',
        '![Example](https://developers.openai.com/images/example.webp)',
        '<img src="https://developers.openai.com/images/example-html.webp" alt="HTML example">',
        '```',
        '',
        '![Real](https://developers.openai.com/images/real.webp)',
      ].join('\n');

      expect(service._extractPdfUnsafeImageUrls(input)).toEqual([
        'https://developers.openai.com/images/real.webp',
      ]);
    });
  });

  describe('_detectDownloadedImageFormat', () => {
    it('should detect webp from bytes even when headers are missing', () => {
      const webpBuffer = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii'),
      ]);

      expect(service._detectDownloadedImageFormat(webpBuffer, '')).toBe('webp');
    });

    it('should still convert when the detected format is unsafe even if the url looks safe', () => {
      expect(
        service._shouldConvertDownloadedImage(
          'https://cdn.example.com/chart?fm=png',
          '',
          'webp'
        )
      ).toBe(true);
    });
  });

  describe('_runPandoc', () => {
    it('should create and cleanup a pandoc header include file for each run', async () => {
      const inputPath = path.join(tempDir, 'input.md');
      const outputPath = path.join(tempDir, 'output.pdf');
      let headerPath = '';
      let invocation = 0;

      fs.writeFileSync(inputPath, '# Test', 'utf8');

      const spawnSpy = vi.mocked(spawn).mockImplementation((_command, args) => {
        invocation += 1;
        const currentInvocation = invocation;
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') {
              setTimeout(() => {
                if (currentInvocation === 1) {
                  const includeIndex = args.indexOf('--include-in-header');
                  headerPath = includeIndex >= 0 ? args[includeIndex + 1] : '';
                  expect(headerPath).toBeTruthy();
                  expect(fs.existsSync(headerPath)).toBe(true);

                  const outputIndex = args.indexOf('-o');
                  fs.writeFileSync(args[outputIndex + 1], '\\documentclass{article}', 'utf8');
                } else {
                  const outputDirArg = args.find((arg) => arg.startsWith('-output-directory='));
                  const outputDir = outputDirArg?.slice('-output-directory='.length) || tempDir;
                  fs.writeFileSync(path.join(outputDir, 'input.pdf'), '%PDF-1.4', 'utf8');
                }

                callback(0);
              }, 10);
            }
          }),
        };
      });

      await service._runPandoc(inputPath, outputPath, {});

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.existsSync(headerPath)).toBe(false);
      expect(spawnSpy).toHaveBeenCalledTimes(3);

      spawnSpy.mockReset();
    });

    it('should reject if output file not created', async () => {
      const inputPath = path.join(tempDir, 'input.md');
      const outputPath = path.join(tempDir, 'output.pdf');
      let invocation = 0;

      fs.writeFileSync(inputPath, '# Test', 'utf8');

      // Mock spawn to simulate success but no file
      const spawnSpy = vi.mocked(spawn).mockImplementation((_command, args) => {
        invocation += 1;
        const currentInvocation = invocation;

        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') {
              setTimeout(() => {
                if (currentInvocation === 1) {
                  const outputIndex = args.indexOf('-o');
                  fs.writeFileSync(args[outputIndex + 1], '\\documentclass{article}', 'utf8');
                }
                callback(0);
              }, 10); // Exit code 0
            }
          }),
        };
      });

      await expect(service._runPandoc(inputPath, outputPath, {})).rejects.toThrow('PDF 文件未生成');

      spawnSpy.mockReset();
    });
  });
});
