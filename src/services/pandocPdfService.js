// src/services/pandocPdfService.js
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';

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
    this.latexBinary = options.latexBinary || 'xelatex';
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
      const preparedContent = await this._preparePdfImages(cleanedContent, tempDir);

      fs.writeFileSync(tempFile, preparedContent.content, 'utf8');

      try {
        await this._runPandoc(tempFile, outputPath, options);
      } finally {
        // 清理临时文件
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // 忽略清理错误
        }

        if (preparedContent.cleanupPaths.length > 0) {
          preparedContent.cleanupPaths.forEach((cleanupPath) => {
            try {
              fs.rmSync(cleanupPath, { recursive: true, force: true });
            } catch {
              // 忽略清理错误
            }
          });
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
    const tempDir = path.dirname(inputPath) || process.cwd();
    const headerIncludePath = this._createPandocHeaderFile(tempDir);
    const latexWorkDir = fs.mkdtempSync(path.join(tempDir, 'pandoc-latex-'));
    const latexInputPath = path.join(latexWorkDir, 'input.tex');
    const latexOutputPath = path.join(latexWorkDir, 'input.pdf');
    const args = this._buildPandocLatexArgs(inputPath, latexInputPath, {
      ...options,
      headerIncludePath,
    });

    return (async () => {
      await this._runExternalCommand(this.pandocBinary, args, {
        failureLabel: 'Pandoc 转换失败',
        timeoutMs: 120000,
      });

      await this._runXeLatex(latexInputPath, latexWorkDir);
      await this._runXeLatex(latexInputPath, latexWorkDir);

      if (!fs.existsSync(latexOutputPath)) {
        throw new Error('PDF 文件未生成');
      }

      fs.copyFileSync(latexOutputPath, outputPath);
    })().finally(() => {
      try {
        fs.unlinkSync(headerIncludePath);
      } catch {
        // Ignore cleanup errors
      }

      try {
        fs.rmSync(latexWorkDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  }

  /**
   * 运行一个外部命令并在失败时附带 stderr，便于定位 Pandoc / XeLaTeX 问题。
   *
   * @param {string} command
   * @param {string[]} args
   * @param {{ failureLabel: string, timeoutMs?: number }} options
   * @returns {Promise<{stdout: string, stderr: string}>}
   * @private
   */
  async _runExternalCommand(command, args, options = {}) {
    const { failureLabel = '外部命令执行失败', timeoutMs = 300000 } = options;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;

        child.kill('SIGTERM');
        settled = true;
        reject(new Error(`${failureLabel}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      timeoutId.unref?.();

      const finish = (handler) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        handler();
      };

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        finish(() => {
          if (code !== 0) {
            this.logger?.error?.(failureLabel, {
              code,
              stderr: stderr.substring(0, 500),
              stdout: stdout.substring(0, 500),
            });
            reject(new Error(`${failureLabel}: ${stderr || stdout || `exit code ${code}`}`));
            return;
          }

          resolve({ stdout, stderr });
        });
      });

      child.on('error', (error) => {
        finish(() => {
          this.logger?.error?.(`${failureLabel} spawn 错误`, {
            error: error.message,
          });
          reject(error);
        });
      });
    });
  }

  /**
   * 显式运行 XeLaTeX，确保 TOC / 引用在多轮编译中稳定收敛。
   *
   * @param {string} inputPath
   * @param {string} outputDir
   * @returns {Promise<void>}
   * @private
   */
  async _runXeLatex(inputPath, outputDir) {
    await this._runExternalCommand(
      this.latexBinary,
      [
        '-halt-on-error',
        '-interaction=nonstopmode',
        `-output-directory=${outputDir}`,
        inputPath,
      ],
      {
        failureLabel: 'XeLaTeX 转换失败',
      }
    );
  }

  /**
   * Strip MDX module-level `export`/`import` declarations that leak into
   * markdown when .mdx pages are scraped without JSX compilation.
   *
   * These appear at column 0 in the source (by MDX convention) and their
   * multi-line bodies close with a column-0 `};` line. Because the JS code
   * contains template literals with backticks, when Pandoc treats it as prose
   * it emits `\(` (inline math open) inside escaped regexes, causing
   * "Extra }, or forgotten $." LaTeX errors.
   *
   * Preserves fenced code blocks so in-doc JS/Python examples that happen to
   * start with `export` or `import` are not affected.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _stripMdxModuleDeclarations(content) {
    if (!content) return content;

    // Walk line-by-line, tracking fenced code blocks properly:
    // a closing fence must use the same character (` or ~) as the opener
    // and have at least as many repetitions (CommonMark spec).
    const lines = content.split('\n');
    const proseRanges = []; // [startIdx, endIdx) of prose line ranges
    let inFence = false;
    let fenceChar = '';
    let fenceCount = 0;
    let proseStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const fenceMatch = lines[i].match(/^(`{3,}|~{3,})/);

      if (!inFence && fenceMatch) {
        // Opening fence — save preceding prose range
        if (i > proseStart) proseRanges.push([proseStart, i]);
        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceCount = fenceMatch[1].length;
      } else if (
        inFence &&
        fenceMatch &&
        fenceMatch[1][0] === fenceChar &&
        fenceMatch[1].length >= fenceCount &&
        lines[i].slice(fenceMatch[1].length).trim() === ''
      ) {
        // Valid closing fence
        inFence = false;
        proseStart = i + 1;
      }
    }
    // Remaining lines after last fence are prose
    if (!inFence && proseStart < lines.length) {
      proseRanges.push([proseStart, lines.length]);
    }

    // Strip MDX declarations only in prose segments
    for (const [start, end] of proseRanges) {
      let segment = lines.slice(start, end).join('\n');

      // 1) Multi-line export closed by column-0 `};` or `});`
      segment = segment.replace(
        /^export[ \t]+(?:const|default|function|let|var)\b[\s\S]*?^\}\)?;[ \t]*$/gm,
        ''
      );

      // 2) Single-line export
      segment = segment.replace(
        /^export[ \t]+(?:const|default|function|let|var)\b[^\n]*;[ \t]*$/gm,
        ''
      );

      // 3) Top-level MDX imports
      segment = segment.replace(
        /^import[ \t]+[^\n;]*?\bfrom[ \t]+['"][^'"\n]+['"];?[ \t]*$/gm,
        ''
      );

      const newLines = segment.split('\n');
      for (let i = start; i < end; i++) {
        lines[i] = newLines[i - start];
      }
    }

    return lines.join('\n');
  }

  /**
   * Strip PascalCase JSX component tags (`<Foo ... />`, `<Foo>`, `</Foo>`)
   * using a brace-aware scanner that correctly skips over nested JSX
   * inside attribute values like `<Tag attr={<Inner />} />`.
   *
   * Rules:
   * - Tag name must start with an uppercase letter (JSX convention).
   * - Inside the attribute list, `{...}` expressions are tracked with a
   *   depth counter, so any `>` encountered while `depth > 0` is ignored.
   * - String attribute values (`"..."` / `'...'`) are skipped verbatim.
   * - If no closing `>` is found before end of input, the scanner leaves
   *   the text untouched and moves on.
   *
   * Does not attempt to handle backtick template literals inside JSX
   * attributes; those are exceedingly rare in scraped MDX and can be
   * added if a real case shows up.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _stripPascalCaseJsxTags(content) {
    if (!content) return content;

    const len = content.length;
    let out = '';
    let i = 0;

    while (i < len) {
      const ch = content[i];
      if (ch !== '<') {
        out += ch;
        i++;
        continue;
      }

      // Possible tag start. Allow `</` closing form.
      let nameStart = i + 1;
      if (nameStart < len && content[nameStart] === '/') nameStart++;

      const nameChar = content[nameStart];
      if (!nameChar || nameChar < 'A' || nameChar > 'Z') {
        // Not a PascalCase JSX tag — keep the `<` as-is.
        out += ch;
        i++;
        continue;
      }

      // Scan the tag name (letters/digits).
      let afterName = nameStart + 1;
      while (
        afterName < len &&
        ((content[afterName] >= 'A' && content[afterName] <= 'Z') ||
          (content[afterName] >= 'a' && content[afterName] <= 'z') ||
          (content[afterName] >= '0' && content[afterName] <= '9'))
      ) {
        afterName++;
      }

      // Scan attributes until balanced `>` is found.
      let depth = 0;
      let inString = false;
      let stringChar = '';
      let end = -1;
      for (let m = afterName; m < len; m++) {
        const c = content[m];
        const prev = m > 0 ? content[m - 1] : '';

        if (inString) {
          if (c === stringChar && prev !== '\\') {
            inString = false;
          }
          continue;
        }

        if (c === '"' || c === "'") {
          inString = true;
          stringChar = c;
          continue;
        }

        if (c === '{') {
          depth++;
        } else if (c === '}') {
          if (depth > 0) depth--;
        } else if (c === '>' && depth === 0) {
          end = m;
          break;
        }
      }

      if (end === -1) {
        // Malformed / unterminated — skip past `<` only.
        out += ch;
        i++;
        continue;
      }

      // Drop the entire tag [i .. end].
      i = end + 1;
    }

    return out;
  }

  /**
   * Strip all MDX constructs from content using AST-based parsing for maximum
   * reliability. Handles:
   * - `mdxjsEsm`: module-level `export`/`import` declarations
   * - `mdxJsxFlowElement`/`mdxJsxTextElement`: JSX components
   *   - Known components are transformed (Info→blockquote, Step→header, etc.)
   *   - Unknown PascalCase components have tags stripped, children preserved
   *   - HTML elements (lowercase) are preserved
   * - `mdxFlowExpression`/`mdxTextExpression`: `{expression}` blocks
   *
   * Falls back to regex-based stripping if AST parsing fails.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _stripMdxWithAst(content) {
    if (!content) return content;

    try {
      const tree = fromMarkdown(content, {
        extensions: [mdxjs()],
        mdastExtensions: [mdxFromMarkdown()],
      });

      const edits = [];

      const getAttr = (node, attrName) => {
        const attr = node.attributes?.find((a) => a.name === attrName);
        if (!attr) return '';
        return typeof attr.value === 'string' ? attr.value : '';
      };

      const collectEdits = (node) => {
        if (node.type === 'mdxjsEsm') {
          edits.push([node.position.start.offset, node.position.end.offset, '']);
          return;
        }

        if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
          edits.push([node.position.start.offset, node.position.end.offset, '']);
          return;
        }

        if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
          const name = node.name;
          const start = node.position.start.offset;
          const end = node.position.end.offset;

          // Lowercase/null → HTML element, recurse into children only
          if (!name || name[0] < 'A' || name[0] > 'Z') {
            if (node.children) node.children.forEach(collectEdits);
            return;
          }

          // Extract and recursively process inner content
          let innerContent = '';
          if (node.children?.length > 0) {
            const innerStart = node.children[0].position.start.offset;
            const innerEnd = node.children[node.children.length - 1].position.end.offset;
            innerContent = content.slice(innerStart, innerEnd);
            innerContent = this._stripMdxWithAst(innerContent);
          }

          let replacement;
          switch (name) {
            case 'Steps':
            case 'Tabs':
            case 'AccordionGroup':
              replacement = innerContent;
              break;
            case 'Step': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Tab': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n#### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Accordion': {
              const title = getAttr(node, 'title');
              replacement = title ? `\n#### ${title}\n\n${innerContent}\n` : `\n${innerContent}\n`;
              break;
            }
            case 'Info':
            case 'Tip':
            case 'Warning':
            case 'Note': {
              const label = name === 'Tip' ? 'Tip' : name === 'Warning' ? 'Warning' : 'Note';
              replacement = this._contentToBlockquote(innerContent, label);
              break;
            }
            default:
              replacement = innerContent;
              break;
          }

          edits.push([start, end, replacement]);
          return;
        }

        // For all other node types, recurse into children
        if (node.children) node.children.forEach(collectEdits);
      };

      collectEdits(tree);

      // Sort by start offset descending, apply from end to start
      edits.sort((a, b) => b[0] - a[0]);

      let result = content;
      for (const [s, e, replacement] of edits) {
        result = result.slice(0, s) + replacement + result.slice(e);
      }

      return result;
    } catch (error) {
      this.logger?.warn?.('MDX AST parse failed, falling back to regex', {
        error: error.message,
      });
      return this._stripMdxWithRegex(content);
    }
  }

  /**
   * Regex/scanner fallback for MDX stripping when AST parsing fails.
   * Combines module declaration stripping, named component transforms,
   * and PascalCase JSX tag stripping.
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _stripMdxWithRegex(content) {
    if (!content) return content;

    let result = this._stripMdxModuleDeclarations(content);

    result = result.replace(/<\/?Steps>/g, '');
    result = result.replace(/<Step[^>]*title="([^"]+)"[^>]*>/g, '\n### $1\n');
    result = result.replace(/<\/Step>/g, '\n');
    result = result.replace(/<\/?Tabs>/g, '');
    result = result.replace(/<Tab[^>]*title="([^"]+)"[^>]*>/g, '\n#### $1\n');
    result = result.replace(/<\/Tab>/g, '\n');
    result = result.replace(/<\/?AccordionGroup>/g, '');
    result = result.replace(/<Accordion[^>]*title="([^"]+)"[^>]*>/g, '\n#### $1\n');
    result = result.replace(/<\/Accordion>/g, '\n');
    result = result.replace(
      /<(Info|Tip|Warning|Note)>([\s\S]*?)<\/\1>/g,
      (_match, tag, innerContent) => {
        const label = tag === 'Tip' ? 'Tip' : tag === 'Warning' ? 'Warning' : 'Note';
        return this._contentToBlockquote(innerContent, label);
      }
    );

    result = this._stripPascalCaseJsxTags(result);

    return result;
  }

  /**
   * Convert text content to a markdown blockquote with a label.
   *
   * @param {string} innerContent
   * @param {string} label
   * @returns {string}
   * @private
   */
  _contentToBlockquote(innerContent, label) {
    if (!innerContent?.trim()) return '';

    const lines = innerContent.split('\n');
    const quotedLines = [];
    let firstContent = true;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (firstContent) {
        quotedLines.push(`> **${label}:** ${trimmed}`);
        firstContent = false;
      } else {
        quotedLines.push(`> ${trimmed}`);
      }
    }
    return '\n' + quotedLines.join('\n') + '\n';
  }

  /**
   * Split markdown into prose/code segments so fenced code block examples can
   * be preserved verbatim during prose-only rewrites.
   *
   * @param {string} content
   * @returns {{type: 'prose' | 'code', text: string}[]}
   * @private
   */
  _splitFencedCodeBlockSegments(content) {
    if (typeof content !== 'string' || content.length === 0) {
      return [];
    }

    const lines = content.split('\n');
    const segments = [];
    let buffer = [];
    let currentType = 'prose';
    let inFence = false;
    let fenceChar = '';
    let fenceCount = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      segments.push({ type: currentType, text: buffer.join('\n') });
      buffer = [];
    };

    for (const line of lines) {
      const fenceMatch = line.match(/^\s*>?\s*(`{3,}|~{3,})(.*)$/);

      if (!inFence && fenceMatch) {
        flush();
        inFence = true;
        currentType = 'code';
        fenceChar = fenceMatch[1][0];
        fenceCount = fenceMatch[1].length;
        buffer.push(line);
        continue;
      }

      if (
        inFence &&
        fenceMatch &&
        fenceMatch[1][0] === fenceChar &&
        fenceMatch[1].length >= fenceCount &&
        fenceMatch[2].trim() === ''
      ) {
        buffer.push(line);
        flush();
        inFence = false;
        currentType = 'prose';
        fenceChar = '';
        fenceCount = 0;
        continue;
      }

      buffer.push(line);
    }

    flush();
    return segments;
  }

  /**
   * Apply a transform only to prose segments outside fenced code blocks.
   *
   * @param {string} content
   * @param {(segment: string) => string} transform
   * @returns {string}
   * @private
   */
  _mapProseSegments(content, transform) {
    if (!content) return content;

    const segments = this._splitFencedCodeBlockSegments(content);
    if (segments.length === 0) return content;

    return segments
      .map((segment) => (segment.type === 'prose' ? transform(segment.text) : segment.text))
      .join('\n');
  }

  /**
   * Find the closing `]` for an image alt text while honoring nested brackets
   * and backslash escapes.
   *
   * @param {string} content
   * @param {number} openBracketIndex
   * @returns {number}
   * @private
   */
  _findClosingMarkdownBracket(content, openBracketIndex) {
    let depth = 1;

    for (let i = openBracketIndex + 1; i < content.length; i++) {
      if (content[i] === '\\') {
        i++;
        continue;
      }

      if (content[i] === '[') {
        depth++;
      } else if (content[i] === ']') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Parse the destination/title portion of `![alt](...)` without greedily
   * swallowing optional title text.
   *
   * @param {string} content
   * @param {number} openParenIndex
   * @returns {{end: number, url: string, destinationSource: string, titleSource: string}|null}
   * @private
   */
  _parseMarkdownImageTarget(content, openParenIndex) {
    let i = openParenIndex + 1;
    let depth = 1;
    let inQuote = '';
    let inAngle = false;

    while (i < content.length) {
      const char = content[i];

      if (char === '\\') {
        i += 2;
        continue;
      }

      if (inQuote) {
        if (char === inQuote) {
          inQuote = '';
        }
        i++;
        continue;
      }

      if (inAngle) {
        if (char === '>') {
          inAngle = false;
        }
        i++;
        continue;
      }

      if (char === '<') {
        inAngle = true;
      } else if (char === '"' || char === "'") {
        inQuote = char;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
      }

      i++;
    }

    if (depth !== 0) {
      return null;
    }

    const inner = content.slice(openParenIndex + 1, i);
    const parsed = this._parseMarkdownImageTargetBody(inner);
    if (!parsed?.url) {
      return null;
    }

    return { end: i, ...parsed };
  }

  /**
   * Parse the inside of `![alt](...)` into destination and optional title.
   *
   * @param {string} targetBody
   * @returns {{url: string, destinationSource: string, titleSource: string}|null}
   * @private
   */
  _parseMarkdownImageTargetBody(targetBody) {
    let i = 0;

    while (i < targetBody.length && /\s/.test(targetBody[i])) {
      i++;
    }

    if (i >= targetBody.length) {
      return null;
    }

    const destinationStart = i;
    let destinationSource = '';
    let url = '';

    if (targetBody[i] === '<') {
      i++;
      const urlStart = i;

      while (i < targetBody.length) {
        if (targetBody[i] === '\\') {
          i += 2;
          continue;
        }
        if (targetBody[i] === '>') {
          break;
        }
        i++;
      }

      if (i >= targetBody.length || targetBody[i] !== '>') {
        return null;
      }

      destinationSource = targetBody.slice(destinationStart, i + 1);
      url = targetBody.slice(urlStart, i);
      i++;
    } else {
      let parenDepth = 0;

      while (i < targetBody.length) {
        const char = targetBody[i];

        if (char === '\\') {
          i += 2;
          continue;
        }

        if (/\s/.test(char) && parenDepth === 0) {
          break;
        }

        if (char === '(') {
          parenDepth++;
        } else if (char === ')' && parenDepth > 0) {
          parenDepth--;
        }

        i++;
      }

      destinationSource = targetBody.slice(destinationStart, i);
      url = destinationSource.trim();
    }

    if (!url) {
      return null;
    }

    const remainder = targetBody.slice(i).trim();
    if (!remainder) {
      return { url, destinationSource, titleSource: '' };
    }

    const titleSource = this._parseMarkdownTitleSource(remainder);
    return { url, destinationSource, titleSource };
  }

  /**
   * Parse a valid markdown title suffix (`"..."`, `'...'`, or `(...)`).
   *
   * @param {string} remainder
   * @returns {string}
   * @private
   */
  _parseMarkdownTitleSource(remainder) {
    const opener = remainder[0];
    const closer = opener === '(' ? ')' : opener === '"' ? '"' : opener === "'" ? "'" : '';

    if (!closer) {
      return '';
    }

    let i = 1;
    while (i < remainder.length) {
      if (remainder[i] === '\\') {
        i += 2;
        continue;
      }

      if (remainder[i] === closer) {
        return remainder.slice(i + 1).trim() === '' ? remainder.slice(0, i + 1) : '';
      }

      i++;
    }

    return '';
  }

  /**
   * Collect markdown image references from prose content.
   *
   * @param {string} content
   * @returns {Array<{type: 'markdown', start: number, end: number, altText: string, url: string, destinationSource: string, titleSource: string}>}
   * @private
   */
  _collectMarkdownImageReferences(content) {
    if (!content) return [];

    const references = [];

    for (let i = 0; i < content.length - 1; i++) {
      if (content[i] !== '!' || content[i + 1] !== '[') {
        continue;
      }

      const altOpenIndex = i + 1;
      const altCloseIndex = this._findClosingMarkdownBracket(content, altOpenIndex);
      if (altCloseIndex === -1 || content[altCloseIndex + 1] !== '(') {
        continue;
      }

      const parsedTarget = this._parseMarkdownImageTarget(content, altCloseIndex + 1);
      if (!parsedTarget) {
        continue;
      }

      references.push({
        type: 'markdown',
        start: i,
        end: parsedTarget.end + 1,
        altText: content.slice(i + 2, altCloseIndex),
        url: parsedTarget.url,
        destinationSource: parsedTarget.destinationSource,
        titleSource: parsedTarget.titleSource,
      });

      i = parsedTarget.end;
    }

    return references;
  }

  /**
   * Collect raw HTML <img> references from prose content.
   *
   * @param {string} content
   * @returns {Array<{type: 'html', start: number, end: number, altText: string, url: string}>}
   * @private
   */
  _collectHtmlImageReferences(content) {
    if (!content) return [];

    const references = [];

    for (const match of content.matchAll(/<img\b([^>]*?)src=(["'])([^"']+)\2([^>]*)>/gi)) {
      const start = match.index ?? 0;
      const attrs = `${match[1]} ${match[4]}`;
      const altMatch = attrs.match(/\balt=(["'])(.*?)\1/i);

      references.push({
        type: 'html',
        start,
        end: start + match[0].length,
        altText: altMatch?.[2]?.trim() || 'Image',
        url: match[3],
      });
    }

    return references;
  }

  /**
   * Collect remote image references from prose content only.
   *
   * @param {string} content
   * @returns {Array}
   * @private
   */
  _collectRemoteImageReferencesFromProse(content) {
    return [
      ...this._collectMarkdownImageReferences(content),
      ...this._collectHtmlImageReferences(content),
    ].filter((reference) => this._isRemoteImageUrl(reference.url));
  }

  /**
   * Rewrite remote image references in prose while preserving fenced code
   * blocks verbatim.
   *
   * @param {string} content
   * @param {Map<string, string|null>} resolvedUrls
   * @returns {string}
   * @private
   */
  _rewritePdfImagesInProse(content, resolvedUrls) {
    const references = this._collectRemoteImageReferencesFromProse(content);
    if (references.length === 0) {
      return content;
    }

    let rewritten = content;

    references
      .sort((a, b) => b.start - a.start)
      .forEach((reference) => {
        const localPath = resolvedUrls.get(reference.url);
        let replacement;

        if (reference.type === 'markdown') {
          if (localPath) {
            replacement =
              `![${reference.altText}](${localPath}` +
              `${reference.titleSource ? ` ${reference.titleSource}` : ''})`;
          } else {
            const label = reference.altText.trim() || 'Image';
            replacement =
              `[${label}](${reference.destinationSource}` +
              `${reference.titleSource ? ` ${reference.titleSource}` : ''})`;
          }
        } else if (localPath) {
          replacement = `![${reference.altText}](${localPath})`;
        } else {
          replacement = `[${reference.altText}](${reference.url})`;
        }

        rewritten = rewritten.slice(0, reference.start) + replacement + rewritten.slice(reference.end);
      });

    return rewritten;
  }

  /**
   * 检查图片 URL 是否是 XeLaTeX/Pandoc 不稳定的格式。
   * XeLaTeX 原生更适合 png/jpg/pdf；webp/avif/gif/svg 需要额外处理。
   *
   * @param {string} url
   * @returns {boolean}
   * @private
   */
  _isPdfUnsafeImageUrl(url) {
    if (!url || typeof url !== 'string') return false;

    const lower = url.trim().toLowerCase();
    if (!lower) return false;

    if (/[?&](?:fm|format)=(?:png|jpg|jpeg|pdf)(?:[&#]|$)/.test(lower)) {
      return false;
    }

    if (/\.(?:png|jpe?g|pdf)(?:$|[?#])/i.test(lower)) {
      return false;
    }

    return /\.(?:webp|avif|gif|svg)(?:$|[?#])/i.test(lower);
  }

  /**
   * 将 PDF 不安全的图片语法降级为普通超链接，避免 Pandoc/XeLaTeX 直接失败。
   *
   * @param {string} content
   * @returns {string}
   * @private
   */
  _downgradePdfUnsafeImages(content) {
    if (!content) return content;

    let downgraded = content;

    downgraded = downgraded.replace(
      /!\[([^\]]*)\]\((<)?([^)\n>]+)(>)?((?:\s+["'][^"']*["'])?\s*)\)/g,
      (match, altText = '', openBracket = '', url, closeBracket = '') => {
        if (!this._isPdfUnsafeImageUrl(url)) {
          return match;
        }

        const label = altText.trim() || 'Image';
        return `[${label}](${openBracket}${url}${closeBracket})`;
      }
    );

    downgraded = downgraded.replace(
      /<img\b([^>]*?)src=(["'])([^"']+)\2([^>]*)>/gi,
      (match, before, _quote, src, after) => {
        if (!this._isPdfUnsafeImageUrl(src)) {
          return match;
        }

        const attrs = `${before} ${after}`;
        const altMatch = attrs.match(/\balt=(["'])(.*?)\1/i);
        const label = altMatch?.[2]?.trim() || 'Image';
        return `[${label}](${src})`;
      }
    );

    return downgraded;
  }

  /**
   * 将 Markdown 中仍不适合 XeLaTeX 直接处理的图片优先转换为本地 PNG；
   * 如果转换失败，则回退为普通超链接以避免整个 PDF 生成失败。
   *
   * @param {string} content
   * @param {string} tempRootDir
   * @returns {Promise<{content: string, cleanupPaths: string[]}>}
   * @private
   */
  async _preparePdfImages(content, tempRootDir) {
    if (!content) {
      return { content, cleanupPaths: [] };
    }

    const urls = this._extractPdfUnsafeImageUrls(content);
    if (urls.length === 0) {
      return { content, cleanupPaths: [] };
    }

    const mediaDir = path.join(tempRootDir, `media-${Date.now()}`);
    const resolvedUrls = new Map();
    const cleanupPaths = [mediaDir];

    for (const url of urls) {
      try {
        const localPath = await this._materializePdfSafeImage(url, mediaDir);
        resolvedUrls.set(url, localPath);
      } catch (error) {
        this.logger?.warn?.('图片转换失败，将降级为普通链接', {
          url,
          error: error.message,
        });
        resolvedUrls.set(url, null);
      }
    }

    const prepared = this._mapProseSegments(content, (segment) =>
      this._rewritePdfImagesInProse(segment, resolvedUrls)
    );

    return { content: prepared, cleanupPaths };
  }

  /**
   * 提取内容中所有需要额外转换的图片 URL。
   *
   * @param {string} content
   * @returns {string[]}
   * @private
   */
  _extractPdfUnsafeImageUrls(content) {
    if (!content) return [];

    const urls = new Set();

    for (const segment of this._splitFencedCodeBlockSegments(content)) {
      if (segment.type !== 'prose') {
        continue;
      }

      for (const reference of this._collectRemoteImageReferencesFromProse(segment.text)) {
        urls.add(reference.url);
      }
    }

    return Array.from(urls);
  }

  /**
   * 下载并转换远程图片为本地 PNG，供 Pandoc/XeLaTeX 稳定读取。
   *
   * @param {string} url
   * @param {string} mediaDir
   * @returns {Promise<string|null>}
   * @private
   */
  async _materializePdfSafeImage(url, mediaDir) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return null;
    }

    fs.mkdirSync(mediaDir, { recursive: true });

    const digest = createHash('sha256').update(url).digest('hex').slice(0, 24);
    const outputPath = path.join(mediaDir, `${digest}.png`);

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'documentation-pdf-scraper/1.0',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`下载失败: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    const detectedFormat = this._detectDownloadedImageFormat(buffer, contentType);
    const sourceExtension = this._getImageExtensionFromUrl(url, contentType, detectedFormat);
    const sourcePath = path.join(mediaDir, `${digest}${sourceExtension}`);
    const shouldConvert = this._shouldConvertDownloadedImage(url, contentType, detectedFormat);

    if (fs.existsSync(sourcePath)) {
      if (!shouldConvert) {
        return sourcePath;
      }

      await this._convertImageToPng(sourcePath, outputPath);
      return outputPath;
    }

    await fs.promises.writeFile(sourcePath, buffer);

    if (!shouldConvert) {
      return sourcePath;
    }

    await this._convertImageToPng(sourcePath, outputPath);
    return outputPath;
  }

  /**
   * 判断是否为远程图片 URL。
   *
   * @param {string} url
   * @returns {boolean}
   * @private
   */
  _isRemoteImageUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
  }

  /**
   * 判断下载后的图片是否需要转为 PNG 才能稳定进入 XeLaTeX。
   *
   * @param {string} url
   * @param {string} contentType
   * @returns {boolean}
   * @private
   */
  _shouldConvertDownloadedImage(url, contentType = '', detectedFormat = '') {
    const normalizedFormat = detectedFormat.toLowerCase();
    const normalizedType = contentType.toLowerCase();

    if (normalizedFormat === 'png' || normalizedFormat === 'jpg' || normalizedFormat === 'jpeg') {
      return false;
    }

    if (normalizedFormat === 'pdf') {
      return false;
    }

    if (
      normalizedFormat === 'webp'
      || normalizedFormat === 'avif'
      || normalizedFormat === 'gif'
      || normalizedFormat === 'svg'
    ) {
      return true;
    }

    if (normalizedType.includes('image/png') || normalizedType.includes('image/jpeg')) {
      return false;
    }

    if (normalizedType.includes('application/pdf')) {
      return false;
    }

    if (normalizedType.includes('image/webp')) return true;
    if (normalizedType.includes('image/avif')) return true;
    if (normalizedType.includes('image/gif')) return true;
    if (normalizedType.includes('image/svg+xml')) return true;

    return this._isPdfUnsafeImageUrl(url);
  }

  /**
   * 根据真实下载内容识别图片格式，避免仅靠 URL 或响应头做脆弱判断。
   *
   * @param {Buffer} buffer
   * @param {string} contentType
   * @returns {string}
   * @private
   */
  _detectDownloadedImageFormat(buffer, contentType = '') {
    if (Buffer.isBuffer(buffer) && buffer.length > 0) {
      if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
      ) {
        return 'png';
      }

      if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpg';
      }

      const leadingAscii = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8');
      const trimmedLeadingAscii = leadingAscii.replace(/^\uFEFF/, '').trimStart().toLowerCase();

      if (trimmedLeadingAscii.includes('<svg')) {
        return 'svg';
      }

      if (buffer.length >= 6) {
        const gifSignature = buffer.subarray(0, 6).toString('ascii');
        if (gifSignature === 'GIF87a' || gifSignature === 'GIF89a') {
          return 'gif';
        }
      }

      if (
        buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      ) {
        return 'webp';
      }

      if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        return 'pdf';
      }

      if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (brand === 'avif' || brand === 'avis') {
          return 'avif';
        }
      }
    }

    const normalizedType = contentType.toLowerCase();
    if (normalizedType.includes('image/png')) return 'png';
    if (normalizedType.includes('image/jpeg')) return 'jpg';
    if (normalizedType.includes('image/webp')) return 'webp';
    if (normalizedType.includes('image/avif')) return 'avif';
    if (normalizedType.includes('image/gif')) return 'gif';
    if (normalizedType.includes('image/svg+xml')) return 'svg';
    if (normalizedType.includes('application/pdf')) return 'pdf';

    return '';
  }

  /**
   * 使用项目自带 Python 运行时把图片转换为 PNG。
   *
   * @param {string} inputPath
   * @param {string} outputPath
   * @returns {Promise<void>}
   * @private
   */
  async _convertImageToPng(inputPath, outputPath) {
    const pythonExecutable = this.config.python?.executable || 'python3';
    const scriptPath = path.join(process.cwd(), 'src/python/convert_image.py');

    await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, [scriptPath, inputPath, outputPath]);
      let stderr = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `image conversion exited with code ${code}`));
          return;
        }

        resolve();
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 从 URL 推断文件扩展名；推断失败时保底使用 .img。
   *
   * @param {string} url
   * @returns {string}
   * @private
   */
  _getImageExtensionFromUrl(url, contentType = '', detectedFormat = '') {
    const normalizedFormat = detectedFormat.toLowerCase();
    const normalizedType = contentType.toLowerCase();
    if (normalizedFormat === 'png') return '.png';
    if (normalizedFormat === 'jpg' || normalizedFormat === 'jpeg') return '.jpg';
    if (normalizedFormat === 'webp') return '.webp';
    if (normalizedFormat === 'avif') return '.avif';
    if (normalizedFormat === 'gif') return '.gif';
    if (normalizedFormat === 'svg') return '.svg';
    if (normalizedFormat === 'pdf') return '.pdf';

    if (normalizedType.includes('image/png')) return '.png';
    if (normalizedType.includes('image/jpeg')) return '.jpg';
    if (normalizedType.includes('image/webp')) return '.webp';
    if (normalizedType.includes('image/avif')) return '.avif';
    if (normalizedType.includes('image/gif')) return '.gif';
    if (normalizedType.includes('image/svg+xml')) return '.svg';
    if (normalizedType.includes('application/pdf')) return '.pdf';

    if (!url || typeof url !== 'string') {
      return '.img';
    }

    try {
      const pathname = new URL(url).pathname || '';
      const extension = path.extname(pathname);
      return extension || '.img';
    } catch {
      return '.img';
    }
  }

  /**
   * 通过临时 header 文件注入 LaTeX 配置，避免 Pandoc 对 header-includes
   * 变量做额外转义，导致 `\\usepackage` 之类的坏输出。
   *
   * @returns {string}
   * @private
   */
  _getPandocHeaderContent() {
    return String.raw`\usepackage{fvextra}
\RecustomVerbatimEnvironment{verbatim}{Verbatim}{breaklines,breakanywhere,fontsize=\small}
\DefineVerbatimEnvironment{Highlighting}{Verbatim}{breaklines,breakanywhere,fontsize=\small,commandchars=\\\{\}}
\usepackage{xurl}
`;
  }

  /**
   * 创建 Pandoc 头文件，供 --include-in-header 使用。
   *
   * @param {string} tempDir
   * @returns {string}
   * @private
   */
  _createPandocHeaderFile(tempDir) {
    fs.mkdirSync(tempDir, { recursive: true });

    const headerPath = path.join(
      tempDir,
      `pandoc-header-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tex`
    );

    fs.writeFileSync(headerPath, this._getPandocHeaderContent(), 'utf8');

    return headerPath;
  }

  /**
   * 清理 Markdown 内容，修复 Pandoc 不支持的语法
   * @param {string} content
   * @returns {string}
   * @private
   */
  _cleanMarkdownContent(content) {
    if (!content) return content;

    // 00. Strip all MDX constructs (module-level JS, JSX components, expressions)
    // using AST-based approach with regex fallback.
    let cleaned = this._stripMdxWithAst(content);

    // 1. 修复代码块中的 theme={...} 属性
    // ```markdown theme={null} -> ```markdown
    // 支持任意数量的反引号 (>=3)
    cleaned = cleaned.replace(/^(`{3,})(\w+)\s+theme=\{[^}]+\}/gm, '$1$2');

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

    cleaned = this._normalizeReferenceCardBlocks(cleaned);
    cleaned = this._formatReferenceTablesForPdf(cleaned);

    // 4. 修复 blockquote 中的列表项（防止 LaTeX \end{quote} / missing \item 错误）
    // 4a. Remove empty list items inside blockquotes: "> -" or "> *" with no content
    cleaned = cleaned.replace(/^(>\s*)-\s*$/gm, '$1');
    cleaned = cleaned.replace(/^(>\s*)\*\s*$/gm, '$1');

    // 4b. Ensure a blank line between blockquote prose and blockquote list items
    // e.g. "> text\n> - item" -> "> text\n>\n> - item"
    cleaned = cleaned.replace(/^(>.*[^\s-*].*)\n(>\s*[-*]\s+\S)/gm, '$1\n>\n$2');

    // 4c. Convert ATX headings inside blockquotes to bold text.
    // Pandoc 3.9+ inserts `\mbox{}%` before `\subsection` inside `\begin{quote}`,
    // but older Pandoc (e.g. Ubuntu 24.04 ships 3.1.x) does not, which causes
    // `LaTeX Error: Something's wrong--perhaps a missing \item` at `\end{quote}`.
    // Bold preserves visual emphasis without triggering quote+section nesting.
    //
    // Fence-aware: skip lines inside fenced code blocks (with optional `> `
    // blockquote prefix) so markdown examples that show heading syntax inside
    // ` ``` ... ``` ` blocks are not corrupted. Closing fences must use the
    // same character (` or ~) and at least as many repetitions as the opener
    // (CommonMark spec).
    {
      const lines = cleaned.split('\n');
      let inFence = false;
      let fenceChar = '';
      let fenceCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const fenceMatch = lines[i].match(/^>?\s*(`{3,}|~{3,})/);
        if (fenceMatch) {
          const fc = fenceMatch[1][0];
          const fcCount = fenceMatch[1].length;
          if (!inFence) {
            inFence = true;
            fenceChar = fc;
            fenceCount = fcCount;
          } else if (fc === fenceChar && fcCount >= fenceCount) {
            inFence = false;
          }
          continue;
        }
        if (inFence) continue;
        lines[i] = lines[i].replace(/^(>\s*)#{1,6}\s+(.+?)\s*$/, '$1**$2**');
      }
      cleaned = lines.join('\n');
    }

    // 5. 将图片 URL 中的 fm=webp 替换为 fm=png（LaTeX 不支持 webp 格式）
    cleaned = cleaned.replace(/fm=webp/g, 'fm=png');
    cleaned = this._convertLongInlineCodeToBreakablePaths(cleaned);

    return cleaned;
  }

  _formatReferenceTablesForPdf(content) {
    const lines = String(content || '').split('\n');
    const output = [];

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');

      if (
        !this._isReferenceTableHeader(headerCells) ||
        !this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index]);
        continue;
      }

      output.push(
        '| Key | Type / Values | Details |',
        '|:------------------------------------|:----------------------------|:----------------------------------------------------|'
      );
      index += 2;

      while (index < lines.length) {
        const rowCells = this._parseMarkdownTableRow(lines[index]);
        if (!rowCells || rowCells.length !== 3) {
          break;
        }

        const [key, typeValues, details] = rowCells;
        output.push(
          `| ${this._formatReferenceTableCell(key)} | ${this._formatReferenceTableCell(
            typeValues
          )} | ${this._formatReferenceTableCell(details)} |`
        );

        index++;
      }

      index--;
    }

    return output.join('\n');
  }

  _formatReferenceTableCell(cell) {
    return this._convertLongInlineCodeLineToBreakablePaths(this._normalizeReferenceTableCell(cell));
  }

  _isReferenceTableHeader(cells) {
    if (!cells || cells.length !== 3) {
      return false;
    }

    const normalized = cells.map((cell) => cell.replace(/\s+/g, ' ').trim().toLowerCase());

    return (
      normalized[0] === 'key' &&
      normalized[1] === 'type / values' &&
      normalized[2] === 'details'
    );
  }

  _isMarkdownTableSeparator(cells) {
    return (
      Array.isArray(cells) &&
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
    );
  }

  _parseMarkdownTableRow(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      return null;
    }

    const cells = [];
    let current = '';
    const body = trimmed.slice(1, -1);

    for (let index = 0; index < body.length; index++) {
      const char = body[index];
      const previous = index > 0 ? body[index - 1] : '';

      if (char === '|' && previous !== '\\') {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());

    return cells;
  }

  _normalizeReferenceTableCell(cell) {
    return String(cell || '').replace(/\\\|/g, '|').trim();
  }

  _stripWrappingCodeSpan(value) {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/^`([^`]*)`$/s);
    return match ? match[1].trim() : trimmed;
  }

  _normalizeReferenceCardBlocks(content) {
    const lines = String(content || '').split('\n');
    const output = [];
    const seenKeys = new Set();

    for (let index = 0; index < lines.length; index++) {
      const headerCells = this._parseMarkdownTableRow(lines[index]);
      const separatorCells = this._parseMarkdownTableRow(lines[index + 1] || '');
      if (
        this._isReferenceTableHeader(headerCells) &&
        this._isMarkdownTableSeparator(separatorCells)
      ) {
        output.push(lines[index], lines[index + 1]);
        index += 2;

        while (index < lines.length) {
          const rowCells = this._parseMarkdownTableRow(lines[index]);
          if (!rowCells || rowCells.length !== 3) {
            break;
          }

          seenKeys.add(this._referenceKeyId(rowCells[0]));
          output.push(lines[index]);
          index++;
        }

        index--;
        continue;
      }

      const block = this._parseReferenceCardBlock(lines, index);
      if (!block) {
        output.push(lines[index]);
        this._rememberLinearizedReferenceKey(lines[index], seenKeys);
        continue;
      }

      if (!seenKeys.has(block.keyId)) {
        output.push(
          `**Key:** ${block.key}`,
          '',
          `**Type / Values:** ${this._stripWrappingCodeSpan(block.typeValues)}`,
          '',
          `**Details:** ${block.details}`,
          ''
        );
        seenKeys.add(block.keyId);
      }

      index = block.endIndex;
    }

    return output.join('\n');
  }

  _rememberLinearizedReferenceKey(line, seenKeys) {
    const match = String(line || '').match(/^\*\*Key:\*\*\s+(.+)$/);
    if (match) {
      seenKeys.add(this._referenceKeyId(match[1]));
    }
  }

  _parseReferenceCardBlock(lines, startIndex) {
    if (String(lines[startIndex] || '').trim() !== 'Key') {
      return null;
    }

    const keyIndex = this._nextNonBlankLineIndex(lines, startIndex + 1);
    const typeLabelIndex = this._nextNonBlankLineIndex(lines, keyIndex + 1);
    const typeValueIndex = this._nextNonBlankLineIndex(lines, typeLabelIndex + 1);
    const detailsLabelIndex = this._nextNonBlankLineIndex(lines, typeValueIndex + 1);
    const detailsStartIndex = this._nextNonBlankLineIndex(lines, detailsLabelIndex + 1);

    if (
      keyIndex === -1 ||
      typeLabelIndex === -1 ||
      typeValueIndex === -1 ||
      detailsLabelIndex === -1 ||
      detailsStartIndex === -1 ||
      String(lines[typeLabelIndex]).trim() !== 'Type / Values' ||
      String(lines[detailsLabelIndex]).trim() !== 'Details'
    ) {
      return null;
    }

    const detailLines = [];
    let endIndex = detailsStartIndex;

    for (let index = detailsStartIndex; index < lines.length; index++) {
      if (String(lines[index] || '').trim() === '') {
        break;
      }

      detailLines.push(lines[index].trim());
      endIndex = index;
    }

    if (detailLines.length === 0) {
      return null;
    }

    const key = String(lines[keyIndex] || '').trim();

    return {
      key,
      keyId: this._referenceKeyId(key),
      typeValues: String(lines[typeValueIndex] || '').trim(),
      details: detailLines.join(' '),
      endIndex,
    };
  }

  _nextNonBlankLineIndex(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index++) {
      if (String(lines[index] || '').trim() !== '') {
        return index;
      }
    }

    return -1;
  }

  _referenceKeyId(value) {
    return this._stripWrappingCodeSpan(this._normalizeReferenceTableCell(value));
  }

  _convertLongInlineCodeToBreakablePaths(content) {
    const lines = String(content || '').split('\n');
    let inFence = false;
    let fenceChar = '';
    let fenceCount = 0;

    return lines
      .map((line) => {
        const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
        if (fenceMatch) {
          const char = fenceMatch[2][0];
          const count = fenceMatch[2].length;
          if (!inFence) {
            inFence = true;
            fenceChar = char;
            fenceCount = count;
          } else if (char === fenceChar && count >= fenceCount) {
            inFence = false;
          }
          return line;
        }

        if (inFence || /^\s*#/.test(line)) {
          return line;
        }

        return this._convertLongInlineCodeLineToBreakablePaths(line);
      })
      .join('\n');
  }

  _convertLongInlineCodeLineToBreakablePaths(line) {
    let output = '';
    let index = 0;

    while (index < line.length) {
      const openingIndex = line.indexOf('`', index);
      if (openingIndex === -1) {
        output += line.slice(index);
        break;
      }

      const tickCount = this._countBackticks(line, openingIndex);
      const marker = '`'.repeat(tickCount);
      const codeStart = openingIndex + tickCount;
      const closingIndex = this._findClosingBacktickRun(line, marker, codeStart);

      if (closingIndex === -1) {
        output += line.slice(index);
        break;
      }

      const code = line.slice(codeStart, closingIndex);
      output += line.slice(index, openingIndex);
      output += this._convertInlineCodePath(code, marker);
      index = closingIndex + tickCount;
    }

    return output;
  }

  _countBackticks(line, startIndex) {
    let count = 0;
    while (line[startIndex + count] === '`') {
      count++;
    }
    return count;
  }

  _findClosingBacktickRun(line, marker, startIndex) {
    let searchIndex = startIndex;

    while (searchIndex < line.length) {
      const closingIndex = line.indexOf(marker, searchIndex);
      if (closingIndex === -1) {
        return -1;
      }

      if (line[closingIndex + marker.length] !== '`') {
        return closingIndex;
      }

      searchIndex = closingIndex + marker.length;
    }

    return -1;
  }

  _convertInlineCodePath(code, marker) {
    const shouldConvert =
      code.includes('|') || (code.length >= 24 && /[\\/._:-]/.test(code));

    if (!shouldConvert) {
      return `${marker}${code}${marker}`;
    }

    return `\\texttt{${this._escapeBreakableInlineCodeForLatex(code)}}`;
  }

  _escapeBreakableInlineCodeForLatex(code) {
    const escaped = [];
    const breakAfter = new Set(['/', '\\', '.', '_', '-', ':', '|', ',', '=', '{', '}']);

    for (const char of code) {
      switch (char) {
        case '\\':
          escaped.push('\\textbackslash{}');
          break;
        case '$':
          escaped.push('\\$');
          break;
        case '%':
          escaped.push('\\%');
          break;
        case '&':
          escaped.push('\\&');
          break;
        case '#':
          escaped.push('\\#');
          break;
        case '_':
          escaped.push('\\_');
          break;
        case '{':
          escaped.push('\\{');
          break;
        case '}':
          escaped.push('\\}');
          break;
        case '~':
          escaped.push('\\textasciitilde{}');
          break;
        case '^':
          escaped.push('\\textasciicircum{}');
          break;
        case '|':
          escaped.push('|');
          break;
        default:
          escaped.push(char);
      }

      if (breakAfter.has(char)) {
        escaped.push('\\allowbreak{}');
      }
    }

    return escaped.join('');
  }

  _buildPandocArgs(inputPath, outputPath, options = {}) {
    const markdownPdfConfig = {
      ...(this.config.markdownPdf || {}),
      ...(options || {}),
    };
    const cjkMainFont = markdownPdfConfig.cjkMainFont || 'Noto Sans CJK SC';

    const args = [
      inputPath,
      '-o',
      outputPath,
      '--pdf-engine=xelatex', // 使用 xelatex 支持中文
      '--variable',
      `CJKmainfont=${cjkMainFont}`, // 主字体（使用 CI 可用的开源字体，支持通过配置覆盖）
      '--variable',
      'geometry:margin=1in', // 页边距
    ];

    if (markdownPdfConfig.headerIncludePath) {
      args.push('--include-in-header', markdownPdfConfig.headerIncludePath);
    }

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
   * 构建 Pandoc -> LaTeX 的命令行参数。
   *
   * @param {string} inputPath
   * @param {string} outputPath
   * @param {Object} options
   * @returns {string[]}
   * @private
   */
  _buildPandocLatexArgs(inputPath, outputPath, options = {}) {
    const args = this._buildPandocArgs(inputPath, outputPath, options).filter(
      (arg) => arg !== '--pdf-engine=xelatex'
    );

    args.push('--standalone', '--to=latex');

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
      const preparedContent = await this._preparePdfImages(cleanedContent, tempDir);
      fs.writeFileSync(tempFile, preparedContent.content, 'utf8');

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

        if (preparedContent.cleanupPaths.length > 0) {
          preparedContent.cleanupPaths.forEach((cleanupPath) => {
            try {
              fs.rmSync(cleanupPath, { recursive: true, force: true });
            } catch {
              // Ignore cleanup errors
            }
          });
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
