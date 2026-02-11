// src/services/pandocPdfService.js
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * PandocPdfService
 * 使用 Pandoc 将 Markdown 内容或文件转换为 PDF
 * 比 md-to-pdf 更可靠，特别是处理 CJK 字符时
 */
export class PandocPdfService {
  constructor(options = {}) {
    this.logger = options.logger;
    this.config = options.config || {};
    this.pandocBinary = options.pandocBinary || 'pandoc';
    this.metadataService = options.metadataService || null;
  }

  /**
   * 将 Markdown 文件转换为 PDF
   * @param {string} markdownPath
   * @param {string} outputPath
   * @param {Object} options
   */
  async convertToPdf(markdownPath, outputPath, options = {}) {
    try {
      this.logger?.info?.('开始使用 Pandoc 将 Markdown 文件转换为 PDF', {
        markdownPath,
        outputPath,
      });

      // 读取文件内容
      const content = fs.readFileSync(markdownPath, 'utf8');

      // 使用 convertContentToPdf 处理（它包含清理逻辑）
      await this.convertContentToPdf(content, outputPath, options);

      this.logger?.info?.('Pandoc Markdown 文件转换 PDF 完成', {
        outputPath,
      });
    } catch (error) {
      this.logger?.error?.('Pandoc Markdown 文件转换 PDF 失败', {
        markdownPath,
        outputPath,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 将 Markdown 文本内容转换为 PDF
   * @param {string} markdownContent
   * @param {string} outputPath
   * @param {Object} options
   */
  async convertContentToPdf(markdownContent, outputPath, options = {}) {
    try {
      this.logger?.info?.('开始使用 Pandoc 将 Markdown 内容转换为 PDF', {
        outputPath,
      });

      // 创建临时文件
      const tempDir = path.join(process.cwd(), '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFile = path.join(tempDir, `temp_${Date.now()}.md`);

      // 清理 Markdown 内容（修复代码块语法问题）
      const cleanedContent = this._cleanMarkdownContent(markdownContent);

      fs.writeFileSync(tempFile, cleanedContent, 'utf8');

      try {
        await this._runPandoc(tempFile, outputPath, options);
      } finally {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // 忽略清理错误
        }
      }

      this.logger?.info?.('Pandoc Markdown 内容转换 PDF 完成', {
        outputPath,
      });
    } catch (error) {
      this.logger?.error?.('Pandoc Markdown 内容转换 PDF 失败', {
        outputPath,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 运行 Pandoc 命令
   * @param {string} inputPath
   * @param {string} outputPath
   * @param {Object} options
   * @returns {Promise<void>}
   * @private
   */
  async _runPandoc(inputPath, outputPath, options = {}) {
    const args = this._buildPandocArgs(inputPath, outputPath, options);

    return new Promise((resolve, reject) => {
      const child = spawn(this.pandocBinary, args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const error = new Error(`Pandoc exited with code ${code}: ${stderr}`);
          this.logger?.error?.('Pandoc 转换失败', {
            code,
            stderr: stderr.substring(0, 500),
            stdout: stdout.substring(0, 500),
          });
          reject(error);
          return;
        }

        // 检查输出文件是否存在
        if (!fs.existsSync(outputPath)) {
          reject(new Error('PDF 文件未生成'));
          return;
        }

        resolve();
      });

      child.on('error', (err) => {
        this.logger?.error?.('Pandoc spawn 错误', {
          error: err.message,
        });
        reject(err);
      });
    });
  }

  /**
   * 清理 Markdown 内容，修复 Pandoc 不支持的语法
   * @param {string} content
   * @returns {string}
   * @private
   */
  _cleanMarkdownContent(content) {
    if (!content) return content;

    // 1. 修复代码块中的 theme={...} 属性
    // ```markdown theme={null} -> ```markdown
    // 支持任意数量的反引号 (>=3)
    let cleaned = content.replace(/^(`{3,})(\w+)\s+theme=\{[^}]+\}/gm, '$1$2');

    // 0. 处理 <Step> 组件
    // <Steps> / </Steps> -> remove
    cleaned = cleaned.replace(/<\/?Steps>/g, '');

    // <Step title="..."> -> ### ...
    cleaned = cleaned.replace(/<Step[^>]*title="([^"]+)"[^>]*>/g, '\n### $1\n');

    // </Step> -> remove
    cleaned = cleaned.replace(/<\/Step>/g, '\n');

    // 0.1 修复缩进
    // 移除 2-4 个空格的缩进 (修复 <Step> 内容被识别为代码块的问题)
    // 注意：这将影响所有缩进文本，但在这种上下文中通常是安全的
    cleaned = cleaned.replace(/^[ \t]{2,4}(?=[^ \t\n])/gm, '');
    // 移除以 | 开头的行前面的缩进 (修复表格被识别为代码块的问题)
    cleaned = cleaned.replace(/^\s+(\|.*\|)\s*$/gm, '$1');

    // 0.2 强制在表格前添加空行 (防止表格跟在文本后面被当成普通文本)
    // 查找: 非空行(不以|开头) + 换行 + 表格头(|...|) + 换行 + 分隔线(|---|)
    cleaned = cleaned.replace(
      /(^[^|\n\r].*(?:\r?\n|\r))(\s*\|.*\|.*(?:\r?\n|\r)\s*\|[-: ]+\|)/gm,
      '$1\n$2'
    );

    // 2. 修复代码块中一般的 React 属性 (key=value 或 key={value})
    // ```javascript filename="app.js" -> ```javascript
    cleaned = cleaned.replace(/^(`{3,})(\w+)\s+[\w-]+=(?:"[^"]*"|\{[^}]+\})/gm, '$1$2');

    // 2.1 清理代码块 info string 中多余的 token（例如文件路径）
    // ```markdown path/to/file.md theme={null} -> ```markdown
    // 保留 Pandoc 支持的属性块（{#id .class key=val}）
    cleaned = cleaned.replace(/^(`{3,})(\w+)([^\n]*)$/gm, (match, fence, lang, rest) => {
      const trimmed = rest.trim();
      if (!trimmed) return match;

      const attrMatch = trimmed.match(/(^|\s)(\{[^}]*\})/);
      if (attrMatch) {
        return `${fence}${lang} ${attrMatch[2]}`;
      }

      return `${fence}${lang}`;
    });

    // 3. 规范化表格分隔符行，防止某一列过宽导致其他列被压缩 (修复表格重叠问题)
    // 查找类似 | --- | :--- | ---: | 的行
    cleaned = cleaned.replace(/^\|?(\s*:?-+:?\s*\|)+$/gm, (match) => {
      // 如果不是表格分隔线（防止误判），直接返回
      if (!match.includes('-')) return match;

      return match.replace(/:?-+:?/g, (dashes) => {
        // 保留对齐冒号
        const hasLeftColon = dashes.startsWith(':');
        const hasRightColon = dashes.endsWith(':');

        let dashCount = dashes.length - (hasLeftColon ? 1 : 0) - (hasRightColon ? 1 : 0);

        // 限制 dash 数量在 10 到 50 之间
        // 既保证最小宽度，又防止某一列过度占用
        let newCount = Math.max(10, Math.min(dashCount, 50));

        return (hasLeftColon ? ':' : '') + '-'.repeat(newCount) + (hasRightColon ? ':' : '');
      });
    });

    return cleaned;
  }

  /**
   * 构建 Pandoc 命令行参数
   * @param {string} inputPath
   * @param {string} outputPath
   * @param {Object} options
   * @returns {string[]}
   * @private
   */
  _buildPandocArgs(inputPath, outputPath, options = {}) {
    const markdownPdfConfig = {
      ...(this.config.markdownPdf || {}),
      ...(options || {}),
    };

    const args = [
      inputPath,
      '-o',
      outputPath,
      '--pdf-engine=xelatex', // 使用 xelatex 支持中文
      '--variable',
      'CJKmainfont=Arial Unicode MS', // 主字体（支持中文）
      '--variable',
      'geometry:margin=1in', // 页边距
      '--variable',
      'header-includes=\\usepackage{fvextra} \\DefineVerbatimEnvironment{Highlighting}{Verbatim}{breaklines,breakanywhere,commandchars=\\\\\\{\\}} \\usepackage{xurl}', // 启用代码换行(支持任意位置) 和 URL 换行。不再使用 ltablex 防止表格溢出
    ];

    // 添加其他选项
    const pdfOptions = markdownPdfConfig.pdfOptions || {};

    // 如果指定了格式，添加纸张大小
    if (pdfOptions.format) {
      args.push('--variable', `papersize=${pdfOptions.format.toLowerCase()}`);
    }

    // 如果指定了边距
    if (pdfOptions.margin) {
      args.push('--variable', `geometry:margin=${pdfOptions.margin}`);
    }

    // 添加 TOC（目录）
    if (markdownPdfConfig.toc !== false) {
      args.push('--toc');
      const tocDepth = markdownPdfConfig.tocDepth || 3;
      args.push(`--toc-depth=${tocDepth}`);
    }

    // 语法高亮（Pandoc 3+ 使用 --highlight-style）
    // 支持的样式: pygments, tango, espresso, zenburn, kate, monochrome, breezedark, haddock
    const highlightStyle = markdownPdfConfig.highlightStyle;
    if (highlightStyle) {
      const style = highlightStyle === 'github' ? 'pygments' : highlightStyle;
      args.push('--highlight-style', style);
    }

    return args;
  }

  /**
   * Generate a single PDF from all markdown files in a directory (batch mode)
   * This bypasses individual PDF generation and creates the final PDF directly
   *
   * @param {string} markdownDir - Directory containing markdown files
   * @param {string} outputPath - Path for the output PDF
   * @param {Object} options - PDF generation options
   * @returns {Promise<{success: boolean, filesProcessed: number, outputPath: string}>}
   */
  async generateBatchPdf(markdownDir, outputPath, options = {}) {
    try {
      this.logger?.info?.('Starting batch PDF generation', {
        markdownDir,
        outputPath,
      });

      // 1. Get all markdown files sorted by index
      const files = this._getMarkdownFiles(markdownDir);
      if (files.length === 0) {
        throw new Error(`No markdown files found in ${markdownDir}`);
      }

      this.logger?.info?.(`Found ${files.length} markdown files for batch processing`);

      // 2. Load section structure and article titles for hierarchical TOC
      let sectionStructure = null;
      let articleTitles = {};

      if (this.metadataService) {
        try {
          sectionStructure = await this.metadataService.getSectionStructure();
          articleTitles = await this.metadataService.getArticleTitles();
          this.logger?.debug?.('Loaded metadata for batch PDF', {
            sections: sectionStructure?.sections?.length || 0,
            titles: Object.keys(articleTitles).length,
          });
        } catch (metaError) {
          this.logger?.warn?.('Could not load metadata, using flat structure', {
            error: metaError.message,
          });
        }
      }

      // 3. Concatenate markdown files with page breaks
      const combinedContent = this._concatenateMarkdownFiles(
        markdownDir,
        files,
        sectionStructure,
        articleTitles
      );

      this.logger?.info?.('Markdown files concatenated', {
        totalLength: combinedContent.length,
        filesProcessed: files.length,
      });

      // 4. Clean the combined content
      const cleanedContent = this._cleanMarkdownContent(combinedContent);

      // 5. Write to temp file and run Pandoc
      const tempDir = path.join(process.cwd(), '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFile = path.join(tempDir, `batch_${Date.now()}.md`);
      fs.writeFileSync(tempFile, cleanedContent, 'utf8');

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      try {
        await this._runPandoc(tempFile, outputPath, {
          ...options,
          toc: true,
          tocDepth: options.tocDepth || 3,
        });

        this.logger?.info?.('Batch PDF generation completed', {
          outputPath,
          filesProcessed: files.length,
        });

        return {
          success: true,
          filesProcessed: files.length,
          outputPath,
        };
      } finally {
        // Cleanup temp file
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      this.logger?.error?.('Batch PDF generation failed', {
        markdownDir,
        outputPath,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get markdown files from directory, sorted by numeric index
   * @param {string} dir - Directory path
   * @returns {string[]} - Sorted array of filenames
   * @private
   */
  _getMarkdownFiles(dir) {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') || f.endsWith('_translated.md'));

    // Prefer translated files if available, otherwise use original
    const fileMap = new Map();
    for (const file of files) {
      const baseName = file.replace('_translated.md', '.md');
      const isTranslated = file.endsWith('_translated.md');

      if (!fileMap.has(baseName) || isTranslated) {
        fileMap.set(baseName, file);
      }
    }

    // Sort by numeric prefix (e.g., 000-page.md, 001-page.md)
    return Array.from(fileMap.values()).sort((a, b) => {
      const aPrefix = a.split('-')[0];
      const bPrefix = b.split('-')[0];

      const aNum = parseInt(aPrefix, 10);
      const bNum = parseInt(bPrefix, 10);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }

      return a.localeCompare(b);
    });
  }

  /**
   * Concatenate markdown files with section headers and page breaks
   * @param {string} dir - Directory path
   * @param {string[]} files - Sorted array of filenames
   * @param {Object|null} sectionStructure - Section structure from metadata
   * @param {Object} articleTitles - Article titles mapping
   * @returns {string} - Combined markdown content
   * @private
   */
  _concatenateMarkdownFiles(dir, files, sectionStructure, articleTitles) {
    const sections = sectionStructure?.sections || [];
    // urlToSection is available for future use if needed

    // Build index to file mapping
    const indexToFile = new Map();
    for (const file of files) {
      const prefix = file.split('-')[0];
      if (/^\d+$/.test(prefix)) {
        indexToFile.set(String(parseInt(prefix, 10)), file);
      }
    }

    // If we have section structure, organize by sections
    if (sections.length > 0) {
      return this._concatenateWithSections(dir, files, sections, articleTitles, indexToFile);
    }

    // Fallback: flat concatenation
    return this._concatenateFlat(dir, files, articleTitles);
  }

  /**
   * Concatenate with section headers for hierarchical TOC
   * @private
   */
  _concatenateWithSections(dir, files, sections, articleTitles, indexToFile) {
    const parts = [];
    const processedIndices = new Set();

    for (const section of sections) {
      const sectionTitle = section.title || 'Untitled Section';
      const sectionPages = section.pages || [];

      if (sectionPages.length === 0) continue;

      // Add section header (H1 for TOC level 1)
      parts.push(`# ${sectionTitle}\n`);

      for (const pageInfo of sectionPages) {
        const pageIndex = pageInfo.index;
        if (!pageIndex || processedIndices.has(pageIndex)) continue;

        const file = indexToFile.get(pageIndex);
        if (!file) continue;

        const filePath = path.join(dir, file);
        if (!fs.existsSync(filePath)) continue;

        let content = fs.readFileSync(filePath, 'utf8');

        // Remove frontmatter if present
        content = this._removeFrontmatter(content);

        // Get article title
        const title =
          articleTitles[pageIndex] || this._extractTitleFromContent(content) || `Page ${pageIndex}`;

        // Strip leading title from content if it duplicates the injected title
        const cleanedContent = this._stripLeadingTitle(content, title);

        // Add article header (H2 for TOC level 2) and page break
        parts.push(`\\newpage\n\n## ${title}\n\n${cleanedContent}\n`);

        processedIndices.add(pageIndex);
      }
    }

    // Add any remaining files not in sections
    for (const file of files) {
      const prefix = file.split('-')[0];
      const index = /^\d+$/.test(prefix) ? String(parseInt(prefix, 10)) : null;

      if (index && processedIndices.has(index)) continue;

      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) continue;

      let content = fs.readFileSync(filePath, 'utf8');
      content = this._removeFrontmatter(content);

      const title =
        (index && articleTitles[index]) || this._extractTitleFromContent(content) || file;
      const cleanedContent = this._stripLeadingTitle(content, title);
      parts.push(`\\newpage\n\n## ${title}\n\n${cleanedContent}\n`);

      if (index) processedIndices.add(index);
    }

    return parts.join('\n');
  }

  /**
   * Flat concatenation without section structure
   * @private
   */
  _concatenateFlat(dir, files, articleTitles) {
    const parts = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) continue;

      let content = fs.readFileSync(filePath, 'utf8');
      content = this._removeFrontmatter(content);

      // Extract index from filename
      const prefix = file.split('-')[0];
      const index = /^\d+$/.test(prefix) ? String(parseInt(prefix, 10)) : null;

      const title =
        (index && articleTitles[index]) || this._extractTitleFromContent(content) || file;
      const cleanedContent = this._stripLeadingTitle(content, title);

      // Add with page break (first page doesn't need break)
      if (parts.length > 0) {
        parts.push(`\\newpage\n\n## ${title}\n\n${cleanedContent}\n`);
      } else {
        parts.push(`## ${title}\n\n${cleanedContent}\n`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Remove YAML frontmatter from markdown content
   * @private
   */
  _removeFrontmatter(content) {
    if (!content || !content.startsWith('---\n')) {
      return content;
    }

    const endIndex = content.indexOf('\n---\n', 4);
    if (endIndex === -1) {
      return content;
    }

    return content.slice(endIndex + 5).trim();
  }

  /**
   * Extract title from markdown content (first H1 or H2)
   * @private
   */
  _extractTitleFromContent(content) {
    const match = content.match(/^#{1,2}\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Strip the first heading from content if it matches the injected title
   * This prevents duplicate titles in the TOC
   * @param {string} content - Markdown content
   * @param {string} title - Title being injected
   * @returns {string} - Content with leading title removed if it was a duplicate
   * @private
   */
  _stripLeadingTitle(content, title) {
    if (!content || !title) return content;

    // Match first H1 or H2 at the start of content (after possible whitespace)
    const match = content.match(/^\s*(#{1,2})\s+(.+?)(\r?\n|$)/);
    if (!match) return content;

    const headingTitle = match[2].trim();
    // Compare normalized titles (case-insensitive, ignore extra whitespace)
    const normalizedInjected = title.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedExisting = headingTitle.toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalizedInjected === normalizedExisting) {
      // Remove the duplicate heading
      return content.slice(match[0].length).trim();
    }

    return content;
  }
}
