// src/services/pandocPdfService.js
import { spawn } from 'child_process';
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
   * 检查图片 URL 是否是 XeLaTeX/Pandoc 不稳定的格式。
   * 目前重点处理 webp/avif；如果 URL 已显式请求 png/jpg/jpeg，则认为安全。
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

    return /\.(?:webp|avif)(?:$|[?#])/i.test(lower);
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

    // 6. 对仍然是 PDF 不安全格式的图片做降级，避免 Pandoc/XeLaTeX 直接失败。
    cleaned = this._downgradePdfUnsafeImages(cleaned);

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
