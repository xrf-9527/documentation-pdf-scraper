# Progress Retry State Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate progress inconsistencies caused by stale overlapping state (`processedUrls` + `failedUrls`) and prevent redundant retries of already processed URLs.

**Architecture:** Enforce a strict disjoint invariant in `stateManager` (failure wins on conflicts), apply the invariant at both `load` and `save` boundaries, and add a retry-time stale-record guard in `scraper` so malformed persisted state cannot reintroduce duplicate work.

**Tech Stack:** Node.js ESM, Jest

---

### Task 1: Lock Failing Reproduction Tests

**Files:**
- Modify: `tests/services/stateManager.test.js`
- Modify: `tests/core/scraper.test.js`

**Step 1:** Add a `load` regression test proving overlap repair (`processed`/`failed` overlap should be removed from `processed`).

**Step 2:** Add a `save` regression test proving persisted `progress.json` cannot contain overlap.

**Step 3:** Add a retry regression test proving stale failed URLs already in processed state are not re-scraped.

**Step 4:** Run targeted tests and confirm they fail before implementation.

Run:
```bash
npx jest tests/services/stateManager.test.js tests/core/scraper.test.js
```

### Task 2: Harden State Invariants in Runtime Boundaries

**Files:**
- Modify: `src/services/stateManager.js`

**Step 1:** Add `_enforceDisjointState(source)` helper to compute overlap and repair state with failure priority.

**Step 2:** Invoke invariant repair in `load()` right after persisted data is reconstructed.

**Step 3:** Invoke invariant repair in `save()` before serializing payload.

**Step 4:** Emit structured warning log with overlap count and sample URLs for observability.

### Task 3: Add Retry-Path Stale Data Guard

**Files:**
- Modify: `src/core/scraper.js`

**Step 1:** In `retryFailedUrls()`, check `stateManager.isProcessed(url)` before retrying.

**Step 2:** For stale entries, clear failure record and skip retry.

**Step 3:** Extend retry summary metrics with `跳过` to expose stale-skip count.

### Task 4: Verification and Exit Criteria

**Files:**
- Verify: `tests/services/stateManager.test.js`
- Verify: `tests/core/scraper.test.js`

**Step 1:** Run targeted regression tests.

Run:
```bash
npx jest tests/services/stateManager.test.js tests/core/scraper.test.js
```

**Step 2:** Run lint for touched files.

Run:
```bash
npx eslint src/core/scraper.js src/services/stateManager.js tests/core/scraper.test.js tests/services/stateManager.test.js
```

**Exit criteria:**
- No overlap can persist from `load` to runtime state.
- `save` writes disjoint `processedUrls` and `failedUrls`.
- Retry loop does not reprocess stale failed records already processed.
- Added regression tests remain green.
