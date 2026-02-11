// tests/services/pandocPdfService.test.js
import { PandocPdfService } from '../../src/services/pandocPdfService.js';
import fs from 'fs';
import path from 'path';

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
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
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
  });

  describe('convertContentToPdf', () => {
    it('should create temp file and convert content', async () => {
      const content = '# Test\n\nThis is a test.';
      const outputPath = path.join(tempDir, 'output.pdf');

      // Mock _runPandoc
      service._runPandoc = jest.fn().mockResolvedValue();

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

      service._runPandoc = jest.fn().mockResolvedValue();

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

      service._runPandoc = jest.fn().mockRejectedValue(new Error('Pandoc error'));

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

      service._runPandoc = jest.fn().mockResolvedValue();

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

      service._runPandoc = jest.fn().mockRejectedValue(new Error('File error'));

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

    it('should handle mixed backtick lengths correctly', () => {
      const input =
        '````markdown theme={null}\n' + '```bash\n' + 'echo "hello"\n' + '```\n' + '````';
      const expected = '````markdown\n' + '```bash\n' + 'echo "hello"\n' + '```\n' + '````';
      const result = service._cleanMarkdownContent(input);
      expect(result).toBe(expected);
    });
  });

  describe('_runPandoc', () => {
    it('should reject if output file not created', async () => {
      const inputPath = path.join(tempDir, 'input.md');
      const outputPath = path.join(tempDir, 'output.pdf');

      fs.writeFileSync(inputPath, '# Test', 'utf8');

      // Mock spawn to simulate success but no file
      const originalSpawn = require('child_process').spawn;
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
        const mockChild = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 10); // Exit code 0
            }
          }),
        };
        return mockChild;
      });

      await expect(service._runPandoc(inputPath, outputPath, {})).rejects.toThrow('PDF 文件未生成');

      require('child_process').spawn.mockRestore();
    });
  });
});
