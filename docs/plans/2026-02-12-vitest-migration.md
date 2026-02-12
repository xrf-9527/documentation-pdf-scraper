# Vitest Single-Track Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前 Jest 测试体系一次性切换到 Vitest，并移除 Jest 相关依赖与配置。

**Architecture:** 采用“单线直切”方案：不保留 Jest/Vitest 双轨，不新增 `test:jest` 回退脚本。先完成运行时与配置切换，再完成测试代码 API 迁移与 ESM 兼容修正，最后清理 Jest 资产并更新文档与 CI。所有质量门禁统一以 Vitest 结果为准。

**Tech Stack:** Node.js ESM、Vitest、`@vitest/coverage-v8`、ESLint 9。

---

## 当前基线（迁移前）

- 当前命令：`npm test -- --runInBand`
- 当前结果：31 suites / 637 tests 通过
- 测试文件：`tests/**/*.test.js` 共 31 个
- 风险重点：mock hoist、fake timers、ESM/CJS 兼容（`require` 遗留）

---

### Task 1: 迁移前冻结基线（单线切换前的唯一安全点）

**Files:**
- Modify: `docs/plans/2026-02-12-vitest-migration.md`

**Step 1: 记录基线结果**

Run: `npm test -- --runInBand`
Expected: 31 suites / 637 tests 通过（若数字变化，以当前输出为准并写入迁移记录）。

**Step 2: 确认当前 lint 基线**

Run: `npm run lint`
Expected: 0 error。

**Step 3: 创建迁移提交点（非双轨，仅 VCS 回退）**

Run:
- `git add -A`
- `git commit -m "chore: snapshot pre-vitest migration baseline"`

Expected: 形成单一回退锚点。

### Task 2: 直接切换测试运行器到 Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Modify: `eslint.config.js`

**Step 1: 安装 Vitest 依赖**

Run: `npm i -D vitest @vitest/coverage-v8`
Expected: 安装成功。

**Step 2: 立即切换 npm scripts（不保留 Jest 脚本）**

在 `package.json` 修改：
- `test`: `vitest run`
- `test:watch`: `vitest`

Expected: 默认测试入口立即指向 Vitest。

**Step 3: 新建 `vitest.config.js`**

建议配置：
- `test.environment = 'node'`
- `test.include = ['tests/**/*.test.js']`
- `test.globals = true`
- `test.clearMocks = true`

**Step 4: ESLint 测试全局改为 Vitest**

在 `eslint.config.js` 的 tests 段改为 `globals.vitest`。

**Step 5: 冒烟验证**

Run: `npm test -- --help`
Expected: Vitest CLI 正常输出。

### Task 3: 测试代码从 Jest API 迁移到 Vitest API

**Files:**
- Modify: `tests/**/*.test.js`

**Step 1: 导入语句迁移**

替换：
- `import { jest } from '@jest/globals'` -> `import { vi } from 'vitest'`

**Step 2: API 迁移**

替换：
- `jest.mock` -> `vi.mock`
- `jest.fn` -> `vi.fn`
- `jest.spyOn` -> `vi.spyOn`
- `jest.clearAllMocks` -> `vi.clearAllMocks`
- `jest.useFakeTimers/useRealTimers` -> `vi.useFakeTimers/useRealTimers`
- `jest.advanceTimersByTime/runAllTimers/clearAllTimers` -> 对应 `vi.*`

**Step 3: 快速静态检查**

Run: `rg -n '@jest/globals|\\bjest\\.' tests`
Expected: 0 命中。

### Task 4: ESM 兼容与 mock 行为对齐

**Files:**
- Modify: 仅失败用例文件

**Step 1: 清理 `require(...)` 遗留（测试目录）**

Run: `rg -n 'require\\(' tests --glob '*.test.js'`
Expected: 0 命中（除非有明确保留理由并注释）。

**Step 2: 处理 mock hoist 差异**

规则：
- mock 工厂内不引用越界变量。
- 需要真实模块时使用 `vi.importActual`。

**Step 3: 处理 fake timers 稳定性**

规则：
- 使用 fake timers 的测试必须在 `afterEach` 恢复 `vi.useRealTimers()`。
- 长生命周期 timer 必须显式清理。

**Step 4: 分组排障验证**

Run: `npx vitest run tests/core tests/services tests/utils tests/integration`
Expected: 所有分组通过。

### Task 5: CI 与 Makefile 全量切换到 Vitest

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`

**Step 1: 确认 `make test` 仅调用 Vitest**

Run: `make test`
Expected: 实际执行 `vitest run`。

**Step 2: CI 全链路验证**

Run: `make ci`
Expected: Test/Lint/verify-openclaw-ci 全通过。

### Task 6: 移除 Jest 资产并收尾文档

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `jest.config.js`
- Delete: `babel.config.js`（若仅服务 Jest）
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `project-context.md`

**Step 1: 卸载 Jest 相关依赖**

移除：`jest`、`babel-jest`（以及仅用于 Jest 的 Babel 依赖）。

**Step 2: 删除废弃配置文件**

删除：`jest.config.js`、`babel.config.js`（确认无其他用途后）。

**Step 3: 文档命令统一替换**

将所有 `jest` 命令替换为 `vitest` 等价命令。

**Step 4: 最终验收**

Run:
- `npm test`
- `npm run lint`
- `make ci`
- `rg -n '@jest/globals|\\bjest\\.|jest.config.js|babel-jest' . --glob '!node_modules'`

Expected: 测试与 CI 全绿，Jest 运行时引用清零。

---

## 验收标准（Definition of Done）

- `npm test` 只运行 Vitest。
- 全量测试通过，数量不低于迁移前基线。
- CI 只使用 Vitest 并稳定通过。
- Jest 配置与依赖全部移除。
- 项目文档中测试命令统一为 Vitest。

## 回滚策略（单线）

- 通过 Task 1 的“迁移前冻结提交点”进行回滚。
- 若迁移中断，直接 `git revert <migration-commit>` 或切回迁移前提交继续修复。
