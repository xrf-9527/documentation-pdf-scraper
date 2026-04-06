// src/services/queueManager.js
import PQueue from 'p-queue';
import { EventEmitter } from 'events';

export class QueueManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      concurrency: options.concurrency || 5,
      interval: options.interval || 1000,
      intervalCap: options.intervalCap || 5,
      timeout: options.timeout || 30000,
      // p-queue v9 removed throwOnTimeout — timeout always throws TimeoutError
      maxTaskHistory:
        Number.isInteger(options.maxTaskHistory) && options.maxTaskHistory >= 0
          ? options.maxTaskHistory
          : 100,
      ...options,
    };

    this.queue = new PQueue({
      concurrency: this.options.concurrency,
      interval: this.options.interval,
      intervalCap: this.options.intervalCap,
      timeout: this.options.timeout,
    });

    this.tasks = new Map();
    this.taskHistory = new Map();
    this.setupEventHandlers();
  }

  /**
   * 设置事件处理器
   */
  setupEventHandlers() {
    this.queue.on('active', () => {
      this.emit('active', {
        size: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on('idle', () => {
      this.emit('idle');
    });

    this.queue.on('add', () => {
      this.emit('taskAdded', {
        size: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on('next', () => {
      this.emit('taskCompleted', {
        size: this.queue.size,
        pending: this.queue.pending,
      });
    });
  }

  /**
   * 添加任务
   */
  async addTask(id, fn, options = {}) {
    this.taskHistory.delete(id);

    const task = {
      id,
      fn,
      priority: options.priority || 0,
      addedAt: Date.now(),
      status: 'pending',
    };

    this.tasks.set(id, task);

    const wrappedFn = async () => {
      task.status = 'running';
      task.startedAt = Date.now();

      try {
        const result = await fn();
        task.status = 'completed';
        task.completedAt = Date.now();
        task.duration = task.completedAt - task.startedAt;
        this.emit('taskSuccess', { id, result, task });
        return result;
      } catch (error) {
        task.status = 'failed';
        task.error = error;
        task.failedAt = Date.now();
        this.emit('taskFailed', { id, error, task });
        throw error;
      } finally {
        this.tasks.delete(id);
        this.recordTaskHistory(task);
      }
    };

    // p-queue v9: timeout always throws TimeoutError (throwOnTimeout was removed).
    // When pTimeout wins the race, wrappedFn's try/catch/finally hasn't run yet,
    // so we must handle state cleanup here before re-throwing.
    const promise = this.queue.add(wrappedFn, { priority: task.priority });

    return promise.catch((error) => {
      // Only update state if wrappedFn's internal catch hasn't already processed this task
      if (task.status !== 'failed' && task.status !== 'completed') {
        task.status = 'failed';
        task.error = error;
        task.failedAt = Date.now();
        this.emit('taskFailed', { id, error, task });
      }
      // Ensure cleanup even if wrappedFn's finally block hasn't run yet
      if (this.tasks.has(id)) {
        this.tasks.delete(id);
        this.recordTaskHistory(task);
      }
      // Re-throw to preserve API contract — callers must handle rejections
      throw error;
    });
  }

  /**
   * 批量添加任务
   */
  async addBatch(tasks) {
    const promises = tasks.map(({ id, fn, options }) => this.addTask(id, fn, options));
    return Promise.allSettled(promises);
  }

  /**
   * 等待所有任务完成
   */
  async waitForIdle() {
    await this.queue.onIdle();
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue.clear();
    this.tasks.clear();
    this.taskHistory.clear();
    this.emit('cleared');
  }

  /**
   * 暂停队列
   */
  pause() {
    this.queue.pause();
    this.emit('paused');
  }

  /**
   * 恢复队列
   */
  resume() {
    this.queue.start();
    this.emit('resumed');
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    const activeTasks = Array.from(this.tasks.values());
    const historyTasks = Array.from(this.taskHistory.values());

    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
      concurrency: this.options.concurrency,
      tasks: {
        total: activeTasks.length + historyTasks.length,
        pending: activeTasks.filter((t) => t.status === 'pending').length,
        running: activeTasks.filter((t) => t.status === 'running').length,
        completed: historyTasks.filter((t) => t.status === 'completed').length,
        failed: historyTasks.filter((t) => t.status === 'failed').length,
      },
    };
  }

  /**
   * 获取任务详情
   */
  getTaskDetails(id) {
    return this.tasks.get(id) || this.taskHistory.get(id);
  }

  /**
   * 更新并发数
   */
  setConcurrency(concurrency) {
    this.options.concurrency = concurrency;
    this.queue.concurrency = concurrency;
    this.emit('concurrency-changed', { concurrency });
  }

  recordTaskHistory(task) {
    if (this.options.maxTaskHistory <= 0) {
      return;
    }

    this.taskHistory.set(task.id, { ...task });

    while (this.taskHistory.size > this.options.maxTaskHistory) {
      const oldestTaskId = this.taskHistory.keys().next().value;
      this.taskHistory.delete(oldestTaskId);
    }
  }
}
