// src/services/stateManager.js
import { EventEmitter } from 'events';

export class StateManager extends EventEmitter {
  constructor(fileService, pathService, logger) {
    super();
    this.fileService = fileService;
    this.pathService = pathService;
    this.logger = logger;

    // 内存中的状态
    this.state = {
      processedUrls: new Set(), // 已处理的URL
      failedUrls: new Map(), // 失败的URL及错误信息
      urlToIndex: new Map(), // URL到索引的映射
      indexToUrl: new Map(), // 索引到URL的映射
      imageLoadFailures: new Set(), // 图片加载失败的URL
      urlToFile: new Map(), // URL到文件路径的映射
      startTime: null, // 开始时间
      lastSaveTime: null, // 最后保存时间
    };

    // 自动保存配置
    this.autoSaveInterval = 30000; // 30秒
    this.autoSaveTimer = null;
  }

  /**
   * 从磁盘加载状态
   */
  async load() {
    try {
      this.logger.info('加载状态数据...');

      // 加载进度数据
      const progress = await this.fileService.readJson(
        this.pathService.getMetadataPath('progress'),
        {
          processedUrls: [],
          failedUrls: [],
          urlToIndex: {},
          startTime: null,
        }
      );

      // 恢复Set和Map数据结构
      progress.processedUrls.forEach((url) => this.state.processedUrls.add(url));
      progress.failedUrls.forEach(({ url, error }) => this.state.failedUrls.set(url, error));

      // 恢复URL映射
      if (progress.urlToIndex) {
        Object.entries(progress.urlToIndex).forEach(([url, index]) => {
          this.state.urlToIndex.set(url, index);
          this.state.indexToUrl.set(index, url);
        });
      }

      // 恢复开始时间
      this.state.startTime = progress.startTime ? new Date(progress.startTime) : null;

      // 加载图片加载失败记录
      const imageFailures = await this.fileService.readJson(
        this.pathService.getMetadataPath('imageLoadFailures'),
        []
      );
      imageFailures.forEach(({ url }) => this.state.imageLoadFailures.add(url));

      // 加载URL到文件的映射
      const urlMapping = await this.fileService.readJson(
        this.pathService.getMetadataPath('urlMapping'),
        {}
      );
      Object.entries(urlMapping).forEach(([url, data]) => this.state.urlToFile.set(url, data.path));

      this._enforceDisjointState('load');

      this.logger.info('状态加载完成', {
        已处理: this.state.processedUrls.size,
        失败: this.state.failedUrls.size,
      });

      this.emit('loaded', this.getStats());
    } catch (error) {
      this.logger.warn('状态加载失败，使用空状态', { error: error.message });
      this.emit('load-error', error);
    }
  }

  /**
   * 保存状态到磁盘
   */
  async save(force = false) {
    try {
      const now = Date.now();

      // 如果不是强制保存，检查是否需要保存
      if (!force && this.state.lastSaveTime && now - this.state.lastSaveTime < 5000) {
        return; // 5秒内已保存过
      }

      this.logger.debug('保存状态数据...');

      // 兜底修复历史脏状态，保证 processed/failed 永远互斥
      this._enforceDisjointState('save');

      // 保存进度数据
      const urlToIndexObj = {};
      this.state.urlToIndex.forEach((index, url) => {
        urlToIndexObj[url] = index;
      });

      await this.fileService.writeJson(this.pathService.getMetadataPath('progress'), {
        processedUrls: Array.from(this.state.processedUrls),
        failedUrls: Array.from(this.state.failedUrls.entries()).map(([url, error]) => ({
          url,
          error,
        })),
        urlToIndex: urlToIndexObj,
        startTime: this.state.startTime,
        savedAt: new Date().toISOString(),
        stats: this.getStats(),
      });

      // 保存图片加载失败记录
      const imageFailures = Array.from(this.state.imageLoadFailures).map((url) => ({
        url,
        timestamp: new Date().toISOString(),
      }));
      await this.fileService.writeJson(
        this.pathService.getMetadataPath('imageLoadFailures'),
        imageFailures
      );

      // 保存URL映射
      const urlMapping = {};
      this.state.urlToFile.forEach((path, url) => {
        urlMapping[url] = {
          path,
          timestamp: new Date().toISOString(),
        };
      });
      await this.fileService.writeJson(this.pathService.getMetadataPath('urlMapping'), urlMapping);

      this.state.lastSaveTime = now;
      this.logger.debug('状态保存完成');
      this.emit('saved', this.getStats());
    } catch (error) {
      this.logger.error('状态保存失败', { error: error.message });
      this.emit('save-error', error);
    }
  }

  /**
   * 保证 processedUrls 与 failedUrls 互斥（失败优先）
   * 历史版本可能写入重叠状态，这里在 load/save 时自动修复
   */
  _enforceDisjointState(source = 'runtime') {
    const overlappedUrls = [];
    this.state.failedUrls.forEach((_, url) => {
      if (this.state.processedUrls.has(url)) {
        overlappedUrls.push(url);
      }
    });

    if (overlappedUrls.length === 0) {
      return 0;
    }

    overlappedUrls.forEach((url) => {
      this.state.processedUrls.delete(url);
      this.state.urlToFile.delete(url);
    });

    this.logger.warn('检测到状态重叠，按失败优先修复', {
      来源: source,
      重叠数量: overlappedUrls.length,
      示例: overlappedUrls.slice(0, 5),
    });

    return overlappedUrls.length;
  }

  /**
   * 启动自动保存
   */
  startAutoSave() {
    if (this.autoSaveTimer) {
      return;
    }

    this.autoSaveTimer = setInterval(() => {
      this.save().catch((error) => this.logger.error('自动保存失败', { error: error.message }));
    }, this.autoSaveInterval);

    this.logger.info('启动自动保存', {
      间隔: `${this.autoSaveInterval / 1000}秒`,
    });
  }

  /**
   * 停止自动保存
   */
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.logger.info('停止自动保存');
    }
  }

  /**
   * 记录URL和索引的映射
   */
  setUrlIndex(url, index) {
    this.state.urlToIndex.set(url, index);
    this.state.indexToUrl.set(index, url);
  }

  /**
   * 检查URL是否已处理
   */
  isProcessed(url) {
    return this.state.processedUrls.has(url);
  }

  /**
   * 标记URL为已处理
   */
  markProcessed(url, filePath = null) {
    this.state.processedUrls.add(url);
    this.state.failedUrls.delete(url); // 如果之前失败过，现在成功了

    if (filePath) {
      this.state.urlToFile.set(url, filePath);
    }

    this.emit('url-processed', { url, total: this.state.processedUrls.size });
  }

  /**
   * 标记URL为失败
   */
  markFailed(url, error) {
    const errorMessage = error?.message || String(error);
    this.state.processedUrls.delete(url);
    this.state.failedUrls.set(url, errorMessage);
    this.emit('url-failed', { url, error: errorMessage });
  }

  /**
   * 获取失败的URL列表
   */
  getFailedUrls() {
    return Array.from(this.state.failedUrls.entries());
  }

  /**
   * 清除失败记录（用于重试）
   */
  clearFailure(url) {
    this.state.failedUrls.delete(url);
    this.state.processedUrls.delete(url);
  }

  /**
   * 标记图片加载失败
   */
  markImageLoadFailure(url) {
    this.state.imageLoadFailures.add(url);
    this.emit('image-load-failure', { url });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.state.urlToIndex.size;
    const processed = this.state.processedUrls.size;
    const failed = this.state.failedUrls.size;
    const pending = Math.max(0, total - processed - failed);

    return {
      total,
      processed,
      failed,
      pending,
      imageLoadFailures: this.state.imageLoadFailures.size,
      successRate: total > 0 ? ((processed / total) * 100).toFixed(2) : 0,
      startTime: this.state.startTime,
      elapsed: this.state.startTime ? Date.now() - this.state.startTime : 0,
    };
  }

  /**
   * 重置状态
   */
  reset() {
    this.state.processedUrls.clear();
    this.state.failedUrls.clear();
    this.state.urlToIndex.clear();
    this.state.indexToUrl.clear();
    this.state.imageLoadFailures.clear();
    this.state.urlToFile.clear();
    this.state.startTime = null;
    this.state.lastSaveTime = null;

    this.emit('reset');
  }

  /**
   * 设置开始时间
   */
  setStartTime() {
    this.state.startTime = Date.now();
  }

  /**
   * 导出状态报告
   */
  async exportReport(outputPath) {
    const report = {
      summary: this.getStats(),
      failedUrls: Array.from(this.state.failedUrls.entries()).map(([url, error]) => ({
        url,
        error,
      })),
      imageLoadFailures: Array.from(this.state.imageLoadFailures),
      processedFiles: Array.from(this.state.urlToFile.entries()).map(([url, path]) => ({
        url,
        path,
      })),
      generatedAt: new Date().toISOString(),
    };

    await this.fileService.writeJson(outputPath, report);
    this.logger.info('导出状态报告', { path: outputPath });

    return report;
  }
}
