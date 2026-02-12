import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import { PDFStyleService } from '../../src/services/pdfStyleService.js';

// Mock logger module to prevent file system operations
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('PDFStyleService', () => {
  let pdfStyleService;
  let mockPage;
  let mockLogger;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com/page'),
    };

    pdfStyleService = new PDFStyleService({
      theme: 'light',
      fontSize: '16px',
    });

    // Get the mocked logger
    mockLogger = pdfStyleService.logger;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      const service = new PDFStyleService();

      expect(service.defaults).toMatchObject({
        theme: 'light',
        preserveCodeHighlighting: true,
        enableCodeWrap: true,
        maxCodeLineLength: 80,
        fontSize: '14px',
      });
    });

    it('should merge config with defaults', () => {
      expect(pdfStyleService.settings).toMatchObject({
        theme: 'light',
        fontSize: '16px',
        preserveCodeHighlighting: true,
        enableCodeWrap: true,
      });
    });
  });

  describe('detectThemeMode', () => {
    it('should detect dark theme from class names', async () => {
      mockPage.evaluate.mockResolvedValue({
        htmlClass: 'dark-mode other-class',
        bodyClass: 'content',
        dataTheme: null,
        bodyBgColor: 'rgb(255, 255, 255)',
        bodyColor: 'rgb(0, 0, 0)',
        themeToggle: false,
      });

      const theme = await pdfStyleService.detectThemeMode(mockPage);

      expect(theme).toBe('dark');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '检测到页面主题',
        expect.objectContaining({
          detected: 'dark',
        })
      );
    });

    it('should detect dark theme from data-theme attribute', async () => {
      mockPage.evaluate.mockResolvedValue({
        htmlClass: '',
        bodyClass: '',
        dataTheme: 'dark',
        bodyBgColor: 'rgb(255, 255, 255)',
        bodyColor: 'rgb(0, 0, 0)',
        themeToggle: false,
      });

      const theme = await pdfStyleService.detectThemeMode(mockPage);

      expect(theme).toBe('dark');
    });

    it('should detect dark theme from background color', async () => {
      mockPage.evaluate.mockResolvedValue({
        htmlClass: '',
        bodyClass: '',
        dataTheme: null,
        bodyBgColor: 'rgb(20, 20, 20)',
        bodyColor: 'rgb(255, 255, 255)',
        themeToggle: false,
      });

      const theme = await pdfStyleService.detectThemeMode(mockPage);

      expect(theme).toBe('dark');
    });

    it('should default to light theme when detection fails', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Evaluation failed'));

      const theme = await pdfStyleService.detectThemeMode(mockPage);

      expect(theme).toBe('light');
      expect(mockLogger.warn).toHaveBeenCalledWith('主题检测失败，使用默认主题', {
        error: 'Evaluation failed',
      });
    });

    it('should detect night theme', async () => {
      mockPage.evaluate.mockResolvedValue({
        htmlClass: 'theme-night',
        bodyClass: '',
        dataTheme: null,
        bodyBgColor: 'rgb(255, 255, 255)',
        bodyColor: 'rgb(0, 0, 0)',
        themeToggle: false,
      });

      const theme = await pdfStyleService.detectThemeMode(mockPage);

      expect(theme).toBe('dark');
    });
  });

  describe('getPDFOptimizedCSS', () => {
    it('should return CSS string with required rules', () => {
      const css = pdfStyleService.getPDFOptimizedCSS();

      expect(css).toContain('webkit-print-color-adjust: exact');
      expect(css).toContain('@page');
      expect(css).toContain('white-space: pre-wrap');
      expect(css).toContain('word-wrap: break-word');
      expect(css).toContain('[data-theme="dark"]');
      expect(css).toContain('.token');
      expect(css).toContain('page-break-inside: avoid');
      expect(css).toContain('details > summary');
      expect(css).toContain('@media print');
    });

    it('should include code block styling', () => {
      const css = pdfStyleService.getPDFOptimizedCSS();

      expect(css).toContain('pre[class*="language-"]');
      expect(css).toContain('pre[class*="hljs"]');
      expect(css).toContain('.highlight');
      expect(css).toContain('.code-block');
      expect(css).toContain('.CodeMirror');
    });

    it('should include syntax highlighting colors', () => {
      const css = pdfStyleService.getPDFOptimizedCSS();

      expect(css).toContain('.token.comment');
      expect(css).toContain('.token.keyword');
      expect(css).toContain('.token.function');
      expect(css).toContain('.token.string');
    });
  });

  describe('applyPDFStyles', () => {
    it('should apply PDF styles successfully', async () => {
      mockPage.evaluate.mockResolvedValue(undefined);

      const result = await pdfStyleService.applyPDFStyles(mockPage, '.content');

      expect(result).toEqual({ success: true });
      expect(mockLogger.info).toHaveBeenCalledWith('应用最简化PDF样式', {
        contentSelector: '.content',
      });
      expect(mockLogger.debug).toHaveBeenCalledWith('PDF样式应用完成');
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        '.content',
        expect.stringContaining('webkit-print-color-adjust'),
        []
      );
    });

    it('should handle missing content selector', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('内容选择器未找到: .missing'));

      await expect(pdfStyleService.applyPDFStyles(mockPage, '.missing')).rejects.toThrow(
        '内容选择器未找到: .missing'
      );

      expect(mockLogger.error).toHaveBeenCalledWith('PDF样式应用失败', {
        error: '内容选择器未找到: .missing',
        contentSelector: '.missing',
      });
    });

    it('should handle evaluation errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Page closed'));

      await expect(pdfStyleService.applyPDFStyles(mockPage, '.content')).rejects.toThrow(
        'Page closed'
      );
    });
  });

  describe('getPDFOptions', () => {
    it('should return PDF options with correct settings', () => {
      const options = pdfStyleService.getPDFOptions();

      expect(options).toMatchObject({
        format: 'A4',
        margin: {
          top: '1.5cm',
          right: '1.5cm',
          bottom: '1.5cm',
          left: '1.5cm',
        },
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: false,
        scale: 1,
        tagged: false,
      });
    });
  });

  describe('processSpecialContent', () => {
    it('should process special content successfully', async () => {
      const stats = {
        detailsExpanded: 5,
        ariaExpandedFixed: 3,
        hiddenContentRevealed: 2,
      };
      mockPage.evaluate.mockResolvedValue(stats);

      await pdfStyleService.processSpecialContent(mockPage);

      expect(mockLogger.info).toHaveBeenCalledWith('特殊内容处理完成', stats);
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle processing errors gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Processing failed'));

      await pdfStyleService.processSpecialContent(mockPage);

      expect(mockLogger.warn).toHaveBeenCalledWith('特殊内容处理失败', {
        error: 'Processing failed',
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle full workflow', async () => {
      // Mock successful operations
      mockPage.evaluate
        .mockResolvedValueOnce({
          // detectThemeMode
          htmlClass: 'dark',
          bodyClass: '',
          dataTheme: 'dark',
          bodyBgColor: 'rgb(0, 0, 0)',
          bodyColor: 'rgb(255, 255, 255)',
          themeToggle: true,
        })
        .mockResolvedValueOnce(undefined) // applyPDFStyles
        .mockResolvedValueOnce(undefined); // processSpecialContent

      // Detect theme
      const theme = await pdfStyleService.detectThemeMode(mockPage);
      expect(theme).toBe('dark');

      // Apply styles
      const result = await pdfStyleService.applyPDFStyles(mockPage, '.content');
      expect(result.success).toBe(true);

      // Process special content
      await pdfStyleService.processSpecialContent(mockPage);

      // Get PDF options
      const options = pdfStyleService.getPDFOptions();
      expect(options.format).toBe('A4');
    });

    it('should continue working after theme detection failure', async () => {
      // Mock theme detection failure
      mockPage.evaluate
        .mockRejectedValueOnce(new Error('Theme detection failed'))
        .mockResolvedValueOnce(undefined); // applyPDFStyles

      // Theme detection fails but returns default
      const theme = await pdfStyleService.detectThemeMode(mockPage);
      expect(theme).toBe('light');

      // Should still be able to apply styles
      const result = await pdfStyleService.applyPDFStyles(mockPage, '.content');
      expect(result.success).toBe(true);
    });
  });

  describe('CSS generation edge cases', () => {
    it('should handle custom settings', () => {
      const customService = new PDFStyleService({
        fontSize: '18px',
        fontFamily: 'Arial, sans-serif',
        codeFont: 'Courier New, monospace',
      });

      const css = customService.getPDFOptimizedCSS();

      // Should still contain all required rules regardless of custom settings
      expect(css).toContain('webkit-print-color-adjust');
      expect(css).toContain('white-space: pre-wrap');
      expect(css).toContain('.token');
    });
  });
});
