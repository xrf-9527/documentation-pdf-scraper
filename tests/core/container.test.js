import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// tests/core/container.test.js
import Container from '../../src/core/container.js';

describe('Container', () => {
  let container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register', () => {
    test('应该成功注册一个简单的服务', () => {
      const factory = () => 'test service';
      container.register('testService', factory);

      expect(container.services.has('testService')).toBe(true);
      const serviceConfig = container.services.get('testService');
      expect(serviceConfig.factory).toBe(factory);
      expect(serviceConfig.singleton).toBe(true);
      expect(serviceConfig.dependencies).toEqual([]);
    });

    test('应该使用提供的选项注册服务', () => {
      const factory = () => 'test';
      const options = {
        singleton: false,
        dependencies: ['dep1', 'dep2'],
        lifecycle: 'transient',
      };

      container.register('testService', factory, options);

      const serviceConfig = container.services.get('testService');
      expect(serviceConfig.singleton).toBe(false);
      expect(serviceConfig.dependencies).toEqual(['dep1', 'dep2']);
      expect(serviceConfig.lifecycle).toBe('transient');
    });
  });

  describe('get', () => {
    test('应该获取简单的单例服务', async () => {
      container.register('config', () => ({ apiUrl: 'http://test.com' }));

      const config1 = await container.get('config');
      const config2 = await container.get('config');

      expect(config1).toEqual({ apiUrl: 'http://test.com' });
      expect(config1).toBe(config2); // 单例应该返回相同的实例
    });

    test('应该获取非单例服务', async () => {
      let counter = 0;
      container.register('counter', () => ({ value: ++counter }), { singleton: false });

      const instance1 = await container.get('counter');
      const instance2 = await container.get('counter');

      expect(instance1.value).toBe(1);
      expect(instance2.value).toBe(2);
      expect(instance1).not.toBe(instance2);
    });

    test('应该使用类构造函数创建实例', async () => {
      class TestService {
        constructor(name) {
          this.name = name || 'default';
        }
      }

      container.register('service', TestService);

      const instance = await container.get('service');
      expect(instance).toBeInstanceOf(TestService);
      expect(instance.name).toBe('default');
    });

    test('应该抛出错误当服务不存在时', async () => {
      await expect(container.get('nonExistent')).rejects.toThrow("Service 'nonExistent' not found");
    });

    test('应该处理返回Promise的工厂函数', async () => {
      container.register('asyncService', async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ loaded: true }), 10);
        });
      });

      const service = await container.get('asyncService');
      expect(service.loaded).toBe(true);
    });

    test('应该处理直接的对象注册', async () => {
      const directObject = { type: 'direct', value: 42 };
      container.register('directService', directObject);

      const service = await container.get('directService');
      expect(service).toBe(directObject);
    });
  });

  describe('resolveDependencies', () => {
    test('应该解析简单的依赖关系', async () => {
      container.register('logger', () => ({ log: vi.fn() }));
      container.register('config', () => ({ apiUrl: 'http://test.com' }));
      container.register('service', (logger, config) => ({ logger, config }), {
        dependencies: ['logger', 'config'],
      });

      const service = await container.get('service');
      expect(service.logger).toBeDefined();
      expect(service.config.apiUrl).toBe('http://test.com');
    });

    test('应该解析嵌套的依赖关系', async () => {
      container.register('logger', () => ({ log: vi.fn() }));
      container.register('db', (logger) => ({ logger, query: vi.fn() }), {
        dependencies: ['logger'],
      });
      container.register('userService', (db) => ({ db, getUser: vi.fn() }), {
        dependencies: ['db'],
      });

      const userService = await container.get('userService');
      expect(userService.db.logger).toBeDefined();
      expect(userService.db.query).toBeDefined();
    });
  });

  describe('checkCircularDependency', () => {
    test('应该检测简单的循环依赖', () => {
      container.register('serviceA', () => {}, { dependencies: ['serviceB'] });
      container.register('serviceB', () => {}, { dependencies: ['serviceA'] });

      expect(() => container.checkCircularDependency('serviceA')).toThrow(
        'Circular dependency detected: serviceA -> serviceB -> serviceA'
      );
    });

    test('应该检测复杂的循环依赖', () => {
      container.register('serviceA', () => {}, { dependencies: ['serviceB'] });
      container.register('serviceB', () => {}, { dependencies: ['serviceC'] });
      container.register('serviceC', () => {}, { dependencies: ['serviceA'] });

      expect(() => container.checkCircularDependency('serviceA')).toThrow(
        /Circular dependency detected/
      );
    });

    test('应该通过非循环依赖的验证', () => {
      container.register('logger', () => {});
      container.register('config', () => {});
      container.register('service', () => {}, { dependencies: ['logger', 'config'] });

      expect(() => container.checkCircularDependency('service')).not.toThrow();
    });
  });

  describe('validateDependencies', () => {
    test('应该验证所有服务的依赖关系', () => {
      container.register('logger', () => {});
      container.register('config', () => {});
      container.register('service', () => {}, { dependencies: ['logger', 'config'] });

      expect(() => container.validateDependencies()).not.toThrow();
    });

    test('应该在存在循环依赖时抛出错误', () => {
      container.register('serviceA', () => {}, { dependencies: ['serviceB'] });
      container.register('serviceB', () => {}, { dependencies: ['serviceA'] });

      expect(() => container.validateDependencies()).toThrow();
    });
  });

  describe('getStats', () => {
    test('应该返回正确的统计信息', async () => {
      container.register('service1', () => {});
      container.register('service2', () => {}, { singleton: false });
      container.register('service3', () => {});

      await container.get('service1');

      const stats = container.getStats();
      expect(stats.total).toBe(3);
      expect(stats.created).toBe(1);
      expect(stats.singletons).toBe(2);
      expect(stats.instances).toBe(1);
    });
  });

  describe('dispose', () => {
    test('应该调用服务的dispose方法', async () => {
      const disposeFn = vi.fn();
      const service = { dispose: disposeFn };
      container.register('disposableService', () => service);

      await container.get('disposableService');
      await container.dispose();

      expect(disposeFn).toHaveBeenCalled();
    });

    test('应该调用服务的close方法', async () => {
      const closeFn = vi.fn();
      const service = { close: closeFn };
      container.register('closeableService', () => service);

      await container.get('closeableService');
      await container.dispose();

      expect(closeFn).toHaveBeenCalled();
    });

    test('应该调用服务的cleanup方法', async () => {
      const cleanupFn = vi.fn();
      const service = { cleanup: cleanupFn };
      container.register('cleanupService', () => service);

      await container.get('cleanupService');
      await container.dispose();

      expect(cleanupFn).toHaveBeenCalled();
    });

    test('应该按相反顺序清理服务', async () => {
      const callOrder = [];

      container.register('service1', () => ({
        dispose: () => callOrder.push('service1'),
      }));
      container.register('service2', () => ({
        dispose: () => callOrder.push('service2'),
      }));
      container.register('service3', () => ({
        dispose: () => callOrder.push('service3'),
      }));

      await container.get('service1');
      await container.get('service2');
      await container.get('service3');
      await container.dispose();

      expect(callOrder).toEqual(['service3', 'service2', 'service1']);
    });

    test('应该处理dispose时的错误', async () => {
      const errorService = {
        dispose: () => {
          throw new Error('Dispose error');
        },
      };
      container.register('errorService', () => errorService);

      await container.get('errorService');

      // dispose不应该因为单个服务的错误而失败
      await expect(container.dispose()).resolves.not.toThrow();
    });

    test('应该清空容器', async () => {
      container.register('service', () => {});
      await container.get('service');

      await container.dispose();

      expect(container.services.size).toBe(0);
      expect(container.instances.size).toBe(0);
    });
  });

  describe('listServices', () => {
    test('应该列出所有注册的服务', async () => {
      container.register('service1', () => {});
      container.register('service2', () => {}, {
        singleton: false,
        dependencies: ['service1'],
      });

      await container.get('service1');

      const services = container.listServices();
      expect(services).toHaveLength(2);

      const service1 = services.find((s) => s.name === 'service1');
      expect(service1).toEqual({
        name: 'service1',
        singleton: true,
        dependencies: [],
        lifecycle: 'singleton',
        created: true,
        hasInstance: true,
      });

      const service2 = services.find((s) => s.name === 'service2');
      expect(service2).toEqual({
        name: 'service2',
        singleton: false,
        dependencies: ['service1'],
        lifecycle: 'singleton',
        created: false,
        hasInstance: false,
      });
    });
  });

  describe('has', () => {
    test('应该检查服务是否存在', () => {
      container.register('existingService', () => {});

      expect(container.has('existingService')).toBe(true);
      expect(container.has('nonExistingService')).toBe(false);
    });
  });

  describe('getHealth', () => {
    test('应该返回容器健康状态', async () => {
      container.register('service1', () => {});
      container.register('service2', () => {});

      await container.get('service1');

      const health = container.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.stats.total).toBe(2);
      expect(health.stats.created).toBe(1);
      expect(health.services).toHaveLength(2);

      const service1Health = health.services.find((s) => s.name === 'service1');
      expect(service1Health.status).toBe('created');
      expect(service1Health.hasInstance).toBe(true);

      const service2Health = health.services.find((s) => s.name === 'service2');
      expect(service2Health.status).toBe('registered');
      expect(service2Health.hasInstance).toBe(false);
    });
  });
});
