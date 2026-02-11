// tests/services/queueManager.test.js
import { QueueManager } from '../../src/services/queueManager.js';
import { EventEmitter } from 'events';

// Mock p-queue
jest.mock('p-queue', () => {
  const EventEmitterCopy = require('events').EventEmitter;

  return jest.fn().mockImplementation(function (options) {
    const mockQueue = new EventEmitterCopy();
    Object.assign(mockQueue, {
      size: 0,
      pending: 0,
      isPaused: false,
      concurrency: options.concurrency || 1,
      add: jest.fn().mockImplementation(async (fn, options) => {
        mockQueue.emit('add');
        mockQueue.emit('active');
        try {
          const result = await fn();
          mockQueue.emit('next');
          if (mockQueue.size === 0 && mockQueue.pending === 0) {
            mockQueue.emit('idle');
          }
          return result;
        } catch (error) {
          mockQueue.emit('next');
          throw error;
        }
      }),
      onIdle: jest.fn().mockResolvedValue(),
      clear: jest.fn(),
      pause: jest.fn().mockImplementation(() => {
        mockQueue.isPaused = true;
      }),
      start: jest.fn().mockImplementation(() => {
        mockQueue.isPaused = false;
      }),
    });
    return mockQueue;
  });
});

describe('QueueManager', () => {
  let queueManager;

  beforeEach(() => {
    queueManager = new QueueManager({
      concurrency: 3,
      interval: 1000,
      intervalCap: 5,
      timeout: 30000,
      throwOnTimeout: false,
    });
  });

  describe('constructor', () => {
    test('应该使用默认选项初始化', () => {
      const defaultQM = new QueueManager();
      expect(defaultQM.options.concurrency).toBe(5);
      expect(defaultQM.options.interval).toBe(1000);
      expect(defaultQM.options.intervalCap).toBe(5);
      expect(defaultQM.options.timeout).toBe(30000);
      expect(defaultQM.options.throwOnTimeout).toBe(false);
    });

    test('应该使用提供的选项初始化', () => {
      expect(queueManager.options.concurrency).toBe(3);
      expect(queueManager.queue).toBeDefined();
      expect(queueManager.tasks).toBeInstanceOf(Map);
    });

    test('应该是EventEmitter的实例', () => {
      expect(queueManager).toBeInstanceOf(EventEmitter);
    });
  });

  describe('事件处理', () => {
    test('应该转发active事件', (done) => {
      queueManager.on('active', (data) => {
        expect(data).toEqual({ size: 0, pending: 0 });
        done();
      });

      queueManager.queue.emit('active');
    });

    test('应该转发idle事件', (done) => {
      queueManager.on('idle', () => {
        done();
      });

      queueManager.queue.emit('idle');
    });

    test('应该转发taskAdded事件', (done) => {
      queueManager.on('taskAdded', (data) => {
        expect(data).toEqual({ size: 0, pending: 0 });
        done();
      });

      queueManager.queue.emit('add');
    });

    test('应该转发taskCompleted事件', (done) => {
      queueManager.on('taskCompleted', (data) => {
        expect(data).toEqual({ size: 0, pending: 0 });
        done();
      });

      queueManager.queue.emit('next');
    });
  });

  describe('addTask', () => {
    test('应该添加任务并执行', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const result = await queueManager.addTask('task1', fn);

      expect(result).toBe('result');
      expect(queueManager.tasks.has('task1')).toBe(false);

      const task = queueManager.getTaskDetails('task1');
      expect(task.id).toBe('task1');
      expect(task.status).toBe('completed');
      expect(task.completedAt).toBeDefined();
      expect(task.duration).toBeDefined();
    });

    test('应该处理任务优先级', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      await queueManager.addTask('task1', fn, { priority: 10 });

      const task = queueManager.getTaskDetails('task1');
      expect(task.priority).toBe(10);
      expect(queueManager.queue.add).toHaveBeenCalledWith(expect.any(Function), { priority: 10 });
    });

    test('应该在任务成功时发出taskSuccess事件', (done) => {
      const fn = jest.fn().mockResolvedValue('success');

      queueManager.on('taskSuccess', (event) => {
        expect(event.id).toBe('task1');
        expect(event.result).toBe('success');
        expect(event.task).toBeDefined();
        done();
      });

      queueManager.addTask('task1', fn);
    });

    test('应该在任务失败时发出taskFailed事件', (done) => {
      const error = new Error('Task failed');
      const fn = jest.fn().mockRejectedValue(error);

      queueManager.on('taskFailed', (event) => {
        expect(event.id).toBe('task1');
        expect(event.error).toBe(error);
        expect(event.task.status).toBe('failed');
        expect(event.task.error).toBe(error);
        done();
      });

      queueManager.addTask('task1', fn).catch(() => {});
    });

    test('应该记录任务执行时间', async () => {
      let resolveTask;
      const fn = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTask = resolve;
          })
      );

      const taskPromise = queueManager.addTask('task1', fn);

      // 任务开始后等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 50));

      const taskDuringExecution = queueManager.tasks.get('task1');
      expect(taskDuringExecution.status).toBe('running');
      expect(taskDuringExecution.startedAt).toBeDefined();

      resolveTask('done');
      await taskPromise;

      const taskAfterCompletion = queueManager.getTaskDetails('task1');
      expect(taskAfterCompletion.duration).toBeGreaterThan(0);
    });

    test('任务完成后应从活动任务中移除，并可通过详情接口查询历史', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      await queueManager.addTask('history-task', fn);

      expect(queueManager.tasks.has('history-task')).toBe(false);
      const task = queueManager.getTaskDetails('history-task');
      expect(task).toBeDefined();
      expect(task.status).toBe('completed');
    });

    test('应限制历史任务数量，超出时淘汰最旧记录', async () => {
      const historyQueueManager = new QueueManager({
        concurrency: 1,
        maxTaskHistory: 2,
      });

      await historyQueueManager.addTask('task-1', async () => '1');
      await historyQueueManager.addTask('task-2', async () => '2');
      await historyQueueManager.addTask('task-3', async () => '3');

      expect(historyQueueManager.getTaskDetails('task-1')).toBeUndefined();
      expect(historyQueueManager.getTaskDetails('task-2')).toBeDefined();
      expect(historyQueueManager.getTaskDetails('task-3')).toBeDefined();
    });
  });

  describe('addBatch', () => {
    test('应该批量添加任务', async () => {
      const tasks = [
        { id: 'task1', fn: jest.fn().mockResolvedValue('result1') },
        { id: 'task2', fn: jest.fn().mockResolvedValue('result2') },
        { id: 'task3', fn: jest.fn().mockRejectedValue(new Error('error3')) },
      ];

      const results = await queueManager.addBatch(tasks);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ status: 'fulfilled', value: 'result1' });
      expect(results[1]).toEqual({ status: 'fulfilled', value: 'result2' });
      expect(results[2]).toEqual({
        status: 'rejected',
        reason: expect.objectContaining({ message: 'error3' }),
      });

      expect(queueManager.tasks.has('task1')).toBe(false);
      expect(queueManager.tasks.has('task2')).toBe(false);
      expect(queueManager.tasks.has('task3')).toBe(false);
      expect(queueManager.getTaskDetails('task1').status).toBe('completed');
      expect(queueManager.getTaskDetails('task2').status).toBe('completed');
      expect(queueManager.getTaskDetails('task3').status).toBe('failed');
    });

    test('应该处理带选项的批量任务', async () => {
      const tasks = [
        { id: 'task1', fn: jest.fn().mockResolvedValue('result1'), options: { priority: 10 } },
        { id: 'task2', fn: jest.fn().mockResolvedValue('result2'), options: { priority: 5 } },
      ];

      await queueManager.addBatch(tasks);

      expect(queueManager.getTaskDetails('task1').priority).toBe(10);
      expect(queueManager.getTaskDetails('task2').priority).toBe(5);
    });
  });

  describe('waitForIdle', () => {
    test('应该等待所有任务完成', async () => {
      await queueManager.waitForIdle();

      expect(queueManager.queue.onIdle).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    test('应该清空队列和任务', () => {
      // 添加一些任务到内存
      queueManager.tasks.set('task1', { id: 'task1' });
      queueManager.tasks.set('task2', { id: 'task2' });
      queueManager.taskHistory.set('task3', { id: 'task3', status: 'completed' });

      const clearedPromise = new Promise((resolve) => {
        queueManager.once('cleared', resolve);
      });

      queueManager.clear();

      expect(queueManager.queue.clear).toHaveBeenCalled();
      expect(queueManager.tasks.size).toBe(0);
      expect(queueManager.taskHistory.size).toBe(0);

      return clearedPromise;
    });
  });

  describe('pause/resume', () => {
    test('pause应该暂停队列', () => {
      const pausedPromise = new Promise((resolve) => {
        queueManager.once('paused', resolve);
      });

      queueManager.pause();

      expect(queueManager.queue.pause).toHaveBeenCalled();
      return pausedPromise;
    });

    test('resume应该恢复队列', () => {
      const resumedPromise = new Promise((resolve) => {
        queueManager.once('resumed', resolve);
      });

      queueManager.resume();

      expect(queueManager.queue.start).toHaveBeenCalled();
      return resumedPromise;
    });
  });

  describe('getStatus', () => {
    test('应该返回队列状态', async () => {
      // 添加一些任务
      queueManager.taskHistory.set('task1', { status: 'completed' });
      queueManager.tasks.set('task2', { status: 'running' });
      queueManager.tasks.set('task3', { status: 'pending' });
      queueManager.taskHistory.set('task4', { status: 'failed' });

      const status = queueManager.getStatus();

      expect(status).toEqual({
        size: 0,
        pending: 0,
        isPaused: false,
        concurrency: 3,
        tasks: {
          total: 4,
          pending: 1,
          running: 1,
          completed: 1,
          failed: 1,
        },
      });
    });
  });

  describe('getTaskDetails', () => {
    test('应该返回任务详情', () => {
      const taskData = {
        id: 'task1',
        status: 'completed',
        priority: 5,
      };
      queueManager.tasks.set('task1', taskData);

      const details = queueManager.getTaskDetails('task1');

      expect(details).toEqual(taskData);
    });

    test('应该为不存在的任务返回undefined', () => {
      const details = queueManager.getTaskDetails('nonexistent');

      expect(details).toBeUndefined();
    });
  });

  describe('setConcurrency', () => {
    test('应该更新并发数', () => {
      const concurrencyChangedPromise = new Promise((resolve) => {
        queueManager.once('concurrency-changed', resolve);
      });

      queueManager.setConcurrency(10);

      expect(queueManager.options.concurrency).toBe(10);
      expect(queueManager.queue.concurrency).toBe(10);

      return concurrencyChangedPromise.then((event) => {
        expect(event).toEqual({ concurrency: 10 });
      });
    });
  });

  describe('任务生命周期', () => {
    test('任务应该经历完整的生命周期', async () => {
      const fn = jest
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('done'), 10)));

      const taskPromise = queueManager.addTask('lifecycle-task', fn, { priority: 5 });

      // 检查初始状态
      let task = queueManager.tasks.get('lifecycle-task');
      expect(task.id).toBe('lifecycle-task');
      expect(task.priority).toBe(5);
      expect(task.addedAt).toBeDefined();

      // 等待任务完成
      const result = await taskPromise;

      // 检查最终状态
      task = queueManager.getTaskDetails('lifecycle-task');
      expect(task.status).toBe('completed');
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
      expect(task.duration).toBeGreaterThan(0);
      expect(result).toBe('done');
    });
  });
});
