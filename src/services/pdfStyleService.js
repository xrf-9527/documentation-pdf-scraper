/**
 * PDF样式服务 - 处理PDF生成时的样式优化
 * 确保生成的PDF保持原网站的样式和格式
 */

import { createLogger } from '../utils/logger.js';

export class PDFStyleService {
  constructor(config = {}) {
    this.config = config;
    this.logger = createLogger('PDFStyleService');

    // 默认配置
    this.defaults = {
      theme: 'light',
      preserveCodeHighlighting: true,
      enableCodeWrap: true,
      maxCodeLineLength: 80,
      removeSelectors: [],
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      codeFont: 'Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      codeFontSize: '13px',
      lineHeight: '1.5',
      kindleOptimized: false,
      deviceProfile: 'default',
    };

    this.settings = { ...this.defaults, ...config };
    this.settings.removeSelectors = Array.isArray(this.settings.removeSelectors)
      ? this.settings.removeSelectors
      : [];

    // 设备配置预设
    this.deviceProfiles = {
      default: {},
      kindle7: {
        fontSize: '16px',
        codeFontSize: '13px',
        lineHeight: '1.6',
        maxCodeLineLength: 70,
        format: 'Letter',
        margin: { top: '0.8in', right: '0.5in', bottom: '0.8in', left: '0.5in' },
      },
      paperwhite: {
        fontSize: '16px',
        codeFontSize: '14px',
        lineHeight: '1.6',
        maxCodeLineLength: 75,
        format: 'Letter',
        margin: { top: '0.7in', right: '0.5in', bottom: '0.7in', left: '0.5in' },
      },
      oasis: {
        fontSize: '17px',
        codeFontSize: '14px',
        lineHeight: '1.65',
        maxCodeLineLength: 80,
        format: 'Letter',
        margin: { top: '0.6in', right: '0.4in', bottom: '0.6in', left: '0.4in' },
      },
      scribe: {
        fontSize: '18px',
        codeFontSize: '15px',
        lineHeight: '1.7',
        maxCodeLineLength: 90,
        format: 'A4',
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      },
    };

    // 应用设备配置
    if (this.settings.deviceProfile && this.settings.deviceProfile !== 'default') {
      const profile = this.deviceProfiles[this.settings.deviceProfile];
      if (profile) {
        this.settings = { ...this.settings, ...profile };
        this.logger.info('应用设备配置文件', { profile: this.settings.deviceProfile });
      }
    }
  }

  /**
   * 移除深色主题（独立于样式处理）
   * 安全：不替换 DOM，仅移除深色相关类/属性
   */
  async removeDarkTheme(page) {
    try {
      await page.evaluate(() => {
        // === 阶段1.1：清除浏览器存储中的主题偏好 ===
        // 防止 JavaScript 重新应用深色主题
        const themeKeys = [
          'theme',
          'theme-preference',
          'color-mode',
          'colorMode',
          'themeMode',
          'next-theme',
          'chakra-ui-color-mode',
          'mantine-color-scheme',
          'vuepress-color-scheme',
          'docusaurus.theme',
        ];

        themeKeys.forEach((key) => {
          try {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
          } catch {
            // localStorage 可能被禁用，忽略错误
          }
        });

        // === 阶段1.2：移除深色主题标记并设置浅色标识 ===
        // 强制移除根节点上的深色主题类
        document.documentElement.classList.remove('dark', 'dark-mode', 'theme-dark', 'night-mode');
        document.body.classList.remove('dark', 'dark-mode', 'theme-dark', 'night-mode');

        // 添加浅色主题标识
        document.documentElement.classList.add('light', 'light-mode', 'theme-light');
        document.body.classList.add('light');

        // 设置主题属性
        document.documentElement.removeAttribute('data-theme');
        document.body.removeAttribute('data-theme');
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.setAttribute('data-color-mode', 'light');
        document.documentElement.setAttribute('data-color-scheme', 'light');

        // === 阶段1.3：修改 color-scheme meta 标签 ===
        let colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
        if (colorSchemeMeta) {
          colorSchemeMeta.setAttribute('content', 'light');
        } else {
          colorSchemeMeta = document.createElement('meta');
          colorSchemeMeta.name = 'color-scheme';
          colorSchemeMeta.content = 'light';
          document.head.appendChild(colorSchemeMeta);
        }

        // 同时设置 theme-color meta（如果存在）
        let themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#ffffff');
        }

        // === 清理所有元素的深色主题类和属性 ===
        document.querySelectorAll('*').forEach((el) => {
          // 移除深色主题类
          el.classList.remove('dark', 'dark-mode', 'theme-dark', 'night-mode');

          // 移除深色主题属性
          if (el.hasAttribute('data-theme') && el.getAttribute('data-theme') === 'dark') {
            el.removeAttribute('data-theme');
          }
          if (el.hasAttribute('data-color-mode') && el.getAttribute('data-color-mode') === 'dark') {
            el.removeAttribute('data-color-mode');
          }
        });

        // 清理特定选择器中的深色标识
        document.querySelectorAll('[data-theme="dark"], .theme-dark').forEach((el) => {
          el.removeAttribute('data-theme');
          el.classList.remove('dark', 'dark-mode', 'theme-dark');
        });
      });
      this.logger.debug('已移除深色主题标记并强制设置浅色主题');
    } catch (error) {
      this.logger.warn('移除深色主题失败', { error: error.message });
    }
  }

  /**
   * 检测页面主题模式
   */
  async detectThemeMode(page) {
    try {
      const themeInfo = await page.evaluate(() => {
        // 检测多种主题模式指示器
        const checks = {
          // 检查HTML或body的主题类名
          htmlClass: document.documentElement.className,
          bodyClass: document.body.className,

          // 检查CSS变量
          cssVars: getComputedStyle(document.documentElement),

          // 检查特定的主题属性
          dataTheme:
            document.documentElement.getAttribute('data-theme') ||
            document.body.getAttribute('data-theme'),

          // 检查主要背景色
          bodyBgColor: getComputedStyle(document.body).backgroundColor,

          // 检查主要文字颜色
          bodyColor: getComputedStyle(document.body).color,

          // 检查是否有主题切换器
          themeToggle: !!document.querySelector(
            '[data-theme-toggle], .theme-toggle, .dark-mode-toggle'
          ),
        };

        return checks;
      });

      // 智能判断主题模式
      let detectedTheme = 'light';

      // 方法1: 检查类名
      const classList = `${themeInfo.htmlClass} ${themeInfo.bodyClass}`.toLowerCase();
      if (classList.includes('dark') || classList.includes('night')) {
        detectedTheme = 'dark';
      }

      // 方法2: 检查data-theme属性
      if (themeInfo.dataTheme) {
        if (themeInfo.dataTheme.toLowerCase().includes('dark')) {
          detectedTheme = 'dark';
        }
      }

      // 方法3: 检查背景色
      if (themeInfo.bodyBgColor) {
        const rgb = themeInfo.bodyBgColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const brightness = (parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2])) / 3;
          if (brightness < 128) {
            detectedTheme = 'dark';
          }
        }
      }

      this.logger.debug('检测到页面主题', {
        detected: detectedTheme,
        htmlClass: themeInfo.htmlClass,
        bodyClass: themeInfo.bodyClass,
        dataTheme: themeInfo.dataTheme,
        bgColor: themeInfo.bodyBgColor,
      });

      return detectedTheme;
    } catch (error) {
      this.logger.warn('主题检测失败，使用默认主题', { error: error.message });
      return 'light';
    }
  }

  /**
   * 获取最小干预的PDF优化CSS - 保留原始样式，仅解决关键问题
   */
  getPDFOptimizedCSS() {
    const fontSize = this.settings.fontSize || '14px';
    const codeFontSize = this.settings.codeFontSize || '13px';
    const lineHeight = this.settings.lineHeight || '1.5';
    const maxCodeLength = this.settings.maxCodeLineLength || 80;
    const fontFamily = this.settings.fontFamily || 'system-ui, -apple-system, sans-serif';
    const codeFont = this.settings.codeFont || 'Consolas, Monaco, monospace';

    // Kindle优化的特殊样式
    const kindleStyles = this.settings.kindleOptimized
      ? `
      /* === Kindle特定优化 === */
      body {
        font-size: ${fontSize} !important;
        line-height: ${lineHeight} !important;
        font-family: ${fontFamily} !important;
      }
      
      p, li, td, th {
        font-size: ${fontSize} !important;
        line-height: ${lineHeight} !important;
      }
      
      /* 优化代码块在小屏幕上的显示 */
      pre, code {
        font-size: ${codeFontSize} !important;
        font-family: ${codeFont} !important;
        max-width: ${maxCodeLength}ch !important;
      }
      
      /* 确保图片适应Kindle屏幕 */
      img {
        max-width: 100% !important;
        height: auto !important;
        page-break-inside: avoid !important;
      }
      
      /* 优化表格显示 */
      table {
        font-size: calc(${fontSize} * 0.9) !important;
        width: 100% !important;
        border-collapse: collapse !important;
      }
      
      /* 减少标题大小差异，提高一致性 */
      h1 { font-size: calc(${fontSize} * 1.5) !important; }
      h2 { font-size: calc(${fontSize} * 1.3) !important; }
      h3 { font-size: calc(${fontSize} * 1.15) !important; }
      h4, h5, h6 { font-size: ${fontSize} !important; }
    `
      : '';

    return `
      /* === 基础打印优化 - 保持原始样式基础 === */
      * {
        -webkit-print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      /* === 页面设置 - 适合Kindle等设备 === */
      @page {
        margin: 1.5cm;
        size: A4;
      }

      /* === 阶段2.1：强制浅色主题 CSS 变量覆盖 === */
      :root, html, body, [data-theme], [class*="theme"] {
        /* 通用颜色变量（所有可能的命名） */
        --bg: #ffffff !important;
        --bg-color: #ffffff !important;
        --background: #ffffff !important;
        --background-color: #ffffff !important;
        --body-bg: #ffffff !important;
        --page-bg: #ffffff !important;

        --text: #000000 !important;
        --text-color: #000000 !important;
        --foreground: #000000 !important;
        --color: #000000 !important;

        /* Next.js Nextra 主题常用变量 */
        --nextra-bg: #ffffff !important;
        --nextra-navbar-bg: #ffffff !important;
        --nextra-sidebar-bg: #f8fafc !important;
        --nextra-text: #000000 !important;
        --nextra-primary: #0070f3 !important;

        /* Tailwind CSS 变量 */
        --tw-bg-opacity: 1 !important;
        --tw-text-opacity: 1 !important;
        --tw-prose-body: #374151 !important;
        --tw-prose-headings: #111827 !important;

        /* Chakra UI 变量 */
        --chakra-colors-bg: #ffffff !important;
        --chakra-colors-text: #000000 !important;

        /* Mantine 变量 */
        --mantine-color-body: #ffffff !important;
        --mantine-color-text: #000000 !important;

        /* Docusaurus 变量 */
        --ifm-background-color: #ffffff !important;
        --ifm-font-color-base: #000000 !important;

        /* VuePress 变量 */
        --vp-c-bg: #ffffff !important;
        --vp-c-text-1: #213547 !important;

        /* 语义化颜色 */
        --primary-bg: #ffffff !important;
        --secondary-bg: #f8fafc !important;
        --muted: #6b7280 !important;
        --muted-foreground: #6b7280 !important;
        --border: #e5e7eb !important;
        --card-bg: #ffffff !important;
        --popover-bg: #ffffff !important;
      }

      /* === 阶段2.2：强制 body/html 基础颜色 === */
      html, body {
        background-color: #ffffff !important;
        color: #000000 !important;
        color-scheme: light !important;
      }

      /* 覆盖所有可能的深色容器 */
      *, *::before, *::after {
        border-color: #e5e7eb !important;
      }

      /* === 阶段2.3：覆盖系统深色模式偏好 === */
      @media (prefers-color-scheme: dark) {
        :root, html, body {
          background-color: #ffffff !important;
          color: #000000 !important;
          color-scheme: light !important;
        }

        /* 重置所有可能在 dark mode 下改变的元素 */
        * {
          color-scheme: light !important;
        }
      }

      /* === 仅在深色主题时强制转换为浅色 === */
      [data-theme="dark"], 
      .dark, 
      .dark-mode,
      .theme-dark,
      html[data-theme="dark"],
      body[data-theme="dark"] {
        background-color: #ffffff !important;
        color: #1f2937 !important;
      }

      /* === 核心代码换行修复 - 保持原始设计 === */
      pre, 
      pre[class*="language-"], 
      pre[class*="hljs"],
      .highlight,
      .code-block,
      .CodeMirror {
        /* 仅添加换行支持，不改变原始样式 */
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        overflow: visible !important;
        overflow-x: visible !important;
        
        /* 防止溢出，但保持原始宽度设计 */
        max-width: 100% !important;
        box-sizing: border-box !important;
        page-break-inside: avoid;
      }

      /* === 代码块内子元素 - 仅确保换行，不改变样式 === */
      pre *,
      pre[class*="language-"] *,
      pre[class*="hljs"] *,
      .highlight *,
      .code-block *,
      .CodeMirror * {
        /* 仅添加换行支持 */
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        overflow: visible !important;
        max-width: 100% !important;
      }

      /* === 内联代码换行 - 最小化改动 === */
      code {
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
      }

      /* === 深色主题代码块强制转换为浅色打印版本 === */
      [data-theme="dark"] pre,
      [data-theme="dark"] code,
      .dark pre,
      .dark code,
      .theme-dark pre,
      .theme-dark code {
        background-color: #f8fafc !important;
        color: #1e293b !important;
      }

      /* === 强制所有代码块及其子元素转为浅色 === */
      pre, pre *,
      code, code *,
      pre[class*="language-"], pre[class*="language-"] *,
      pre[class*="hljs"], pre[class*="hljs"] *,
      .highlight, .highlight *,
      .code-block, .code-block *,
      .CodeMirror, .CodeMirror * {
        background-color: #f8fafc !important;
        color: #1e293b !important;
      }

      /* === 语法高亮颜色重置为打印友好版本 === */
      .token.comment,
      .token.prolog,
      .token.doctype,
      .token.cdata {
        color: #6b7280 !important;
        font-style: italic !important;
      }

      .token.punctuation {
        color: #374151 !important;
      }

      .token.property,
      .token.tag,
      .token.boolean,
      .token.number,
      .token.constant,
      .token.symbol,
      .token.deleted {
        color: #dc2626 !important;
      }

      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted {
        color: #059669 !important;
      }

      .token.operator,
      .token.entity,
      .token.url,
      .language-css .token.string,
      .style .token.string {
        color: #0891b2 !important;
      }

      .token.atrule,
      .token.attr-value,
      .token.keyword {
        color: #7c3aed !important;
        font-weight: 600 !important;
      }

      .token.function,
      .token.class-name {
        color: #1d4ed8 !important;
        font-weight: 500 !important;
      }

      .token.regex,
      .token.important,
      .token.variable {
        color: #d97706 !important;
      }

      /* === 基础分页控制 === */
      h1, h2, h3, h4, h5, h6 {
        page-break-after: avoid;
      }

      pre, blockquote, table {
        page-break-inside: avoid;
      }

      /* === 隐藏纯UI元素 === */
      button:not(.copy-button),
      input[type="button"],
      input[type="submit"],
      .theme-toggle,
      [data-theme-toggle],
      .dark-mode-toggle,
      .sidebar-toggle,
      .mobile-menu {
        display: none !important;
      }

      /* === 全局隐藏站点级导航/侧栏/目录/面包屑（不依赖内容区结构）=== */
      nav,
      [role="navigation"],
      aside,
      [role="complementary"],
      /* 侧栏与目录区域（常见命名） */
      [id*="sidebar"],
      [class*="sidebar"],
      [data-sidebar],
      .table-of-contents,
      .toc,
      #on-this-page,
      .on-this-page,
      [aria-label="On this page"],
      /* 面包屑与分页 */
      [data-testid="breadcrumb"],
      [aria-label="breadcrumb"],
      .breadcrumbs,
      #pagination,
      .pagination,
      /* 复制整页等与阅读无关控件 */
      .copy-page,
      [data-action="copy-page"],
      /* 聊天助手/悬浮输入框 */
      .chat-assistant-floating-input,
      .chat-assistant-send-button,
      #assistant-bar-placeholder,
      [class*="chat-assistant"],
      [class*="floating-input"],
      [id*="assistant-bar"] {
        display: none !important;
      }

      /* === 强制显示折叠内容 === */
      details,
      details[open] {
        display: block !important;
      }

      /* 保留 summary 标题文本，但移除交互性 */
      details > summary {
        display: block !important;
        cursor: default !important;
        list-style: none !important;
        pointer-events: none !important;
        margin-bottom: 0.5em !important;
        font-weight: 600 !important;
        font-size: 1.1em !important;
      }

      /* 隐藏 webkit details 标记（箭头/折叠符号） */
      details > summary::-webkit-details-marker {
        display: none !important;
      }

      /* 隐藏自定义折叠图标 */
      details > summary [data-component-part*="caret"],
      details > summary [data-component-part*="arrow"],
      details > summary svg {
        display: none !important;
      }

      /* 移除悬停效果 */
      details > summary:hover {
        background: none !important;
      }

      details > *:not(summary),
      details[open] > *:not(summary) {
        display: block !important;
        visibility: visible !important;
      }

      /* 强制显示 aria-expanded 控制的内容 */
      [role="region"],
      [aria-expanded="true"] + [role="region"] {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* === 标签页内容全部显示 === */
      [role="tabpanel"],
      .tab-content > .tab-pane {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }

      ${kindleStyles}
      
      /* === Kindle优化 - 改善阅读体验 === */
      @media print {
        /* 确保在小屏设备上代码能正确换行 */
        pre, code, 
        pre *, code *,
        [class*="language-"], [class*="hljs"], [class*="highlight"] {
          white-space: pre-wrap !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          overflow: visible !important;
          max-width: 100% !important;
        }
        
        /* 图片适配 */
        img {
          max-width: 100% !important;
          height: auto !important;
        }
        
        /* 表格适配 */
        table {
          width: 100% !important;
          font-size: 0.9em !important;
        }
      }
    `;
  }

  /**
   * 应用最简化的PDF样式到页面
   */
  async applyPDFStyles(page, contentSelector) {
    try {
      this.logger.info('应用最简化PDF样式', { contentSelector });

      // 只做最基础的内容提取和样式优化
      const evaluateResult = await page.evaluate(
        (selector, css, removeSelectors) => {
          // 提取内容
          const contentElement = document.querySelector(selector);
          if (!contentElement) {
            throw new Error(`内容选择器未找到: ${selector}`);
          }

          const invalid = [];
          let removed = 0;

          // 移除交互和导航元素（在内容区域内执行，避免全站影响）
          const elementsToRemove = [
            'script',
            'noscript',
            // 交互类
            'button',
            'input',
            'textarea',
            'select',
            // 站点导航/侧栏/目录/面包屑/分页
            'nav',
            'aside',
            '[role="navigation"]',
            '[role="complementary"]',
            '[id*="sidebar"]',
            '[class*="sidebar"]',
            '.table-of-contents',
            '.toc',
            '#on-this-page',
            '.on-this-page',
            '[aria-label="On this page"]',
            '#pagination',
            '.pagination',
            '[data-testid="breadcrumb"]',
            '.breadcrumbs',
            '[aria-label="breadcrumb"]',
            // 视觉干扰或无关控件
            '.theme-toggle',
            '.dark-mode-toggle',
            '[data-theme-toggle]',
            '.copy-page',
            '[data-action="copy-page"]',
            '.page-copy-action',
            '[data-page-copy-action]',
            '[data-codex-screenshot-overlay]',
          ];

          // 添加配置的移除选择器
          if (Array.isArray(removeSelectors)) {
            elementsToRemove.push(...removeSelectors);
          }

          elementsToRemove.forEach((sel) => {
            let found;
            try {
              found = contentElement.querySelectorAll(sel);
            } catch {
              invalid.push(sel);
              return;
            }
            removed += found.length;
            found.forEach((el) => el.remove());
          });

          // 强制移除深色主题类和属性
          document.documentElement.classList.remove('dark', 'dark-mode', 'theme-dark');
          document.body.classList.remove('dark', 'dark-mode', 'theme-dark');
          document.documentElement.removeAttribute('data-theme');
          document.body.removeAttribute('data-theme');
          document.documentElement.setAttribute('data-theme', 'light');

          // 移除所有元素的深色主题相关类和属性
          document.querySelectorAll('*').forEach((el) => {
            el.classList.remove('dark', 'dark-mode', 'theme-dark');
            if (el.hasAttribute('data-theme')) {
              el.removeAttribute('data-theme');
            }
          });

          // === 最小干预：仅添加换行支持，保留原始样式 ===
          const codeElements = contentElement.querySelectorAll(`
          pre, 
          pre[class*="language-"],
          pre[class*="hljs"],
          .highlight,
          .code-block,
          .CodeMirror
        `);

          codeElements.forEach((el) => {
            // 添加换行支持和强制浅色样式
            el.style.setProperty('white-space', 'pre-wrap', 'important');
            el.style.setProperty('word-wrap', 'break-word', 'important');
            el.style.setProperty('overflow-wrap', 'break-word', 'important');
            el.style.setProperty('overflow', 'visible', 'important');
            el.style.setProperty('overflow-x', 'visible', 'important');
            el.style.setProperty('max-width', '100%', 'important');
            el.style.setProperty('box-sizing', 'border-box', 'important');

            // 强制设置浅色背景和深色文本
            el.style.setProperty('background-color', '#f8fafc', 'important');
            el.style.setProperty('color', '#1e293b', 'important');
          });

          // === 确保代码块内元素也支持换行 ===
          const codeChildren = contentElement.querySelectorAll(`
          pre *, 
          pre[class*="language-"] *,
          pre[class*="hljs"] *,
          .highlight *,
          .code-block *,
          .CodeMirror *
        `);

          codeChildren.forEach((el) => {
            // 添加换行支持并确保文本可见
            el.style.setProperty('white-space', 'pre-wrap', 'important');
            el.style.setProperty('word-wrap', 'break-word', 'important');
            el.style.setProperty('overflow-wrap', 'break-word', 'important');
            el.style.setProperty('overflow', 'visible', 'important');
            el.style.setProperty('max-width', '100%', 'important');

            // 确保所有代码子元素都有适当的颜色对比度
            const computedColor = window.getComputedStyle(el).color;
            const computedBg = window.getComputedStyle(el).backgroundColor;

            // 检查是否是白色或接近白色的文本
            if (
              computedColor &&
              (computedColor.includes('rgb(255, 255, 255)') ||
                computedColor.includes('#fff') ||
                computedColor.includes('#ffffff') ||
                computedColor.includes('white'))
            ) {
              el.style.setProperty('color', '#1e293b', 'important');
            }

            // 检查是否是深色背景
            if (
              computedBg &&
              (computedBg.includes('rgb(0, 0, 0)') ||
                computedBg.includes('#000') ||
                computedBg.includes('#111') ||
                computedBg.includes('#222') ||
                computedBg.includes('#333'))
            ) {
              el.style.setProperty('background-color', 'transparent', 'important');
            }
          });

          // 替换body内容为提炼后的主要内容
          document.body.innerHTML = contentElement.outerHTML;

          // 强制移除内容中的深色主题
          document
            .querySelectorAll('[data-theme="dark"], [class*="dark"], .theme-dark')
            .forEach((el) => {
              el.removeAttribute('data-theme');
              el.classList.remove('dark', 'dark-mode', 'theme-dark');
            });

          // === 阶段3：强制设置所有元素为浅色（全局颜色检测和转换）===
          // 强制设置 body 和根元素的颜色
          document.body.style.setProperty('background-color', '#ffffff', 'important');
          document.body.style.setProperty('color', '#000000', 'important');
          document.documentElement.style.setProperty('background-color', '#ffffff', 'important');
          document.documentElement.style.setProperty('color', '#000000', 'important');

          // 处理所有可能的深色容器
          const allElements = document.querySelectorAll('*');

          allElements.forEach((el) => {
            const computedStyle = window.getComputedStyle(el);
            const bgColor = computedStyle.backgroundColor;
            const textColor = computedStyle.color;

            // 检测深色背景并强制转换为白色
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
              const rgbMatch = bgColor.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
              if (rgbMatch) {
                const r = parseInt(rgbMatch[1]);
                const g = parseInt(rgbMatch[2]);
                const b = parseInt(rgbMatch[3]);

                // 如果背景色的RGB值都小于50（很深的颜色）
                if (r < 50 && g < 50 && b < 50) {
                  el.style.setProperty('background-color', '#ffffff', 'important');
                }
              }
            }

            // 检测浅色文本（在深色背景上的白色文本）并转换为深色
            if (textColor) {
              const rgbMatch = textColor.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
              if (rgbMatch) {
                const r = parseInt(rgbMatch[1]);
                const g = parseInt(rgbMatch[2]);
                const b = parseInt(rgbMatch[3]);

                // 如果文本颜色的RGB值都大于200（很浅的颜色，如白色）
                if (r > 200 && g > 200 && b > 200) {
                  el.style.setProperty('color', '#000000', 'important');
                }
              }
            }
          });

          // 只添加最基础的PDF打印优化样式
          const existingStyle = document.querySelector('#pdf-style');
          if (existingStyle) {
            existingStyle.remove();
          }

          const style = document.createElement('style');
          style.id = 'pdf-style';
          style.textContent = css;
          document.head.appendChild(style);

          return { removedCount: removed, invalidSelectors: invalid };
        },
        contentSelector,
        this.getPDFOptimizedCSS(),
        this.settings.removeSelectors
      );

      const removedCount =
        typeof evaluateResult?.removedCount === 'number' ? evaluateResult.removedCount : 0;
      const invalidSelectors = Array.isArray(evaluateResult?.invalidSelectors)
        ? evaluateResult.invalidSelectors
        : [];

      if (invalidSelectors.length > 0) {
        this.logger.warn('removeSelectors 包含无效 CSS selector，已跳过', {
          invalidSelectors,
        });
      }

      this.logger.debug('PDF样式处理 DOM 清理统计', { removedCount });

      this.logger.debug('PDF样式应用完成');
      return { success: true };
    } catch (error) {
      this.logger.error('PDF样式应用失败', {
        error: error.message,
        contentSelector,
      });
      throw error;
    }
  }

  /**
   * 获取优化的PDF生成选项 - 针对Kindle等设备优化
   */
  getPDFOptions() {
    // 基础选项
    let options = {
      format: this.settings.format || 'A4',
      printBackground: true,
      preferCSSPageSize: this.settings.preferCSSPageSize || false,
      displayHeaderFooter: false,
      scale: 1,
      tagged: this.settings.tagged || false,
    };

    // 处理页边距
    if (this.settings.margin) {
      if (typeof this.settings.margin === 'string') {
        // 预设页边距
        const marginPresets = {
          narrow: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
          normal: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
          wide: { top: '1.5in', right: '1.5in', bottom: '1.5in', left: '1.5in' },
        };
        options.margin = marginPresets[this.settings.margin] || marginPresets.normal;
      } else {
        options.margin = this.settings.margin;
      }
    } else {
      options.margin = {
        top: '1.5cm',
        right: '1.5cm',
        bottom: '1.5cm',
        left: '1.5cm',
      };
    }

    // Kindle优化
    if (this.settings.kindleOptimized) {
      options = {
        ...options,
        format: this.settings.pageFormat || this.settings.format || 'Letter',
        tagged: true, // 提高可访问性
        preferCSSPageSize: true,
        // 针对Kindle的特殊设置
        ...(this.settings.deviceProfile === 'kindle7'
          ? {
              scale: 0.95, // 稍微缩小以适应7英寸屏幕
            }
          : {}),
      };

      this.logger.debug('应用Kindle优化的PDF选项', {
        deviceProfile: this.settings.deviceProfile,
        format: options.format,
        margin: options.margin,
      });
    }

    return options;
  }

  /**
   * 处理特殊内容类型
   */
  async processSpecialContent(page) {
    try {
      const stats = await page.evaluate(() => {
        let expandedElementsCount = 0;
        let ariaExpandedCount = 0;
        let hiddenContentCount = 0;

        // 将隐藏处理限定在主要内容区域，避免误展示全屏遮罩/弹窗
        const contentRoot = document.querySelector('main, article, [role="main"], .main-content');
        const shouldSkipHidden = (el) => {
          // 跳过模态、对话框、全屏遮罩和全局浮层
          if (
            el.closest(
              '[role="dialog"], [aria-modal="true"], .modal, .overlay, [data-overlay], [class*="overlay"], [class*="modal"]'
            )
          ) {
            return true;
          }
          // 跳过导航/目录容器，避免错误地显示侧边栏目录
          if (
            el.closest(
              'nav, aside, [role="navigation"], .table-of-contents, .toc, #on-this-page, .on-this-page'
            )
          ) {
            return true;
          }
          // 若能定位到主要内容，只处理其内部节点
          if (contentRoot && !contentRoot.contains(el)) {
            return true;
          }
          return false;
        };

        // 处理Mermaid图表
        document.querySelectorAll('.mermaid').forEach((el) => {
          if (el.querySelector('svg')) {
            el.style.overflow = 'visible';
            el.style.maxWidth = '100%';
          }
        });

        // 处理代码高亮
        document.querySelectorAll('[class*="highlight"], [class*="hljs"]').forEach((el) => {
          el.style.overflow = 'visible';
          el.style.whiteSpace = 'pre-wrap';
        });

        // 1. 处理标准 <details> 元素
        document.querySelectorAll('details').forEach((details) => {
          details.open = true;
          expandedElementsCount++;

          // 同步 aria-expanded 属性
          const summary = details.querySelector('summary[aria-expanded]');
          if (summary) {
            summary.setAttribute('aria-expanded', 'true');
          }

          // 强制显示内容容器
          const content = details.querySelector('[role="region"]');
          if (content) {
            content.style.setProperty('display', 'block', 'important');
            content.style.setProperty('visibility', 'visible', 'important');
            content.style.setProperty('opacity', '1', 'important');
          }
        });

        // 2. 处理 aria-expanded 控制的折叠元素（OpenAI 等网站）
        document.querySelectorAll('[aria-expanded="false"]').forEach((trigger) => {
          // 设置为展开状态
          trigger.setAttribute('aria-expanded', 'true');
          ariaExpandedCount++;

          // 查找关联的内容容器
          // 方法 1: 检查 aria-controls 属性
          const controlsId = trigger.getAttribute('aria-controls');
          if (controlsId) {
            const content = document.getElementById(controlsId);
            if (content) {
              content.style.setProperty('display', 'block', 'important');
              content.style.setProperty('visibility', 'visible', 'important');
              content.style.setProperty('opacity', '1', 'important');
              content.style.setProperty('height', 'auto', 'important');
              content.classList.remove('hidden', 'collapsed');
            }
          }

          // 方法 2: 检查下一个兄弟元素（常见模式）
          const nextSibling = trigger.nextElementSibling;
          if (nextSibling) {
            // 移除可能的隐藏类
            nextSibling.classList.remove('hidden', 'collapsed', 'collapse');

            // 强制显示
            nextSibling.style.setProperty('display', 'block', 'important');
            nextSibling.style.setProperty('visibility', 'visible', 'important');
            nextSibling.style.setProperty('opacity', '1', 'important');
            nextSibling.style.setProperty('height', 'auto', 'important');
            nextSibling.style.setProperty('max-height', 'none', 'important');
          }

          // 方法 3: 检查父元素的子元素（用于某些嵌套结构）
          const parent = trigger.parentElement;
          if (parent) {
            const contentSibling = parent.querySelector(
              '.expn-content, [class*="content"], [class*="body"]'
            );
            if (contentSibling && contentSibling !== trigger) {
              contentSibling.classList.remove('hidden', 'collapsed');
              contentSibling.style.setProperty('display', 'block', 'important');
              contentSibling.style.setProperty('visibility', 'visible', 'important');
              contentSibling.style.setProperty('opacity', '1', 'important');
              contentSibling.style.setProperty('height', 'auto', 'important');
            }
          }
        });

        // 3. 强制显示主要内容区域中带有 hidden 类的内容
        document.querySelectorAll('.hidden, .collapsed, [hidden]').forEach((el) => {
          if (shouldSkipHidden(el)) {
            return;
          }

          // 跳过代码块切换器（语言选择器）
          if (el.classList.contains('code-block')) {
            return;
          }

          // 移除隐藏类和属性
          el.classList.remove('hidden', 'collapsed');
          el.removeAttribute('hidden');

          // 强制显示
          el.style.setProperty('display', 'block', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('max-height', 'none', 'important');

          hiddenContentCount++;
        });

        // 4. 处理折叠面板（accordion）
        document.querySelectorAll('.accordion-item, [class*="accordion"]').forEach((item) => {
          const content = item.querySelector('.accordion-content, [class*="content"]');
          if (content) {
            content.style.setProperty('display', 'block', 'important');
            content.style.setProperty('visibility', 'visible', 'important');
            content.style.setProperty('max-height', 'none', 'important');
          }
        });

        // 5. 处理标签页内容（显示所有 tab panels）
        document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
          panel.style.setProperty('display', 'block', 'important');
          panel.style.setProperty('visibility', 'visible', 'important');
          panel.setAttribute('aria-hidden', 'false');
        });

        // 6. 隐藏侧边目录和浮动页操作按钮（PDF不需要）
        const selectorsToHide = [
          'astro-island[component-url*="TableOfContents"]',
          '.table-of-contents, .toc, #on-this-page, .on-this-page',
          'nav[data-hk], nav[data-component="TableOfContents"]',
          'astro-island[component-url*="PageActions"]',
          '[data-page-actions]',
          '.copy-page, [data-action="copy-page"]',
          '.page-copy-action, [data-page-copy-action]',
          '[data-anchor-id]',
          '[data-codex-screenshot-overlay]',
        ];
        selectorsToHide.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
          });
        });

        // 7. 重新构建打印内容，避免只捕获首屏（优先包含整段正文与标题区域）
        const targetContainer =
          document.querySelector('#track-content')?.closest('.space-y-12') ||
          document.querySelector('main .space-y-12') ||
          document.querySelector('#track-content') ||
          document.querySelector('main') ||
          document.body;

        if (targetContainer && targetContainer !== document.body) {
          const cloned = targetContainer.cloneNode(true);
          document.body.innerHTML = '';
          document.body.appendChild(cloned);

          // 确保 html/body 不限制高度，允许多页打印
          [document.documentElement, document.body].forEach((el) => {
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('overflow', 'visible', 'important');
          });

          window.scrollTo(0, 0);
        }

        return {
          detailsExpanded: expandedElementsCount,
          ariaExpandedFixed: ariaExpandedCount,
          hiddenContentRevealed: hiddenContentCount,
        };
      });

      this.logger.info('特殊内容处理完成', stats);
    } catch (error) {
      this.logger.warn('特殊内容处理失败', { error: error.message });
    }
  }
}
