// src/services/progressTracker.js
import { EventEmitter } from 'events';
import chalk from 'chalk';

export class ProgressTracker extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;

    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      startTime: null,
      endTime: null,
      currentUrl: null,
      eta: null,
    };

    this.urlStats = new Map(); // 每个URL的详细统计
    this.progressInterval = null;
    this.displayMode = 'detailed'; // 'simple' | 'detailed'
  }

  /**
   * 开始追踪
   */
  start(total, options = {}) {
    // 允许重复调用 start()，确保状态和定时器完全重置
    this.stopProgressDisplay();
    this.urlStats.clear();
    this.stats = {
      total,
      completed: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      startTime: Date.now(),
      endTime: null,
      currentUrl: null,
      eta: null,
    };
    this.displayMode = options.displayMode || 'detailed';

    this.logger.info('开始爬取任务', {
      总数: total,
      模式: this.displayMode,
    });

    this.emit('start', { total });

    // 开始定期显示进度
    if (this.displayMode === 'detailed') {
      this.startProgressDisplay();
    }
  }

  /**
   * 记录成功
   */
  success(url, details = {}) {
    const urlStat = this.getOrCreateUrlStat(url);

    // 只有当URL状态不是success时才增加completed计数
    // 这样可以避免重试时重复计数
    if (urlStat.status !== 'success') {
      this.stats.completed++;
    }

    this.stats.currentUrl = null;
    urlStat.status = 'success';
    urlStat.endTime = Date.now();
    urlStat.duration = urlStat.endTime - urlStat.startTime;
    urlStat.details = details;

    this.updateETA();
    this.logProgress('success', url);
    this.emit('success', { url, stats: this.getStats() });
  }

  /**
   * 记录失败
   */
  failure(url, error, willRetry = false) {
    const urlStat = this.getOrCreateUrlStat(url);

    // 只有确认最终失败时才增加失败计数
    if (!willRetry && urlStat.status !== 'failed') {
      this.stats.failed++;
    }

    this.stats.currentUrl = null;
    urlStat.status = willRetry ? 'pending-retry' : 'failed';
    urlStat.error = error.message || String(error);
    urlStat.attempts = (urlStat.attempts || 0) + 1;

    this.updateETA();
    this.logProgress('failure', url, error);
    this.emit('failure', { url, error, stats: this.getStats() });
  }

  /**
   * 记录跳过
   */
  skip(url, reason = '') {
    const urlStat = this.getOrCreateUrlStat(url);

    // 只有当URL状态不是skipped时才增加跳过计数
    if (urlStat.status !== 'skipped') {
      this.stats.skipped++;
    }

    urlStat.status = 'skipped';
    urlStat.reason = reason;

    this.updateETA();
    this.logProgress('skip', url, reason);
    this.emit('skip', { url, reason, stats: this.getStats() });
  }

  /**
   * 记录重试
   */
  retry(url, attempt) {
    this.stats.retried++;

    const urlStat = this.getOrCreateUrlStat(url);
    urlStat.status = 'retrying';
    urlStat.attempts = attempt;

    this.logger.warn(`重试 [${attempt}]: ${url}`);
    this.emit('retry', { url, attempt });
  }

  /**
   * 开始处理URL
   */
  startUrl(url) {
    this.stats.currentUrl = url;

    const urlStat = this.getOrCreateUrlStat(url);
    urlStat.startTime = Date.now();
    urlStat.status = 'processing';

    this.emit('url-start', { url });
  }

  /**
   * 完成追踪
   */
  finish() {
    this.stats.endTime = Date.now();
    this.stopProgressDisplay();

    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    const summary = this.getSummary();

    this.logger.info('爬取任务完成', {
      ...summary,
      总耗时: `${duration.toFixed(2)}秒`, // 使用 duration
    });
    this.displayFinalReport();

    this.emit('finish', { stats: this.getStats(), summary, duration });
  }

  /**
   * 获取或创建URL统计
   */
  getOrCreateUrlStat(url) {
    if (!this.urlStats.has(url)) {
      this.urlStats.set(url, {
        url,
        status: 'pending',
        startTime: null,
        endTime: null,
        duration: null,
        attempts: 0,
        error: null,
      });
    }
    return this.urlStats.get(url);
  }

  /**
   * 更新预计完成时间
   */
  updateETA() {
    const processed = this.stats.completed + this.stats.failed + this.stats.skipped;
    if (processed === 0) return;

    const elapsed = Date.now() - this.stats.startTime;
    const rate = processed / elapsed;
    const remaining = Math.max(0, this.stats.total - processed); // Ensure remaining is not negative

    // Only calculate ETA if there are remaining items and rate is reasonable
    if (remaining > 0 && rate > 0) {
      this.stats.eta = remaining / rate;
    } else {
      this.stats.eta = 0; // No remaining time if completed or rate is 0
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    // 计算基于实际处理的唯一URL数量
    const processedUrls = Array.from(this.urlStats.values()).filter(
      (stat) => stat.status === 'success' || stat.status === 'failed' || stat.status === 'skipped'
    ).length;

    const percentage =
      this.stats.total > 0 ? ((processedUrls / this.stats.total) * 100).toFixed(2) : 0;

    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const rate = processedUrls > 0 ? processedUrls / elapsed : 0;

    return {
      ...this.stats,
      processed: processedUrls, // 使用基于唯一URL的计数
      percentage,
      rate: rate.toFixed(2),
      elapsed: elapsed.toFixed(0),
      etaSeconds: this.stats.eta ? Math.round(this.stats.eta / 1000) : null,
    };
  }

  /**
   * 获取摘要
   */
  getSummary() {
    const duration = this.stats.endTime ? (this.stats.endTime - this.stats.startTime) / 1000 : 0;

    // 计算基于唯一URL的成功数量
    const successUrls = Array.from(this.urlStats.values()).filter(
      (stat) => stat.status === 'success'
    ).length;

    const successRate =
      this.stats.total > 0 ? ((successUrls / this.stats.total) * 100).toFixed(2) : '0.00';

    return {
      总数: this.stats.total,
      成功: successUrls, // 使用基于唯一URL的计数
      失败: this.stats.failed,
      跳过: this.stats.skipped,
      重试次数: this.stats.retried,
      成功率: `${successRate}%`,
      总耗时: `${duration.toFixed(2)}秒`,
      平均速度: `${(this.stats.total / duration).toFixed(2)} 页/秒`,
    };
  }

  /**
   * 记录进度日志
   */
  logProgress(type, url, extra = null) {
    const stats = this.getStats();
    const processed = stats.processed;

    if (this.displayMode === 'simple') {
      return; // 简单模式下不输出每个URL的日志
    }

    const progressBar = this.createProgressBar(stats.percentage);
    const etaStr =
      stats.etaSeconds && stats.etaSeconds > 0
        ? `预计剩余: ${this.formatTime(stats.etaSeconds)}`
        : '';

    switch (type) {
      case 'success':
        this.logger.info(
          chalk.green(`✓ [${processed}/${this.stats.total}] ${url}`) +
            ` ${progressBar} ${stats.percentage}% ${etaStr}`
        );
        break;
      case 'failure':
        this.logger.error(
          chalk.red(`✗ [${processed}/${this.stats.total}] ${url}`) +
            ` - ${extra?.message || '未知错误'}`
        );
        break;
      case 'skip':
        this.logger.info(
          chalk.yellow(`⚠ [${processed}/${this.stats.total}] 跳过: ${url}`) +
            (extra ? ` - ${extra}` : '')
        );
        break;
    }
  }

  /**
   * 创建进度条
   */
  createProgressBar(percentage) {
    const width = 20;

    // 限制百分比在0-100之间，防止进度条计算错误
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    const filled = Math.round((width * clampedPercentage) / 100);
    const empty = Math.max(0, width - filled); // 确保empty不为负数

    // 额外检查，确保字符串重复次数不为负数
    const filledCount = Math.max(0, filled);
    const emptyCount = Math.max(0, empty);

    return chalk.green('█'.repeat(filledCount)) + chalk.gray('░'.repeat(emptyCount));
  }

  /**
   * 格式化时间
   */
  formatTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}分${secs}秒`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}小时${mins}分`;
  }

  /**
   * 开始定期显示进度
   */
  startProgressDisplay() {
    this.progressInterval = setInterval(() => {
      const stats = this.getStats();
      if (this.stats.currentUrl) {
        console.log(chalk.cyan(`处理中: ${this.stats.currentUrl}`));
      }
      // Only display progress if total is properly set
      if (this.stats.total > 0) {
        console.log(
          `进度: ${stats.percentage}% (${stats.processed}/${this.stats.total}) ` +
            `速率: ${stats.rate} 页/秒 ` +
            (stats.etaSeconds && stats.etaSeconds > 0
              ? `剩余: ${this.formatTime(stats.etaSeconds)}`
              : '')
        );
      }
    }, 5000); // 每5秒更新一次
  }

  /**
   * 停止进度显示
   */
  stopProgressDisplay() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * 显示最终报告
   */
  displayFinalReport() {
    console.log('\n' + chalk.bold('=== 爬取任务完成报告 ==='));
    const summary = this.getSummary();

    Object.entries(summary).forEach(([key, value]) => {
      const color = key === '失败' && value > 0 ? chalk.red : chalk.green;
      console.log(`${key}: ${color(value)}`);
    });

    // 显示失败的URL
    if (this.stats.failed > 0) {
      console.log('\n' + chalk.red('失败的URL:'));
      this.urlStats.forEach((stat, url) => {
        if (stat.status === 'failed') {
          console.log(chalk.red(`  - ${url}: ${stat.error}`));
        }
      });
    }

    console.log(chalk.bold('\n======================\n'));
  }

  /**
   * 导出详细报告
   */
  async exportDetailedReport(outputPath, fileService) {
    const report = {
      summary: this.getSummary(),
      stats: this.getStats(),
      urlDetails: Array.from(this.urlStats.values()),
      generatedAt: new Date().toISOString(),
    };

    await fileService.writeJson(outputPath, report);
    this.logger.info('导出详细进度报告', { path: outputPath });

    return report;
  }
}
