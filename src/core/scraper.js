/**
 * 核心爬虫类 - 修复PDF文件命名使用数字索引
 */

import path from 'path';
import { EventEmitter } from 'events';
import { normalizeUrl, getUrlHash } from '../utils/url.js';
import { NetworkError, ValidationError } from '../utils/errors.js';
import { retry, delay } from '../utils/common.js';

export class Scraper extends EventEmitter {
  constructor(dependencies) {
    super();

    // 依赖注入 - 集成所有服务
    this.config = dependencies.config;
    this.logger = dependencies.logger;
    this.browserPool = dependencies.browserPool;
    this.pageManager = dependencies.pageManager;
    this.fileService = dependencies.fileService;
    this.pathService = dependencies.pathService;
    this.metadataService = dependencies.metadataService;
    this.stateManager = dependencies.stateManager;
    this.progressTracker = dependencies.progressTracker;
    this.queueManager = dependencies.queueManager;
    this.imageService = dependencies.imageService;
    this.pdfStyleService = dependencies.pdfStyleService;
    this.translationService = dependencies.translationService;
    this.markdownService = dependencies.markdownService;
    this.markdownToPdfService = dependencies.markdownToPdfService;

    // 内部状态
    this.urlQueue = [];
    this.urlSet = new Set();
    this.isInitialized = false;
    this.isRunning = false;
    this.startTime = null;

    this.logger.info('Scraper constructor called', {
      hasTranslationService: !!this.translationService,
    });

    // 绑定事件处理
    this._bindEvents();
  }

  /**
   * 绑定事件处理器
   */
  _bindEvents() {
    // 监听状态管理器事件
    this.stateManager.on('stateLoaded', (state) => {
      this.logger.info('爬虫状态已加载', {
        processedCount: state.processedUrls.size,
        failedCount: state.failedUrls.size,
      });
    });

    // 监听进度追踪器事件
    this.progressTracker.on('progress', (stats) => {
      this.emit('progress', stats);
    });

    // 监听队列管理器事件
    this.queueManager.on('taskCompleted', (task) => {
      this.logger.debug('任务完成', { url: task.url });
    });

    this.queueManager.on('taskFailed', (task, error) => {
      this.logger.warn('任务失败', { url: task.url, error: error.message });
    });
  }

  /**
   * 初始化爬虫
   */
  async initialize() {
    if (this.isInitialized) {
      this.logger.warn('爬虫已经初始化');
      return;
    }

    try {
      this.logger.info('开始初始化爬虫...');

      // 初始化浏览器池（如果还没有初始化）
      if (!this.browserPool.isInitialized) {
        await this.browserPool.initialize();
      }

      // 加载状态（如果还没有加载）
      if (this.stateManager && typeof this.stateManager.load === 'function') {
        await this.stateManager.load();
      }

      // 配置队列管理器
      this.queueManager.setConcurrency(this.config.concurrency || 3);

      // 确保输出目录存在
      await this.fileService.ensureDirectory(this.config.pdfDir);

      // 确保元数据目录存在
      const metadataDir = path.join(this.config.pdfDir, 'metadata');
      await this.fileService.ensureDirectory(metadataDir);

      this.isInitialized = true;
      this.logger.info('爬虫初始化完成');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('爬虫初始化失败', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * 收集URL
   */
  async collectUrls() {
    if (!this.isInitialized) {
      throw new ValidationError('爬虫尚未初始化');
    }

    this.logger.debug('Checking targetUrls', { targetUrls: this.config.targetUrls });

    // 1. 优先检查 targetUrls 配置 (Explicit URLs mode)
    if (
      this.config.targetUrls &&
      Array.isArray(this.config.targetUrls) &&
      this.config.targetUrls.length > 0
    ) {
      this.logger.info('使用配置中的目标URL列表', { count: this.config.targetUrls.length });

      const sectionInfo = {
        index: 0,
        title: 'Custom Selection',
        entryUrl: this.config.rootURL,
        urls: this.config.targetUrls,
      };

      return this._processCollectedUrls([sectionInfo]);
    }

    const entryPoints = this._getEntryPoints();
    this.logger.info('开始收集URL', { entryPoints });

    let page = null;
    try {
      // 创建页面
      page = await this.pageManager.createPage('url-collector');

      // 收集section信息（逐入口页面，保证使用各自侧边栏的顺序）
      const sections = [];
      const urlToSectionMap = new Map(); // URL -> section index
      const rawUrls = [];

      for (let sectionIndex = 0; sectionIndex < entryPoints.length; sectionIndex++) {
        const entryUrl = entryPoints[sectionIndex];

        try {
          // 提取section标题
          const sectionTitle = await this._extractSectionTitle(page, entryUrl);

          // 收集该入口页面侧边栏的URLs（入口点列表在此处统一计算，避免重复日志与计算）
          const entryUrls = await this._collectUrlsFromEntryPoint(page, entryUrl, entryPoints);

          // 记录section信息
          const sectionInfo = {
            index: sectionIndex,
            title: sectionTitle,
            entryUrl: entryUrl,
            pages: [],
          };

          // 记录该section的所有URL及其顺序
          entryUrls.forEach((url, orderInSection) => {
            const startIndex = rawUrls.length;
            rawUrls.push(url);

            // 建立URL到section的映射
            urlToSectionMap.set(url, {
              sectionIndex,
              orderInSection,
              rawIndex: startIndex,
            });
          });

          sections.push(sectionInfo);

          this.logger.info(`Section ${sectionIndex + 1}/${entryPoints.length} 收集完成`, {
            title: sectionTitle,
            entryUrl,
            urlCount: entryUrls.length,
          });
        } catch (entryError) {
          this.logger.error('入口URL收集失败，将跳过该入口', {
            entryUrl,
            error: entryError.message,
          });

          // 即使失败也添加一个空section占位
          sections.push({
            index: sectionIndex,
            title: `Section ${sectionIndex + 1}`,
            entryUrl: entryUrl,
            pages: [],
          });
        }
      }
      this.logger.info(`提取到 ${rawUrls.length} 个原始URL，分属 ${sections.length} 个section`, {
        entryPointCount: entryPoints.length,
      });

      return this._processCollectedUrls(sections, urlToSectionMap, rawUrls);
    } catch (error) {
      this.logger.error('URL收集失败', {
        error: error.message,
        stack: error.stack,
      });
      throw new NetworkError('URL收集失败', this.config.rootURL, error);
    } finally {
      if (page) {
        // 🔧 修复：在关闭页面前清理图片服务
        try {
          await this.imageService.cleanupPage(page);
        } catch (cleanupError) {
          this.logger?.debug('URL收集页面的图片服务清理失败（非致命错误）', {
            error: cleanupError.message,
          });
        }
        await this.pageManager.closePage('url-collector');
      }
    }
  }

  /**
   * 处理收集到的URL（去重、规范化、构建Section结构）
   */
  async _processCollectedUrls(sections, preCalculatedMap = null, preCalculatedRawUrls = null) {
    // 如果是直接传入 sections (targetUrls 模式)，需要构建 map 和 rawUrls
    let urlToSectionMap = preCalculatedMap;
    let rawUrls = preCalculatedRawUrls;

    if (!urlToSectionMap || !rawUrls) {
      urlToSectionMap = new Map();
      rawUrls = [];

      sections.forEach((section) => {
        if (section.urls) {
          section.urls.forEach((url, order) => {
            rawUrls.push(url);
            urlToSectionMap.set(url, {
              sectionIndex: section.index,
              orderInSection: order,
            });
          });
          // 清理临时 urls 字段
          delete section.urls;
          section.pages = [];
        }
      });
    }

    // URL去重和规范化
    const normalizedUrls = new Map();
    const duplicates = new Set();
    const sectionConflicts = []; // 🔥 新增：记录section冲突

    rawUrls.forEach((url, index) => {
      try {
        const normalized = normalizeUrl(url);
        const hash = getUrlHash(normalized);

        if (normalizedUrls.has(hash)) {
          duplicates.add(url);

          // 🔥 日志增强：检测section冲突
          const existing = normalizedUrls.get(hash);
          const currentMapping = urlToSectionMap.get(url);

          if (
            existing.sectionIndex !== currentMapping?.sectionIndex &&
            existing.sectionIndex !== undefined &&
            currentMapping?.sectionIndex !== undefined
          ) {
            sectionConflicts.push({
              url: normalized,
              existingSection: sections[existing.sectionIndex]?.title || existing.sectionIndex,
              conflictSection:
                sections[currentMapping.sectionIndex]?.title || currentMapping.sectionIndex,
            });
          }
          return;
        }

        if (!this.isIgnored(normalized) && this.validateUrl(normalized)) {
          // 保留section映射信息
          const sectionMapping = urlToSectionMap.get(url);

          normalizedUrls.set(hash, {
            original: url,
            normalized: normalized,
            index: index,
            sectionIndex: sectionMapping?.sectionIndex,
            orderInSection: sectionMapping?.orderInSection,
          });
        }
      } catch (error) {
        this.logger.warn('URL规范化失败', { url, error: error.message });
      }
    });

    // 🔥 日志增强：报告section冲突
    if (sectionConflicts.length > 0) {
      this.logger.warn('检测到URL在多个section中重复', {
        conflictCount: sectionConflicts.length,
        examples: sectionConflicts.slice(0, 3),
      });

      if (sectionConflicts.length <= 5) {
        this.logger.debug('所有section冲突:', { conflicts: sectionConflicts });
      }
    }

    // 构建最终URL队列
    this.urlQueue = Array.from(normalizedUrls.values()).map((item) => item.normalized);
    this.urlQueue.forEach((url) => this.urlSet.add(url));

    // 🔥 新增：构建section结构并填充pages信息
    const urlIndexMap = new Map(); // normalized URL -> final index
    Array.from(normalizedUrls.values()).forEach((item, finalIndex) => {
      urlIndexMap.set(item.normalized, finalIndex);

      // 将URL添加到对应的section
      if (item.sectionIndex !== undefined) {
        const section = sections[item.sectionIndex];
        if (section) {
          section.pages.push({
            index: String(finalIndex), // 转为字符串以匹配articleTitles的键格式
            url: item.normalized,
            order: item.orderInSection,
          });
        }
      }
    });

    // 按order排序每个section的pages
    sections.forEach((section) => {
      section.pages.sort((a, b) => a.order - b.order);
    });

    // 构建urlToSection快速查找映射
    const urlToSection = {};
    sections.forEach((section) => {
      section.pages.forEach((page) => {
        urlToSection[page.url] = section.index;
      });
    });

    // 🔥 新增：保存section结构到元数据
    const sectionStructure = {
      sections,
      urlToSection,
    };

    // 保存到元数据服务
    await this.metadataService.saveSectionStructure(sectionStructure);

    // 🔥 日志增强：详细的section统计信息
    this.logger.info('Section结构已保存', {
      sectionCount: sections.length,
      totalPages: Object.keys(urlToSection).length,
    });

    // 输出每个section的详细统计
    sections.forEach((section, idx) => {
      this.logger.debug(`Section ${idx + 1}/${sections.length}: "${section.title}"`, {
        entryUrl: section.entryUrl,
        pageCount: section.pages.length,
        firstPage: section.pages[0]?.url,
        lastPage: section.pages[section.pages.length - 1]?.url,
      });
    });

    // 检测空section
    const emptySections = sections.filter((s) => s.pages.length === 0);
    if (emptySections.length > 0) {
      this.logger.warn('检测到空section（没有页面）', {
        emptyCount: emptySections.length,
        titles: emptySections.map((s) => s.title),
      });
    }

    // 记录统计信息
    this.logger.info('URL收集完成', {
      原始数量: rawUrls.length,
      去重后数量: this.urlQueue.length,
      重复数量: duplicates.size,
      被忽略数量: rawUrls.length - this.urlQueue.length - duplicates.size,
      section数量: sections.length,
    });

    // 触发事件，便于外部监听URL收集结果
    this.emit('urlsCollected', {
      totalUrls: this.urlQueue.length,
      duplicates: duplicates.size,
      sections: sections.length,
    });

    return this.urlQueue;
  }

  /**
   * 根据配置构建入口URL列表
   * @returns {string[]} 入口URL数组
   */
  _getEntryPoints() {
    const entryPoints = [this.config.rootURL];

    if (Array.isArray(this.config.sectionEntryPoints)) {
      this.config.sectionEntryPoints.forEach((url) => {
        if (typeof url === 'string' && url.trim()) {
          entryPoints.push(url.trim());
        }
      });
    }

    // 🔥 日志增强：检测并警告重复的entry points
    const originalLength = entryPoints.length;
    const deduplicated = Array.from(new Set(entryPoints));

    if (deduplicated.length < originalLength) {
      const duplicateCount = originalLength - deduplicated.length;
      this.logger.warn('检测到重复的entry points', {
        original: originalLength,
        deduplicated: deduplicated.length,
        duplicates: duplicateCount,
        hint: 'rootURL可能与sectionEntryPoints中的某个URL重复',
      });

      // 找出具体的重复项
      const seen = new Set();
      const duplicates = [];
      entryPoints.forEach((url) => {
        if (seen.has(url)) {
          duplicates.push(url);
        } else {
          seen.add(url);
        }
      });

      if (duplicates.length > 0) {
        this.logger.debug('重复的entry point URLs:', { duplicates });
      }
    }

    return deduplicated;
  }

  _normalizeUrlForEntryPointComparison(url) {
    try {
      const urlObj = new URL(url);
      urlObj.pathname = urlObj.pathname.replace(/\/$/, '');
      urlObj.search = '';
      urlObj.hash = '';
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * 从导航菜单中提取section标题
   * @param {import('puppeteer').Page} page
   * @param {string} entryUrl - Section entry URL
   * @returns {Promise<string|null>}
   */
  async _extractSectionTitle(page, entryUrl) {
    try {
      // 1. 优先使用配置中的手动映射
      if (this.config.sectionTitles && this.config.sectionTitles[entryUrl]) {
        this.logger.debug(`使用配置的section标题: ${this.config.sectionTitles[entryUrl]}`, {
          entryUrl,
        });
        return this.config.sectionTitles[entryUrl];
      }

      // 2. 从导航菜单中提取标题
      const title = await page.evaluate(
        (targetUrl, navSelector) => {
          try {
            // 规范化URL以便比较
            const normalizeUrl = (url) => {
              try {
                const parsed = new URL(url, window.location.href);
                return parsed.href.replace(/\/$/, ''); // 移除尾部斜杠
              } catch {
                return url;
              }
            };

            const normalizedTarget = normalizeUrl(targetUrl);

            // 查找所有导航链接
            const navLinks = document.querySelectorAll(navSelector);

            // 🔥 改进：使用更严格的URL匹配逻辑
            let bestMatch = null;
            let bestMatchScore = -1;

            for (const link of navLinks) {
              const href = link.href || link.getAttribute('href');
              if (!href) continue;

              const normalizedHref = normalizeUrl(href);

              // 计算匹配得分
              let score = 0;

              // 1. 精确匹配：最高优先级
              if (normalizedHref === normalizedTarget) {
                score = 1000;
              }
              // 2. 路径深度相同的前缀匹配：次高优先级
              else {
                try {
                  const targetPath = new URL(normalizedTarget).pathname;
                  const hrefPath = new URL(normalizedHref).pathname;

                  const targetDepth = targetPath.split('/').filter(Boolean).length;
                  const hrefDepth = hrefPath.split('/').filter(Boolean).length;

                  // 只匹配相同深度且完全相等的路径（避免误匹配相似前缀，如 overview vs overview-advanced）
                  if (targetDepth === hrefDepth && targetPath === hrefPath) {
                    score = 500;
                  }
                  // 允许href比target短1级（用于section入口）
                  else if (targetDepth === hrefDepth + 1 && targetPath.startsWith(hrefPath + '/')) {
                    score = 300;
                  }
                } catch {
                  // URL解析失败，跳过
                  continue;
                }
              }

              // 如果匹配分数更高，更新最佳匹配
              if (score > bestMatchScore) {
                const text = link.textContent?.trim();

                // 如果链接本身没有文本，尝试找最近的父节点标题
                let finalText = text;
                if (!finalText || finalText.length < 2) {
                  let parent = link.parentElement;
                  let attempts = 0;
                  while (parent && attempts < 3) {
                    const heading = parent.querySelector(
                      'h1, h2, h3, h4, h5, h6, [role="heading"]'
                    );
                    if (heading) {
                      finalText = heading.textContent?.trim();
                      break;
                    }
                    parent = parent.parentElement;
                    attempts++;
                  }
                }

                if (finalText && finalText.length >= 2) {
                  bestMatch = finalText;
                  bestMatchScore = score;

                  // 如果找到精确匹配，立即返回
                  if (score === 1000) {
                    return bestMatch;
                  }
                }
              }
            }

            // 返回最佳匹配
            if (bestMatch) {
              return bestMatch;
            }

            // 如果导航中没找到，尝试从页面主标题提取
            const mainHeading = document.querySelector('h1, [role="heading"][aria-level="1"]');
            if (mainHeading) {
              return mainHeading.textContent?.trim();
            }

            return null;
          } catch (e) {
            console.error('提取section标题失败:', e);
            return null;
          }
        },
        entryUrl,
        this.config.navLinksSelector
      );

      if (title) {
        this.logger.debug(`从导航提取到section标题: ${title}`, { entryUrl });
        return title;
      }

      // 3. 降级方案：从URL路径生成标题
      const url = new URL(entryUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1];
      const fallbackTitle = lastPart
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      this.logger.debug(`使用URL生成的fallback标题: ${fallbackTitle}`, { entryUrl });
      return fallbackTitle;
    } catch (error) {
      this.logger.warn('提取section标题失败，使用fallback', {
        entryUrl,
        error: error.message,
      });

      // 返回简单的fallback
      const url = new URL(entryUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts[pathParts.length - 1] || 'Section';
    }
  }

  /**
   * 从单个入口页面收集URL
   * @param {import('puppeteer').Page} page
   * @param {string} entryUrl
   * @param {string[] | null} allEntryPoints
   * @returns {Promise<string[]>}
   */
  async _collectUrlsFromEntryPoint(page, entryUrl, allEntryPoints = null) {
    this.logger.info('处理入口页面', { entryUrl });

    const allUrls = [];
    let currentUrl = entryUrl;
    let pageNum = 1;
    const maxPages = this.config.maxPaginationPages || 10; // 默认最多翻10页，防止无限循环
    const otherEntryPoints = Array.isArray(allEntryPoints)
      ? allEntryPoints.filter((ep) => ep !== entryUrl)
      : [];
    const otherEntryPointSet = new Set(
      otherEntryPoints.map((url) => this._normalizeUrlForEntryPointComparison(url))
    );

    while (true) {
      this.logger.info(`开始导航到页面 [Page ${pageNum}]`, {
        currentUrl,
        waitUntil: 'domcontentloaded',
      });

      // 1. 导航到当前页面
      await retry(
        async () => {
          const gotoStartTime = Date.now();
          const waitUntil =
            this.config?.urlCollectionWaitUntil ||
            this.config?.navigationWaitUntil ||
            'domcontentloaded';
          const timeout = this.config?.pageTimeout || 30000;

          const response = await page.goto(currentUrl, {
            waitUntil,
            timeout,
          });

          const gotoEndTime = Date.now();
          this.logger.info('page.goto 完成', {
            url: currentUrl,
            duration: gotoEndTime - gotoStartTime,
            status: response?.status(),
          });

          // 尝试等待内容加载
          try {
            const selector = this.config.navLinksSelector || 'a[href]';
            await page.waitForSelector(selector, { timeout: 5000 });
          } catch {
            this.logger.debug('等待链接选择器超时，继续尝试提取');
          }

          return response;
        },
        {
          maxAttempts: this.config.maxRetries || 3,
          delay: 2000,
          onRetry: (attempt, error) => {
            this.logger.warn(`页面加载重试 ${attempt}次`, {
              url: currentUrl,
              error: error.message,
            });
          },
        }
      );

      // 2. 提取当前页面的链接（排除选择器在页面端防御性处理；跨-section入口过滤在Node端使用统一规范化）
      const excludeSelector = this.config.navExcludeSelector || '';

      const rawUrls = await page.evaluate(
        (selector, excludeSel) => {
          const isHttpUrl = (url) => {
            try {
              const u = new URL(url, window.location.href);
              return u.protocol === 'http:' || u.protocol === 'https:';
            } catch {
              return false;
            }
          };

          let elements = Array.from(document.querySelectorAll(selector));

          if (excludeSel) {
            let validExcludeSel = excludeSel;
            try {
              document.querySelector(validExcludeSel);
            } catch {
              validExcludeSel = '';
            }

            if (validExcludeSel) {
              elements = elements.filter((el) => !el.closest(validExcludeSel));
            }
          }

          return elements
            .map((el) => {
              const href = el?.href || el?.getAttribute?.('href');
              return typeof href === 'string' ? href.trim() : null;
            })
            .filter((href) => {
              if (!href) return false;
              if (href.startsWith('#')) return false;
              if (href.toLowerCase().startsWith('javascript:')) return false;
              return isHttpUrl(href);
            });
        },
        this.config.navLinksSelector,
        excludeSelector
      );

      const urls = rawUrls
        .map((href) => (typeof href === 'string' ? href.trim() : ''))
        .filter(
          (href) => href && !href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')
        )
        .map((href) => {
          try {
            const resolvedUrl = new URL(href, currentUrl);
            if (!['http:', 'https:'].includes(resolvedUrl.protocol)) {
              return null;
            }
            return resolvedUrl.toString();
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((resolvedUrl) => {
          const normalized = this._normalizeUrlForEntryPointComparison(resolvedUrl);
          return !otherEntryPointSet.has(normalized);
        });

      this.logger.info(`Page ${pageNum} 提取到 ${urls.length} 个链接`);

      // 过滤掉非文章链接（可选，依赖选择器的准确性）
      // 这里我们假设 navLinksSelector 已经足够准确
      allUrls.push(...urls);

      // 3. 检查是否需要分页
      if (!this.config.paginationSelector) {
        break;
      }

      if (pageNum >= maxPages) {
        this.logger.info(`达到最大分页数 (${maxPages})，停止翻页`);
        break;
      }

      // 4. 寻找下一页链接
      const nextPageUrl = await page.evaluate((selector) => {
        // 支持多个选择器，用逗号分隔
        const selectors = selector.split(',').map((s) => s.trim());

        for (const s of selectors) {
          // 尝试找到"下一页"或"Older Posts"等链接
          // 这里我们查找匹配选择器的元素
          const links = Array.from(document.querySelectorAll(s));

          // 简单的启发式：通常是最后一个匹配的，或者包含特定文本
          // 对于Cloudflare blog，是 "Older Posts"
          // 我们假设选择器已经定位到了正确的 <a> 标签

          // 如果有多个匹配，通常分页链接在底部，取最后一个
          const link = links[links.length - 1];
          if (link) {
            return link.href;
          }
        }
        return null;
      }, this.config.paginationSelector);

      if (nextPageUrl && nextPageUrl !== currentUrl) {
        this.logger.info(`发现下一页: ${nextPageUrl}`);
        currentUrl = nextPageUrl;
        pageNum++;
      } else {
        this.logger.info('未发现下一页，分页结束');
        break;
      }
    }

    // 确保入口页面本身也被处理（如果是单页情况，且入口就是内容页的话。但在博客模式下，入口是列表页，通常不需要爬取入口页本身作为内容）
    // 为了兼容旧逻辑（文档模式），如果只抓了一页且没有分页配置，我们还是把入口URL加进去
    // 但对于博客列表页，我们通常不希望把列表页本身生成PDF

    // 策略：如果 config.isBlogMode 为 true，则不添加 entryUrl
    // 或者简单点，如果提取到了链接，就只返回链接。
    // 旧逻辑是：urls.unshift(entryUrl);

    // 我们保留旧逻辑的兼容性：如果不是分页模式，且看起来像文档（有侧边栏），则保留。
    // 但为了简单和安全，我们只在非分页模式下添加 entryUrl
    if (!this.config.paginationSelector) {
      // 检查是否已存在
      if (!allUrls.includes(entryUrl)) {
        allUrls.unshift(entryUrl);
      }
    }

    this.logger.debug('URL提取完成', {
      entryUrl,
      totalCount: allUrls.length,
      pagesScanned: pageNum,
    });

    return allUrls;
  }

  /**
   * 收集全局导航链接（不强制包含入口URL），用于根据侧边栏顺序进行分段
   */
  async _collectGlobalNavLinks(page) {
    const urls = await page.evaluate((selector) => {
      // 过滤掉顶栏 tab（nav-tabs）里的链接，只保留侧边栏/正文导航
      const all = Array.from(document.querySelectorAll(selector));
      const elements = all.filter((el) => !el.closest('.nav-tabs'));

      return elements
        .map((el) => {
          const href = el.href || el.getAttribute('href');
          return href ? href.trim() : null;
        })
        .filter((href) => href && !href.startsWith('#') && !href.startsWith('javascript:'));
    }, this.config.navLinksSelector);

    this.logger.debug('全局导航URL提取完成', { extractedCount: urls.length });
    return urls;
  }

  /**
   * 检查URL是否应被忽略
   */
  isIgnored(url) {
    if (!this.config.ignoreURLs || !Array.isArray(this.config.ignoreURLs)) {
      return false;
    }

    return this.config.ignoreURLs.some((pattern) => {
      if (typeof pattern === 'string') {
        return url.includes(pattern);
      }
      if (pattern instanceof RegExp) {
        return pattern.test(url);
      }
      return false;
    });
  }

  /**
   * 验证URL是否有效
   */
  validateUrl(url) {
    try {
      const parsedUrl = new URL(url);

      // 检查协议
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }

      // 检查允许的域名
      if (this.config.allowedDomains && this.config.allowedDomains.length > 0) {
        const isAllowed = this.config.allowedDomains.some((domain) => {
          return parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain);
        });
        if (!isAllowed) {
          return false;
        }
      }

      // 检查baseUrl前缀过滤
      if (this.config.baseUrl) {
        if (!url.startsWith(this.config.baseUrl)) {
          this.logger.debug('URL被baseUrl过滤', { url, baseUrl: this.config.baseUrl });
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.debug('URL验证失败', { url, error: error.message });
      return false;
    }
  }

  /**
   * 清理标题：移除常见的网站名称后缀
   * @param {string} title - 原始标题
   * @returns {string} 清理后的标题
   */
  _cleanTitle(title) {
    if (!title || typeof title !== 'string') {
      return '';
    }

    let cleaned = title.trim();

    // 移除常见的分隔符和网站名称后缀
    const separators = [
      ' | ', // "Overview | Claude Code" -> "Overview"
      ' - ', // "Overview - Claude Code" -> "Overview"
      ' – ', // en dash
      ' — ', // em dash
      ' :: ', // "Overview :: Docs" -> "Overview"
      ' • ', // bullet
      ' / ', // "Overview / Docs" -> "Overview"
    ];

    for (const sep of separators) {
      if (cleaned.includes(sep)) {
        const parts = cleaned.split(sep);
        // 保留第一部分（通常是页面标题）
        // 但要确保第一部分不为空且长度合理
        const firstPart = parts[0].trim();
        if (firstPart.length >= 2) {
          cleaned = firstPart;
          break;
        }
      }
    }

    // 如果清理后标题太短（可能是误删），返回原标题
    if (cleaned.length < 2 && title.length >= 2) {
      return title.trim();
    }

    return cleaned;
  }

  /**
   * 直接从 URL 获取 Markdown 源文件内容
   * 用于支持提供原始 .md 文件的文档站点（如 code.claude.com）
   * @param {string} url - 原始页面 URL
   * @returns {Promise<{content: string, title: string}|null>}
   */
  async _fetchMarkdownSource(url) {
    const suffix = this.config.markdownSource?.urlSuffix || '.md';
    const mdUrl = url.endsWith(suffix) ? url : url + suffix;

    this.logger.debug('尝试获取 Markdown 源文件', { url, mdUrl });

    try {
      const response = await fetch(mdUrl, {
        headers: {
          'User-Agent': this.config.browser?.userAgent || 'Mozilla/5.0',
          Accept: 'text/markdown, text/plain, */*',
        },
        signal: AbortSignal.timeout(this.config.pageTimeout || 30000),
      });

      if (!response.ok) {
        this.logger.warn('Markdown 源文件获取失败', {
          mdUrl,
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('markdown') && !contentType.includes('text/plain')) {
        this.logger.debug('响应类型不是 Markdown', { mdUrl, contentType });
        // 仍然尝试使用内容，某些服务器可能返回错误的 content-type
      }

      const content = await response.text();

      // 从 Markdown 内容中提取标题（第一个 # 标题）
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : null;

      this.logger.info('成功获取 Markdown 源文件', {
        mdUrl,
        contentLength: content.length,
        title: title || '(未找到标题)',
      });

      return { content, title };
    } catch (error) {
      this.logger.warn('Markdown 源文件获取异常', {
        mdUrl,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 渐进式导航策略 - 从快到慢尝试不同的等待策略
   * 支持通过 config.navigationStrategy 自定义首选策略
   */
  async navigateWithFallback(page, url) {
    let strategies = [
      // 1. 快速策略 - 适合简单页面
      {
        name: 'domcontentloaded',
        options: { waitUntil: 'domcontentloaded', timeout: 15000 },
      },
      // 2. 标准策略 - 等待网络空闲
      {
        name: 'networkidle2',
        options: { waitUntil: 'networkidle2', timeout: 30000 },
      },
      // 3. 完整策略 - 等待所有资源
      {
        name: 'networkidle0',
        options: { waitUntil: 'networkidle0', timeout: 45000 },
      },
      // 4. 最大容忍策略 - 仅等待页面加载
      {
        name: 'load',
        options: { waitUntil: 'load', timeout: 60000 },
      },
    ];

    // 如果配置了首选策略（非 auto），将其移到首位
    const preferredStrategy = this.config.navigationStrategy;
    if (preferredStrategy && preferredStrategy !== 'auto') {
      const preferred = strategies.find((s) => s.name === preferredStrategy);
      if (preferred) {
        const others = strategies.filter((s) => s.name !== preferredStrategy);
        strategies = [preferred, ...others];
        this.logger.debug(`使用首选导航策略: ${preferredStrategy}`, { url });
      }
    }

    let lastError = null;

    for (const strategy of strategies) {
      try {
        this.logger.debug(`尝试导航策略: ${strategy.name}`, { url });

        const response = await page.goto(url, strategy.options);

        // 检查响应状态
        if (response && response.status() >= 400) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        this.logger.debug(`导航成功使用策略: ${strategy.name}`, { url });
        return { success: true, strategy: strategy.name };
      } catch (error) {
        lastError = error;
        this.logger.warn(`导航策略 ${strategy.name} 失败`, {
          url,
          error: error.message,
        });

        // 如果是超时错误，继续尝试下一个策略
        if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
          continue;
        }

        // 如果是其他错误，根据错误类型决定是否继续
        if (
          error.message.includes('net::ERR_ABORTED') ||
          error.message.includes('net::ERR_FAILED')
        ) {
          // 网络错误，尝试等待一下再重试
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // 其他类型的错误直接失败
        break;
      }
    }

    return { success: false, error: lastError?.message || 'All navigation strategies failed' };
  }

  /**
   * 爬取单个页面 - 关键修改：使用数字索引命名
   */
  async scrapePage(url, index, options = {}) {
    const { isRetry = false } = options;

    // 检查是否已处理
    if (this.stateManager.isProcessed(url)) {
      this.logger.debug(`跳过已处理的URL: ${url}`);
      this.progressTracker.skip(url);
      return { status: 'skipped', reason: 'already_processed' };
    }

    const pageId = `scraper-page-${index}`;
    let page = null;

    try {
      this.logger.info(`开始爬取页面 [${index + 1}/${this.urlQueue.length}]: ${url}`);
      this.progressTracker.startUrl?.(url);

      // 创建页面
      page = await this.pageManager.createPage(pageId);

      // 设置图片观察器
      await this.imageService.setupImageObserver(page);

      // 访问页面 - 使用渐进式超时策略
      const navigationResult = await this.navigateWithFallback(page, url);
      if (!navigationResult.success) {
        throw new Error(`导航失败: ${navigationResult.error}`);
      }

      // 等待内容加载
      let contentFound = false;
      try {
        await page.waitForSelector(this.config.contentSelector, {
          timeout: 10000,
        });
        contentFound = true;
      } catch (error) {
        this.logger.warn('内容选择器等待超时', {
          url,
          selector: this.config.contentSelector,
          error: error.message,
        });
      }

      if (!contentFound) {
        throw new ValidationError('页面内容未找到');
      }

      // 提取页面标题（多源回退策略）
      const titleInfo = await page.evaluate((selector) => {
        let title = '';
        let source = 'none';

        // 策略 1: 优先使用 document.title（最可靠，始终在 <head> 中）
        const docTitle = document.title || '';
        if (docTitle && docTitle.trim().length > 0) {
          title = docTitle.trim();
          source = 'document.title';
        }

        // 策略 2: 如果 document.title 为空，从 contentSelector 内提取
        if (!title) {
          const contentElement = document.querySelector(selector);
          if (contentElement) {
            // 2a. 尝试 h1
            const h1 = contentElement.querySelector('h1');
            if (h1?.innerText?.trim()) {
              title = h1.innerText.trim();
              source = 'content-h1';
            }
            // 2b. 尝试 .title/.page-title 等
            else {
              const titleEl = contentElement.querySelector(
                'title, .title, .page-title, [class*="page-title"], [class*="PageTitle"]'
              );
              if (titleEl?.innerText?.trim()) {
                title = titleEl.innerText.trim();
                source = 'content-title-class';
              }
              // 2c. 尝试 h2/h3
              else {
                const heading = contentElement.querySelector('h2, h3');
                if (heading?.innerText?.trim()) {
                  title = heading.innerText.trim();
                  source = 'content-h2-h3';
                }
              }
            }
          }
        }

        // 策略 3: 如果 contentSelector 内没找到，尝试全局 h1（回退方案）
        if (!title) {
          const globalH1 = document.querySelector('h1');
          if (globalH1?.innerText?.trim()) {
            title = globalH1.innerText.trim();
            source = 'global-h1';
          }
        }

        return { title, source };
      }, this.config.contentSelector);

      const title = titleInfo.title;

      // 处理懒加载图片
      let imagesLoaded = false;
      try {
        imagesLoaded = await this.imageService.triggerLazyLoading(page);
        if (!imagesLoaded) {
          this.logger.warn(`部分图片未能加载: ${url}`);
          await this.metadataService.logImageLoadFailure(url, index);
        }
      } catch (error) {
        this.logger.warn('图片加载处理失败', { url, error: error.message });
        await this.metadataService.logImageLoadFailure(url, index);
      }

      // 展开折叠元素（始终执行，确保内容可见）
      try {
        await this.pdfStyleService.processSpecialContent(page);
      } catch (expandError) {
        this.logger.warn('折叠元素展开失败', {
          url,
          error: expandError.message,
        });
      }

      // 移除深色主题（始终执行，安全操作，不替换DOM）
      try {
        await this.pdfStyleService.removeDarkTheme(page);
      } catch (themeError) {
        this.logger.warn('深色主题移除失败', { url, error: themeError.message });
      }

      // 应用PDF样式优化（可选，添加错误处理）
      // 🔍 诊断日志：记录配置检查详情
      this.logger.info('PDF样式处理配置检查', {
        url,
        enablePDFStyleProcessing: this.config.enablePDFStyleProcessing,
        type: typeof this.config.enablePDFStyleProcessing,
        strictCheck: this.config.enablePDFStyleProcessing === true,
        configKeys: Object.keys(this.config).filter(
          (k) => k.includes('PDF') || k.includes('Style')
        ),
      });

      if (this.config.enablePDFStyleProcessing === true) {
        try {
          await this.pdfStyleService.applyPDFStyles(page, this.config.contentSelector);
        } catch (styleError) {
          this.logger.warn('PDF样式处理失败，跳过样式优化', {
            url,
            error: styleError.message,
          });
          // 继续生成PDF，即使样式处理失败
        }
        // 继续生成PDF，即使翻译失败
      }

      // 🔥 关键修改：生成PDF时使用数字索引而不是哈希
      const pdfPath = this.pathService.getPdfPath(url, {
        useHash: false, // 使用索引而不是哈希
        index: index,
      });

      await this.fileService.ensureDirectory(path.dirname(pdfPath));

      const useMarkdownWorkflow =
        this.config.markdown?.enabled &&
        this.config.markdownPdf?.enabled &&
        !!this.markdownService &&
        !!this.markdownToPdfService;

      // Track actual output path (markdown in batch mode, PDF otherwise)
      let actualOutputPath = pdfPath;
      let isBatchMode = false;

      if (useMarkdownWorkflow) {
        try {
          let markdownContent;
          let sourceTitle = null;

          // 优先尝试直接获取 Markdown 源文件
          if (this.config.markdownSource?.enabled) {
            const mdSource = await this._fetchMarkdownSource(url);
            if (mdSource) {
              markdownContent = mdSource.content;
              sourceTitle = mdSource.title;
              this.logger.info('使用直接获取的 Markdown 源文件', {
                url,
                pdfPath,
                titleFromSource: sourceTitle,
              });
            }
          }

          // 如果未启用或获取失败，回退到 DOM 提取
          if (!markdownContent) {
            this.logger.info('使用 DOM 转换 Markdown 工作流', {
              url,
              pdfPath,
            });
            markdownContent = await this.markdownService.extractAndConvertPage(
              page,
              this.config.contentSelector
            );
          }

          // 如果从源文件获取到标题，使用它覆盖 DOM 提取的标题
          const finalTitle = sourceTitle || title;

          const markdownWithFrontmatter = this.markdownService.addFrontmatter(markdownContent, {
            title: finalTitle,
            url,
            index,
          });

          const translatedMarkdown = this.translationService
            ? await this.translationService.translateMarkdown(markdownWithFrontmatter)
            : markdownWithFrontmatter;

          const markdownOutputDir = path.join(
            this.config.pdfDir,
            this.config.markdown?.outputDir || 'markdown'
          );
          const baseName = path.basename(pdfPath, '.pdf');
          const originalMarkdownPath = path.join(markdownOutputDir, `${baseName}.md`);
          const translatedMarkdownPath = path.join(markdownOutputDir, `${baseName}_translated.md`);

          await this.fileService.writeText(originalMarkdownPath, markdownWithFrontmatter);
          await this.fileService.writeText(translatedMarkdownPath, translatedMarkdown);

          // Check if batch mode is enabled - skip individual PDF generation
          if (this.config.markdownPdf?.batchMode) {
            this.logger.info('Batch mode enabled - skipping individual PDF generation', {
              url,
              markdownPath: translatedMarkdownPath,
            });
            // PDF will be generated in batch after all pages are scraped
            // Track markdown path instead of non-existent PDF path
            actualOutputPath = translatedMarkdownPath;
            isBatchMode = true;
          } else {
            await this.markdownToPdfService.convertContentToPdf(
              translatedMarkdown,
              pdfPath,
              this.config.markdownPdf
            );
            this.logger.info('Markdown 工作流 PDF 已生成', { pdfPath });
          }
        } catch (markdownError) {
          this.logger.warn('Markdown 工作流失败，回退到 Puppeteer PDF', {
            url,
            error: markdownError.message,
          });

          // 回退到原始 DOM 翻译 + Puppeteer PDF
          if (this.translationService) {
            try {
              this.logger.info('Before translation wait');
              await this.translationService.translatePage(page);
              this.logger.info('After translation wait');
            } catch (translationError) {
              this.logger.warn('翻译失败，继续生成原始PDF', {
                url,
                error: translationError.message,
              });
            }
          }

          this.logger.info('开始使用Puppeteer引擎生成PDF（回退模式）', {
            pdfPath,
          });
          const fallbackPdfOptions = {
            ...this.pdfStyleService.getPDFOptions(),
            path: pdfPath,
          };
          await page.pdf(fallbackPdfOptions);
          this.logger.info(`PDF已保存: ${pdfPath}`);
        }
      } else {
        // 原始 DOM 翻译 + Puppeteer PDF 工作流
        if (this.translationService) {
          try {
            this.logger.info('Before translation wait');
            await this.translationService.translatePage(page);
            this.logger.info('After translation wait');
          } catch (translationError) {
            this.logger.warn('翻译失败，继续生成原始PDF', {
              url,
              error: translationError.message,
            });
          }
        }

        this.logger.info('开始使用Puppeteer引擎生成PDF', { pdfPath });
        const pdfOptions = {
          ...this.pdfStyleService.getPDFOptions(),
          path: pdfPath,
        };
        await page.pdf(pdfOptions);
        this.logger.info(`PDF已保存: ${pdfPath}`);
      }

      // 保存URL到索引的映射，用于追溯和调试
      this.stateManager.setUrlIndex(url, index);

      // 清理并保存标题映射（使用字符串索引以匹配Python期望）
      const cleanedTitle = this._cleanTitle(title);
      if (cleanedTitle) {
        await this.metadataService.saveArticleTitle(String(index), cleanedTitle);
        this.logger.info(`提取到标题 [${index}]: ${cleanedTitle}`, {
          source: titleInfo.source,
          original: title !== cleanedTitle ? title : undefined,
        });
      } else {
        // ⚠️ 警告：标题提取失败
        this.logger.warn(`⚠️ 标题提取失败 [${index}/${this.urlQueue.length}]: ${url}`, {
          contentSelector: this.config.contentSelector,
          source: titleInfo.source,
          titleInfo: titleInfo,
          hint:
            'PDF目录将显示文件名而非实际标题。请检查：' +
            '\n  1. contentSelector 是否正确匹配页面结构' +
            '\n  2. 页面是否完全加载（检查 navigationWaitUntil 配置）' +
            '\n  3. 页面是否有 <title> 标签或 h1-h3 标题元素',
        });

        // 记录到元数据以便后续分析
        await this.metadataService.logFailedLink(
          url,
          index,
          new Error(`Title extraction failed: source=${titleInfo.source}`)
        );
      }

      // 标记为已处理 (use actual output path - markdown in batch mode, PDF otherwise)
      this.stateManager.markProcessed(url, actualOutputPath);
      this.progressTracker.success(url);

      // 定期保存状态
      const processedCount = this.progressTracker.getStats().processed;
      if (processedCount % 10 === 0) {
        await this.stateManager.save();
        this.logger.debug('状态已保存', { processedCount });
      }

      this.emit('pageScraped', {
        url,
        index,
        title,
        outputPath: actualOutputPath,
        isBatchMode,
        imagesLoaded,
      });

      return {
        status: 'success',
        title,
        outputPath: actualOutputPath,
        isBatchMode,
        imagesLoaded,
      };
    } catch (error) {
      this.logger.error(`页面爬取失败 [${index + 1}]: ${url}`, {
        error: error.message,
        stack: error.stack,
      });

      // 记录失败
      this.stateManager.markFailed(url, error);
      const willRetry = this.config.retryFailedUrls !== false && !isRetry;
      this.progressTracker.failure(url, error, willRetry);

      this.emit('pageScrapeFailed', {
        url,
        index,
        error: error.message,
      });

      throw new NetworkError(`页面爬取失败: ${url}`, url, error);
    } finally {
      // 🔧 修复：正确的清理顺序
      if (page) {
        try {
          // 1. 先清理页面相关的图片服务资源
          await this.imageService.cleanupPage(page);
        } catch (cleanupError) {
          this.logger?.debug('图片服务页面清理失败（非致命错误）', {
            error: cleanupError.message,
          });
        }

        // 2. 然后关闭页面
        await this.pageManager.closePage(pageId);
      }
    }
  }

  /**
   * 重试失败的URL
   */
  async retryFailedUrls() {
    const failedUrls = this.stateManager.getFailedUrls();
    if (failedUrls.length === 0) {
      this.logger.info('没有需要重试的失败URL');
      return;
    }

    this.logger.info(`开始重试 ${failedUrls.length} 个失败的URL`);

    let retrySuccessCount = 0;
    let retryFailCount = 0;
    let staleSkipCount = 0;

    for (const [url, errorInfo] of failedUrls) {
      try {
        this.logger.info(`重试失败的URL: ${url}`);

        // 兜底保护：如果URL已在已处理集合中，说明失败记录是脏数据
        if (this.stateManager.isProcessed(url)) {
          staleSkipCount++;
          this.logger.warn('检测到失败URL已是已处理状态，跳过重试并清理失败记录', { url });
          this.stateManager.clearFailure(url);
          continue;
        }

        // 清除失败状态
        this.stateManager.clearFailure(url);

        // 重新爬取
        const index = this.urlQueue.indexOf(url);
        const realIndex = index >= 0 ? index : this.urlQueue.length;

        await this.scrapePage(url, realIndex, { isRetry: true });
        retrySuccessCount++;

        // 重试间隔
        await delay(this.config.retryDelay || 2000);
      } catch (retryError) {
        retryFailCount++;
        this.logger.error(`重试失败: ${url}`, {
          原始错误: errorInfo?.message || 'Unknown',
          重试错误: retryError.message,
        });

        // 重新标记为失败
        this.stateManager.markFailed(url, retryError);
      }
    }

    this.logger.info('重试完成', {
      成功: retrySuccessCount,
      失败: retryFailCount,
      跳过: staleSkipCount,
    });

    this.emit('retryCompleted', {
      successCount: retrySuccessCount,
      failCount: retryFailCount,
    });
  }

  /**
   * 运行爬虫
   */
  async run() {
    if (this.isRunning) {
      throw new ValidationError('爬虫已在运行中');
    }

    this.isRunning = true;
    this.startTime = Date.now();

    try {
      this.logger.info('=== 开始运行爬虫（使用数字索引命名）===');

      // 初始化
      await this.initialize();

      // 收集URL
      const urls = await this.collectUrls();
      if (urls.length === 0) {
        this.logger.warn('没有找到可爬取的URL');
        return;
      }

      // 初始化运行时状态基线，避免统计依赖延迟更新导致计数不一致
      this.stateManager.setStartTime();
      urls.forEach((url, index) => this.stateManager.setUrlIndex(url, index));

      // 开始进度追踪
      this.progressTracker.start(urls.length);

      // 添加任务到队列
      urls.forEach((url, index) => {
        this.queueManager.addTask(
          `scrape-${index}`,
          async () => {
            try {
              await this.scrapePage(url, index);
            } catch (error) {
              // 错误已经被记录，这里只是防止队列中断
              this.logger.debug('队列任务失败，但已处理', { url, error: error.message });
            }
          },
          {
            url: url,
            priority: 0,
          }
        );
      });

      // 等待所有任务完成
      await this.queueManager.waitForIdle();

      // 保存最终状态
      await this.stateManager.save();

      // 重试失败的URL
      if (this.config.retryFailedUrls !== false) {
        await this.retryFailedUrls();
        await this.stateManager.save();
      }

      // 完成
      this.progressTracker.finish();

      const duration = Date.now() - this.startTime;
      const stats = this.progressTracker.getStats();
      const succeededCount = stats.succeeded ?? stats.completed ?? 0;

      this.logger.info('=== 爬虫运行完成 ===', {
        总URL数: urls.length,
        成功数: succeededCount,
        失败数: stats.failed,
        跳过数: stats.skipped,
        耗时: `${Math.round(duration / 1000)}秒`,
        成功率: `${((succeededCount / urls.length) * 100).toFixed(1)}%`,
      });

      this.emit('completed', {
        totalUrls: urls.length,
        stats: stats,
        duration: duration,
      });
    } catch (error) {
      this.logger.error('爬虫运行失败', {
        error: error.message,
        stack: error.stack,
      });

      this.emit('error', error);
      throw error;
    } finally {
      this.isRunning = false;

      // 清理资源
      try {
        await this.cleanup();
      } catch (cleanupError) {
        this.logger.error('资源清理失败', {
          error: cleanupError.message,
        });
      }
    }
  }

  /**
   * 暂停爬虫
   */
  async pause() {
    if (!this.isRunning) {
      this.logger.warn('爬虫未在运行，无法暂停');
      return;
    }

    this.logger.info('暂停爬虫...');
    await this.queueManager.pause();
    this.emit('paused');
  }

  /**
   * 恢复爬虫
   */
  async resume() {
    if (!this.isRunning) {
      this.logger.warn('爬虫未在运行，无法恢复');
      return;
    }

    this.logger.info('恢复爬虫...');
    await this.queueManager.resume();
    this.emit('resumed');
  }

  /**
   * 停止爬虫
   */
  async stop() {
    if (!this.isRunning) {
      this.logger.warn('爬虫未在运行');
      return;
    }

    this.logger.info('停止爬虫...');
    this.isRunning = false;

    await this.queueManager.clear();
    await this.cleanup();

    this.emit('stopped');
  }

  /**
   * 清理资源 - 🔧 修复版本
   */
  async cleanup() {
    this.logger.info('开始清理资源...');

    try {
      // 1. 暂停并清理队列管理器
      if (this.queueManager) {
        this.queueManager.pause();
        this.queueManager.clear();
      }

      // 2. 🔧 修复：图片服务的全局清理将由容器自动调用 dispose()
      // 这里不需要手动调用，避免重复清理

      // 3. 清理页面管理器（这会关闭所有页面）
      if (this.pageManager) {
        await this.pageManager.closeAll();
      }

      // 4. 清理浏览器池
      if (this.browserPool) {
        await this.browserPool.close();
      }

      // 5. 保存最终状态
      if (this.stateManager) {
        await this.stateManager.save();
      }

      this.logger.info('资源清理完成');
      this.emit('cleanup');
    } catch (error) {
      this.logger.error('资源清理失败', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * 获取爬虫状态
   */
  getStatus() {
    const stats = this.progressTracker.getStats();
    const queueStats = this.queueManager.getStatus();

    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      startTime: this.startTime,
      totalUrls: this.urlQueue.length,
      progress: stats,
      queue: queueStats,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }
}

export default Scraper;
