# OpenClaw zh-CN Doc Target Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增一个稳定抓取 `https://docs.openclaw.ai/zh-CN` 的目标配置，并确保 URL 覆盖率可持续验证（避免漏抓）。

**Architecture:** 使用 `doc-targets/openclaw-zh-cn.json` 作为抓取入口配置，抓取正文仍走现有 Puppeteer 流程，但 URL 列表由 `sitemap.xml` 自动生成写入 `targetUrls`（绕开 Mintlify 侧边栏分组隐藏导致的漏链问题）。正文优先通过 `markdownSource` 读取 `/zh-CN/*.md`，失败时回退 DOM→Markdown。新增覆盖率校验脚本，持续比较 `targetUrls` 与站点 `sitemap`。

**Tech Stack:** Node.js ESM, puppeteer-extra (stealth), Joi config validation, Jest

## Ground Truth (2026-02-11)

- 站点框架：Mintlify + Next.js（`x-powered-by: Next.js`, `x-mintlify-client-version`）
- `robots.txt` 可访问，`sitemap.xml` 可访问
- `sitemap.xml` 中 `zh-CN` URL 数：260
- `https://docs.openclaw.ai/zh-CN/start/getting-started.md` 返回 `200` 且 `content-type: text/markdown`
- 仅依赖侧边栏导航会漏抓：
  - 15~18 个入口页并集仅覆盖 236~256 个 URL
  - 漏页集中在 Gateway 子分组

## Approach Options

1. **Option A (推荐): `sitemap.xml` 生成 `targetUrls` + 覆盖率校验**
- 优点：全量、稳定、可自动适应新增页面
- 缺点：需要新增一个生成脚本

2. **Option B: 扩大 `sectionEntryPoints` 覆盖隐藏分组**
- 优点：改动小、保持侧边栏顺序
- 缺点：站点结构变更后易漏抓，需要人工维护

3. **Option C: 在核心抓取器里实现“运行时 sitemap 发现”**
- 优点：最自动化
- 缺点：核心逻辑侵入性高，测试与回归成本更高

## Task Plan (Bite-sized)

### Task 1: 提取并测试 Sitemap URL 解析器

**Files:**
- Create: `src/utils/sitemapTargetBuilder.js`
- Create: `tests/utils/sitemapTargetBuilder.test.js`

**Step 1: 写失败测试**

```javascript
it('extracts zh-CN URLs from sitemap xml and normalizes them', () => {
  const urls = extractTargetUrlsFromSitemap(sampleXml, {
    origin: 'https://docs.openclaw.ai',
    pathPrefix: '/zh-CN',
  });
  expect(urls).toContain('https://docs.openclaw.ai/zh-CN/start/getting-started');
});
```

**Step 2: 运行测试确认失败**

Run: `npm test -- tests/utils/sitemapTargetBuilder.test.js`
Expected: FAIL with "extractTargetUrlsFromSitemap is not defined"

**Step 3: 实现最小可用解析器**

```javascript
export function extractTargetUrlsFromSitemap(xml, { origin, pathPrefix }) {
  // parse <loc>..</loc>, normalize URL, filter by prefix, de-duplicate, keep order
}
```

**Step 4: 运行测试确认通过**

Run: `npm test -- tests/utils/sitemapTargetBuilder.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/sitemapTargetBuilder.js tests/utils/sitemapTargetBuilder.test.js
git commit -m "feat: add sitemap url parser for doc targets"
```

### Task 2: 新增 OpenClaw zh-CN 目标配置骨架

**Files:**
- Create: `doc-targets/openclaw-zh-cn.json`

**Step 1: 添加最小配置**

```json
{
  "rootURL": "https://docs.openclaw.ai/zh-CN",
  "baseUrl": "https://docs.openclaw.ai/zh-CN",
  "navLinksSelector": "#sidebar-content a[href]",
  "contentSelector": "#content-area",
  "allowedDomains": ["docs.openclaw.ai"],
  "sectionEntryPoints": ["https://docs.openclaw.ai/zh-CN/install", "https://docs.openclaw.ai/zh-CN/channels"],
  "ignoreURLs": [],
  "enablePDFStyleProcessing": false,
  "navigationStrategy": "domcontentloaded",
  "markdownSource": {
    "enabled": true,
    "urlSuffix": ".md"
  },
  "targetUrls": []
}
```

**Step 2: 验证配置可加载**

Run: `DOC_TARGET=openclaw-zh-cn node scripts/test-config-loading.js`
Expected: 输出中包含 `rootURL/baseUrl/contentSelector/markdownSource`

**Step 3: Commit**

```bash
git add doc-targets/openclaw-zh-cn.json
git commit -m "feat: add openclaw zh-cn doc target skeleton"
```

### Task 3: 实现 `targetUrls` 自动刷新脚本

**Files:**
- Create: `scripts/update-openclaw-target-urls.js`
- Modify: `package.json`

**Step 1: 写脚本（默认就地更新）**

```javascript
// fetch sitemap.xml -> extract zh-CN urls -> write doc-target targetUrls
```

**Step 2: 增加命令**

```json
"docs:openclaw:update-urls": "node scripts/update-openclaw-target-urls.js"
```

**Step 3: 执行刷新**

Run: `npm run docs:openclaw:update-urls`
Expected: `targetUrls` 数量约等于当前 `sitemap` 的 zh-CN 数量（当前为 260）

**Step 4: Commit**

```bash
git add scripts/update-openclaw-target-urls.js package.json doc-targets/openclaw-zh-cn.json
git commit -m "feat: generate openclaw zh-cn target urls from sitemap"
```

### Task 4: 增加覆盖率校验脚本（可靠性护栏）

**Files:**
- Create: `scripts/verify-openclaw-target-coverage.js`
- Modify: `package.json`

**Step 1: 编写校验逻辑**

```javascript
// compare targetUrls set vs sitemap zh-CN set
// non-zero missing -> process.exit(1)
```

**Step 2: 增加命令**

```json
"docs:openclaw:verify": "node scripts/verify-openclaw-target-coverage.js"
```

**Step 3: 运行校验**

Run: `npm run docs:openclaw:verify`
Expected: PASS with `missing=0`

**Step 4: Commit**

```bash
git add scripts/verify-openclaw-target-coverage.js package.json
git commit -m "test: add coverage guard for openclaw zh-cn target urls"
```

### Task 5: 集成切换命令并验证切换流程

**Files:**
- Modify: `package.json`

**Step 1: 增加切换命令**

```json
"docs:openclaw": "node scripts/use-doc-target.js use openclaw-zh-cn"
```

**Step 2: 执行并确认当前配置**

Run:
- `npm run docs:openclaw`
- `npm run docs:current`

Expected:
- `Doc Target: openclaw-zh-cn`
- `Root URL: https://docs.openclaw.ai/zh-CN`

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add openclaw doc target command"
```

### Task 6: 抓取冒烟验证（小样本）

**Files:**
- Modify: `doc-targets/openclaw-zh-cn.json` (临时缩小 `targetUrls` 到 5-10 条用于冒烟，验证后恢复全量)

**Step 1: 清理并运行冒烟抓取**

Run:
- `make clean`
- `DOC_TARGET=openclaw-zh-cn npm start`

Expected:
- 生成对应数量的 PDF/Markdown
- `pdfs/metadata/articleTitles.json` 有真实中文标题

**Step 2: 恢复全量 `targetUrls`**

Run: `npm run docs:openclaw:update-urls`
Expected: 恢复全量 URL 列表

### Task 7: 全量质量验证

**Files:**
- N/A

**Step 1: 运行测试和 lint**

Run:
- `make test`
- `npm run lint`

Expected:
- 516+ tests passing
- lint clean

**Step 2: 最终提交**

```bash
git add .
git commit -m "feat: add reliable openclaw zh-cn scraping target"
```

## Rollout and Risk Control

- 每次抓取前执行：
  - `npm run docs:openclaw:update-urls`
  - `npm run docs:openclaw:verify`
- 若站点结构变化：优先保证 `targetUrls` 覆盖率（即使导航选择器失效也不影响 URL 全量）。
- 若 `.md` 接口短期不可用：抓取器会回退到 DOM 流程，`contentSelector=#content-area` 已验证可用。
