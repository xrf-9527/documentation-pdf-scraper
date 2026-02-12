# AGENTS.md

A comprehensive guide for AI coding agents working on this documentation PDF scraper project.

This file is the canonical source of truth for project structure, commands, configuration rules, and coding standards.  
Any other agent-specific files (for example `CLAUDE.md`) should treat this document as authoritative and avoid duplicating normative content.

## Project Overview

**Documentation PDF Scraper** - A Puppeteer-based system for generating PDFs from documentation sites with anti-bot bypass and collapsible content expansion capabilities.

**Tech Stack:** Node.js ESM, Puppeteer-extra (stealth), Pandoc CLI (with a LaTeX engine such as xelatex), Python PyMuPDF for merging  
**Test Coverage:** 516+ passing tests  
**Status:** Production-ready

## Quick Start

```bash
# First-time setup
make install

# Standard workflow
make clean && make run

# Before commits (required)
make test && make lint  # Must show 516+ passing tests
```

## Project Structure & Architecture

### Directory Layout
```
src/
├── app.js                    # Entry point
├── core/                     # DI container, setup, scraper orchestration
├── services/                 # Core services (browser, page, PDF, queue, etc.)
├── config/                   # Schema, loader, validator
├── utils/                    # Logger, errors, URL helpers
└── python/                   # PyMuPDF merge scripts

tests/                        # Mirrors src/ structure
pdfs/                         # Generated artifacts (gitignored)
config.json                   # Base (shared) configuration (includes docTarget)
doc-targets/                  # Pre-configured site targets
config-profiles/              # Kindle device profiles
```

### Service Architecture

**Dependency Injection:** All services registered in `src/core/setup.js`

**Single Source of Truth Principle:**
- Each data type has ONE authoritative source to prevent conflicts
- `stateManager` → Process state only (URLs, progress, failures)
- `metadataService` → Content metadata only (titles, sections, mappings)
- Never duplicate data across services

**PDF Generation Flow:**
1. Puppeteer generates individual PDFs
2. PyMuPDF merges with bookmarks using `articleTitles.json`

## Build, Test, and Development Commands

### Core Commands
```bash
make install          # Install Node + Python deps (creates .venv via uv)
make run             # Scrape and generate PDFs
npm start            # Alternative to make run
make clean           # Remove pdfs/* and metadata
make clean-cache     # Remove translation cache and metadata (keep PDFs)
```

### Testing & Quality
```bash
npm test             # Run all Vitest tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage
make test            # Same as npm test
npm run lint         # ESLint checks
npm run lint:fix     # Auto-fix linting issues
```

### Documentation Targets
```bash
npm run docs:openai      # Set docTarget=openai
npm run docs:claude      # Set docTarget=claude-code
npm run docs:list        # List available targets
make docs-current        # Show current root/base URLs
```

### Kindle Profiles
```bash
make kindle-oasis        # Single device profile
make kindle-all          # All profiles (kindle7, paperwhite, oasis, scribe)
node scripts/use-kindle-config.js current  # Debug current config
```

### Debugging Scripts
```bash
node scripts/test-openai-access.js           # Verify anti-bot stealth bypass
node scripts/test-pdf-generation.js          # Test PDF generation configs
node scripts/inspect-collapsible.js          # Analyze collapsible DOM
node scripts/verify-expansion.js             # Validate content expansion
node scripts/inspect-selectors.js            # Check actual DOM structure
node scripts/test-config-loading.js          # Verify config validation
```

### Environment Info
```bash
make python-info         # Show Python/uv versions
npm list puppeteer-extra # Verify puppeteer installation
make clean-venv          # Remove and recreate Python .venv
```

## Code Standards & Conventions

### Language & Style
- **JavaScript:** ESM modules (`type: module`), Node.js ≥ 18.18 (required by ESLint 9.x and tooling)
- **Async patterns:** Use `async/await`, avoid callbacks
- **Indentation:** 2 spaces (JavaScript), 4 spaces (Python)
- **Naming:**
  - Variables/functions: `camelCase`
  - Classes: `PascalCase`
  - Service files: end with `Service` (e.g., `PythonMergeService.js`)
  - Manager files: end with `Manager` (e.g., `StateManager.js`)

### Error Handling
- Use custom error classes from `src/utils/errors.js`
- Available types: `NetworkError`, `ValidationError`, `ConfigurationError`, etc.

### Logging Strategy
- Use `createLogger('ServiceName')` from `src/utils/logger.js`
- Avoid raw `console` statements in application code
- **Levels:**
  - `error` - Critical failures requiring immediate attention
  - `warn` - Recoverable issues that may need investigation
  - `info` - Important operations (title extraction, PDF saves) - visible in production
  - `debug` - Verbose details only needed during development
- **Important:** Use `info` level for operations you want visible in production logs (default level)

### Linting
- Configuration: `eslint.config.js`
- Run `npm run lint` before all pull requests
- Auto-fix when possible: `npm run lint:fix`

## Testing Guidelines

### Framework & Structure
- **Framework:** Vitest
- **Location:** `tests/**/*.test.js`
- **Structure:** Mirror source directory (e.g., `src/core/setup.js` → `tests/core/setup.test.js`)

### Testing Requirements
- Write tests for all new public functions
- Cover error paths and edge cases
- Maintain 516+ passing tests before commits
- Always run `make clean` before testing to ensure clean state

### Test Workflow
```bash
# Run all tests
npm test

# Watch mode during development
npm run test:watch

# Run specific test file
npx vitest run tests/services/fileService.test.js
```

### Vitest & Open Handles（异步 / 定时器注意事项）

- 测试或被测代码里如果创建了长时间存活的定时器 / 句柄，需要**显式清理或解除对事件循环的保持**，否则 Vitest 会在结束时报：
  - `A worker process has failed to exit gracefully...`
  - 或 hanging process / unhandled errors 相关提示
- 推荐做法：
  - 对超时保护类定时器：
    - 保存 `setTimeout` 返回的 ID，在 `try/finally` 中 `clearTimeout(timeoutId)`；
    - 如只是保护性定时器，又不要求阻止进程退出，可调用 `timeoutId.unref?.()`，避免影响 Node/Vitest 进程退出。
  - 在 Vitest 测试中使用 fake timers 时（`vi.useFakeTimers()`）：
    - 测试结束前调用 `vi.useRealTimers()`；
    - 必要时配合 `vi.runAllTimers()` / `vi.advanceTimersByTime()` 来驱动定时逻辑。
- 如果遇到疑似泄漏，可用：
  - `npx vitest run --reporter=hanging-process --maxWorkers=1`
  - 或只对某个测试文件运行：`npx vitest run tests/services/translationService.test.js --reporter=hanging-process --maxWorkers=1`
  来定位具体未清理的 handle。

## Configuration

### Configuration Sources

- `config.json` holds **shared** settings (PDF/translation/markdown/etc) and a `docTarget` pointer.
- `doc-targets/*.json` holds **site-specific** settings (root/base URLs, selectors, domains, entry points, etc).
- `config-profiles/*.json` holds **device-specific** overrides (Kindle profiles) that are merged into `config.json` via scripts/Makefile.
- `docTarget` can be overridden via env var `DOC_TARGET`.

### Essential Settings

**URL Configuration:**
- `rootURL` - Starting URL for scraping (typically in `doc-targets/*.json`)
- `baseUrl` - URL prefix filter (only crawl URLs starting with this) (typically in `doc-targets/*.json`)
- `allowedDomains` - Domain whitelist array (e.g., `["platform.openai.com"]`)
- `sectionEntryPoints` - Additional root URLs for multi-section docs

**Selectors (inspect actual DOM, not SSR HTML):**
- `navLinksSelector` - CSS selector for navigation links
- `contentSelector` - CSS selector for main content area
- Use `scripts/inspect-selectors.js` to find correct selectors

**Performance:**
- `concurrency` - Number of parallel scrapers (default: 5)
- `pageTimeout` - Max navigation time in ms (default: 45000, reduce to 15000 for `domcontentloaded`)

**PDF Processing:**
- `enablePDFStyleProcessing` - Enable CSS transforms and DOM manipulation (default: false)
  - `false` - Safe for most sites, preserves original structure
  - `true` - Required for Next.js/React SPAs to remove navigation/sidebars
  - Must be defined in `src/config/configValidator.js` FIRST

**Navigation Strategy:**
- `navigationStrategy` - Page load strategy (default: `auto`)
  - `auto` - Try strategies in order: `domcontentloaded` → `networkidle2` → `networkidle0` → `load`
  - `domcontentloaded` - Best for SSR/static sites (fastest)
  - `load` - Best for Next.js/React SPAs (avoid timeout retries)
  - `networkidle2` - Fallback for moderate background requests
  - `networkidle0` - Avoid (fails with analytics/websockets)

**Markdown Source (optional):**
- `markdownSource.enabled` - When true, try fetching `url + urlSuffix` as raw markdown before falling back to DOM → Markdown.
- `markdownSource.urlSuffix` - Suffix appended to page URL (default: `.md`).

### Configuration Validation Workflow

⚠️ **CRITICAL - Prevents silent failures:**
1. Add field to `src/config/configValidator.js` Joi schema FIRST
2. Then add to the appropriate config file (`config.json`, `doc-targets/*.json`, or `config-profiles/*.json`)
3. Test with `node scripts/test-config-loading.js`
4. Verify field appears with correct type (not undefined)

**Why:** Fields not in Joi schema are silently removed during validation (`stripUnknown: true`)

## Security & Best Practices

### Security
- Use `validateSafePath()` for all file operations
- Never commit secrets or API keys
- Validate all configuration inputs
- Keep `allowedDomains` strict
- Default headless browser recommended

### Performance
- Respect `concurrency` setting to avoid overwhelming target sites
- Monitor PDF merger memory usage
- Implement `dispose()` methods in services for proper cleanup

### Git Workflow
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`)
- **Before commits:** `make test && make lint` (require 516+ passing)
- **Pull requests:** Include clear description, linked issues, reproduction notes, before/after logs

### Ignored Files
- Do not commit: PDFs, logs, or virtual env directories (`.venv/`) (already in `.gitignore`)

## Common Workflows

### Adding a New Documentation Target

1. **Inspect the site:**
   ```bash
   node scripts/inspect-selectors.js
   ```

2. **Create config file:**
   ```bash
   # Create doc-targets/new-site.json
   {
     "rootURL": "https://example.com/docs",
     "baseUrl": "https://example.com/docs",
     "navLinksSelector": "nav a, aside a",
     "contentSelector": "main, article",
     "allowedDomains": ["example.com"],
     "enablePDFStyleProcessing": false,
     "navigationStrategy": "auto"
   }
   ```

3. **Test anti-bot bypass:**
   ```bash
   node scripts/test-openai-access.js
   ```

4. **Run scraper:**
   ```bash
   node scripts/use-doc-target.js use new-site
   # or one-off:
   # DOC_TARGET=new-site npm start
   make clean && make run
   ```

### Adding a New Configuration Option

1. **Add to Joi schema** in `src/config/configValidator.js`:
   ```javascript
   myNewOption: Joi.boolean().default(false).description('What it does'),
   ```

2. **Update config files** as needed (`config.json`, `doc-targets/*.json`, or `config-profiles/*.json`)

3. **Verify:**
   ```bash
   node scripts/test-config-loading.js
   # Should show myNewOption with correct type
   ```

### Scraping Workflow

**Critical order:** Scrape FIRST (collects titles) → Then merge (needs `articleTitles.json` for TOC)

1. **Clean previous run:**
   ```bash
   make clean
   ```

2. **Run scraper:**
   ```bash
   make run
   ```

3. **Verify output:**
   - Individual PDFs: `001-page-name.pdf` (zero-padded)
   - Merged PDF: `docs.example.com_YYYYMMDD.pdf`
   - Metadata: `pdfs/metadata/articleTitles.json` should be >1KB with actual titles

### Creating Kindle-Optimized PDFs

```bash
# Single device
make kindle-oasis

# All devices
make kindle-all  # Generates PDFs for kindle7, paperwhite, oasis, scribe


# Check current config
node scripts/use-kindle-config.js current
```

## Troubleshooting & Known Issues

### Configuration Issues
- **Problem**: Configuration field is `undefined` at runtime.
- **Cause**: Joi validation strips unknown fields by default (`stripUnknown: true`).
- **Fix**: You MUST define the field in `src/config/configValidator.js` BEFORE adding it to JSON files.

### Service State Conflicts
- **Problem**: Table of Contents (TOC) or titles are missing/wrong in merged PDF.
- **Cause**: Conflict between `stateManager` and `metadataService`.
- **Fix**: adherence to SSOT. `metadataService` is the ONLY truth for content metadata (titles, sections). `stateManager` only tracks process state (URLs visited).

### Progress/Retry Consistency
- **Problem**: `progress.json` shows the same URL in both processed and failed sets, retry statistics become unstable, or retry loops include already-processed URLs.
- **Cause**:
  - State transitions are not strictly disjoint across retries.
  - Historical failed records are not cleared after a URL is successfully processed.
- **Fixes**:
  - Keep `processedUrls` and `failedUrls` disjoint in `stateManager` load/save paths (sanitize on read and write).
  - In retry flow (`scraper.retryFailedUrls`), treat "failed but already processed" as stale:
    - skip retry for that URL,
    - clear failed record immediately.
  - Add regression tests in both `tests/services/stateManager.test.js` and `tests/core/scraper.test.js`.

### Progress Metrics Semantics (Critical)
- **Definitions (must stay stable):**
  - `succeeded`: URLs with final status `success`.
  - `processed`: URLs with terminal status (`success` + `failed` + `skipped`).
- **Rule**: Never use `processed` as "success count" when reporting success rate.
- **Implementation notes**:
  - `progressTracker.getStats()` should expose both `succeeded` and `processed`.
  - `scraper.run()` completion logs must compute `成功数/成功率` from `succeeded`.
  - `app.runScraping()` should pass through normalized stats to avoid ambiguous downstream interpretation.
- **Quick verification**:
  - Compare final `爬取任务完成` summary and `=== 爬虫运行完成 ===` log block.
  - Their success metrics must be consistent for the same run.

### PDF Generation & Pandoc
- **Problem**: Code blocks run off the page or tables render as raw text.
- **Cause**:
  - Long lines without breaks.
  - Indentation in Markdown (Pandoc treats indented blocks inside HTML as code).
- **Fixes**:
  - **Overflow**: `src/services/pandocPdfService.js` uses `xurl` and disables `breakanywhere` inside critical tags if needed.
  - **Tables**: Ensure empty lines before/after tables.
  - **Indentation**: Remove indentation for `<table>` or custom components inside HTML wrappers to prevent "code block" rendering.
  - **Ltablex**: Do NOT use `ltablex` if it causes column overflow; we use standard tabular environments or calibrated widths.

### Visual Glitches
- **Problem**: Floating headers/footers appear in PDF.
- **Fix**: Use `enablePDFStyleProcessing: true` and configure `hideSelectors` in `doc-targets/*.json` to remove fixed-position elements.
