# Application Minimal E2E Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐最小化端到端协作测试，覆盖 `Application` 在标准模式与批量模式下的编排链路。

**Architecture:** 新增一个 integration 测试文件，直接使用真实 `Application` 类并通过模块 mock 提供受控容器服务。为提升可测性，给 `Application` 增加可选构造参数以禁用信号处理器注册，避免测试污染进程级监听器。

**Tech Stack:** Node.js ESM, Jest, Babel-Jest

### Task 1: 新增失败测试（RED）

**Files:**
- Create: `tests/integration/applicationWorkflow.integration.test.js`

**Step 1: 写失败测试**

```javascript
it('does not register signal handlers when setupSignalHandlers is false', () => {
  const processOnSpy = jest.spyOn(process, 'on');
  const app = new Application({ setupSignalHandlers: false });
  expect(processOnSpy).not.toHaveBeenCalled();
});
```

**Step 2: 运行测试确认失败**

Run: `npm test -- tests/integration/applicationWorkflow.integration.test.js`
Expected: FAIL（当前构造器总会注册信号处理器）

### Task 2: 最小实现（GREEN）

**Files:**
- Modify: `src/app.js`

**Step 1: 添加可选构造参数**

```javascript
constructor(options = {}) {
  const { setupSignalHandlers = true, processRef = process } = options;
  this.processRef = processRef;
  if (setupSignalHandlers) {
    this.setupSignalHandlers();
  }
}
```

**Step 2: 统一替换进程引用**

```javascript
this.processRef.on(...)
this.processRef.exit(...)
this.processRef.memoryUsage()
this.processRef.pid
```

**Step 3: 运行目标测试确认通过**

Run: `npm test -- tests/integration/applicationWorkflow.integration.test.js`
Expected: PASS

### Task 3: 回归验证与文档更新

**Files:**
- Modify: `docs/2026-02-11-project-full-review.md`

**Step 1: 运行验证命令**

Run:
- `npm run lint`
- `make ci`

Expected: 全通过

**Step 2: 更新审查文档实施结果**
- 记录最小 E2E 测试补齐与可测性改进

