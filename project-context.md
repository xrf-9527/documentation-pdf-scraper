---
project_name: 'Documentation PDF Scraper'
created_date: '2025-12-17'
bmad_version: 'v6'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

**Related Documentation:**
- **AGENTS.md** - Complete project guide (single source of truth for architecture, commands, workflows)
- **CLAUDE.md** - Quick reference for AI agents
- **This file** - Critical implementation rules optimized for LLM context

---

## Technology Stack & Versions

### Core Technologies
- **Runtime:** Node.js >= 18.18 (required by ESLint 9.x)
- **Module System:** ESM (`type: "module"` in package.json)
- **Browser Automation:** Puppeteer-extra with stealth plugin
- **PDF Processing:** Pandoc CLI with xelatex engine
- **PDF Merging:** Python PyMuPDF (fitz)
- **Testing:** Vitest (516+ tests required)

### Critical Version Requirements
- Node.js 18.18+ is MANDATORY for ESLint 9.x compatibility
- Always use `async/await`, never callbacks
- All imports MUST use ESM syntax (no `require()`)

---

## Critical Implementation Rules

### 1. Configuration Validation - MOST COMMON PITFALL

**CRITICAL:** Fields MUST be added to Joi schema BEFORE adding to config files.

**Correct Order (NEVER deviate):**
1. Add field to `src/config/configValidator.js` Joi schema
2. Add field to config JSON files (`config.json` or `doc-targets/*.json`)
3. Test with `node scripts/test-config-loading.js`
4. Verify field is NOT undefined at runtime

**Why:** Joi validation uses `stripUnknown: true`, silently removing unknown fields.

**Example:**
```javascript
// Step 1: Add to configValidator.js FIRST
myNewOption: Joi.boolean().default(false).description('What it does'),

// Step 2: Then add to config.json
{
  "myNewOption": true
}

// Step 3: Verify
node scripts/test-config-loading.js
```

### 2. Single Source of Truth (SSOT) - Service State Management

**CRITICAL:** Each data type has ONE authoritative source.

| Service | Owns | Does NOT Own |
|---------|------|--------------|
| `stateManager` | Process state (URLs visited, progress, failures) | Content metadata |
| `metadataService` | Content metadata (titles, sections, TOC) | Process state |

**Never duplicate data between services.** Always query the authoritative source.

**Common Bug:** Using stateManager for article titles → Wrong! Use `metadataService.getArticleTitle(url)`

### 3. PDF Generation Workflow - Order Matters

**CRITICAL:** Scrape FIRST, then merge. Never reverse.

**Why:** Merge requires `articleTitles.json` from scraper for TOC generation.

**Correct Workflow:**
```bash
make clean              # 1. Clean previous run
make run               # 2. Scrape (generates articleTitles.json)
                       # 3. Auto-merge (uses articleTitles.json)
```

**File to verify:** `pdfs/metadata/articleTitles.json` must be >1KB with actual titles (not "Article 1", "Article 2")

### 4. Pandoc LaTeX Configuration - Code Block Overflow

**Known Issue:** Long code lines run off page in PDF.

**Solution Applied:** `src/services/pandocPdfService.js` uses:
- `\usepackage{xurl}` for URL breaking
- Disabled `breakanywhere` inside critical tags
- Careful indentation management (indented HTML = code block in Pandoc)

**When modifying:** Test with long code samples and wide tables.

### 5. Logging Levels - Production Visibility

**IMPORTANT:** Use correct log levels for production visibility.

| Level | When to Use | Visible in Production? |
|-------|-------------|----------------------|
| `error` | Critical failures | ✅ Yes |
| `warn` | Recoverable issues | ✅ Yes |
| `info` | Important operations (titles, PDF saves) | ✅ Yes (default level) |
| `debug` | Verbose development details | ❌ No |

**Never use raw `console.*` in application code.** Always use `createLogger('ServiceName')`.

**Production Default:** `info` level. Use `info` for anything you want visible in production logs.

### 6. Test Requirements - Pre-commit Gate

**MANDATORY before commits:**
```bash
make clean && make test && make lint
```

**Acceptance Criteria:**
- 516+ tests passing (exact count may vary slightly)
- Zero linting errors
- Always `make clean` before testing

**Vitest Warnings:** If you see "open handles" warnings:
- Call `clearTimeout(timeoutId)` in finally blocks
- Use `timeoutId.unref?.()` for protective timers
- Call `vi.useRealTimers()` after fake timer tests

### 7. Anti-Bot Bypass - Puppeteer Stealth

**Critical for sites like platform.openai.com:**
- Use `puppeteer-extra` with `puppeteer-extra-plugin-stealth`
- Never disable stealth plugins
- Test access with `node scripts/test-openai-access.js`

**If bot detection triggers:**
1. Check stealth plugin is loaded
2. Verify user agent is recent
3. Consider `headless: false` for debugging

### 8. DOM Selector Discovery - Runtime vs SSR

**CRITICAL:** SSR HTML ≠ Runtime DOM

**Wrong Approach:**
```bash
curl https://site.com | grep selector  # SSR HTML, often wrong
```

**Correct Approach:**
```bash
node scripts/inspect-selectors.js  # Puppeteer renders runtime DOM
```

**Why:** Many docs sites use React/Next.js with client-side rendering. Selectors must match the RENDERED DOM, not SSR HTML.

### 9. Navigation Strategy Configuration

**Auto Strategy Recommended:**
```json
{
  "navigationStrategy": "auto"
}
```

**Auto tries in order:**
1. `domcontentloaded` (fastest, SSR sites)
2. `networkidle2` (moderate background requests)
3. `networkidle0` (avoid - fails with analytics)
4. `load` (fallback for SPAs)

**For Next.js/React SPAs:** Use `"load"` directly to skip retry delays.

**Never use:** `networkidle0` (fails with analytics/websockets)

### 10. Error Handling - Custom Error Classes

**Always use custom errors from `src/utils/errors.js`:**
- `NetworkError` - Network/HTTP failures
- `ValidationError` - Invalid input/config
- `ConfigurationError` - Config issues
- `FileOperationError` - File I/O errors

**Prefer throwing custom errors in services.** Use generic `Error` only for internal invariants or when no specific type fits.

### 11. File Security - Path Validation

**Path safety pattern (see `scripts/use-doc-target.js`):**
```javascript
import path from 'path';

function assertPathInsideDirectory(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path (outside ${resolvedBase}): ${targetPath}`);
  }

  return resolvedTarget;
}
```

**Never trust user-provided paths without validation.**

---

## Code Style Conventions

### Naming Patterns
- **Variables/Functions:** `camelCase`
- **Classes:** `PascalCase`
- **Service Files:** Must end with `Service` (e.g., `PdfService.js`)
- **Manager Files:** Must end with `Manager` (e.g., `StateManager.js`)

### Indentation
- **JavaScript:** 2 spaces
- **Python:** 4 spaces
- **No tabs**

### Async Patterns
- Always `async/await`
- Never callbacks
- Always handle promise rejections

---

## Testing Patterns

### Service Tests
- Mirror source structure: `src/core/setup.js` → `tests/core/setup.test.js`
- Mock external dependencies (browser, filesystem, network)
- Test both success and error paths
- Clean up resources in `afterEach`

### Timer Management
```javascript
// Protective timeout pattern
const timeoutId = setTimeout(() => {
  // timeout logic
}, 5000);
timeoutId.unref?.(); // Don't block process exit

// Always clean up
try {
  // async operation
} finally {
  clearTimeout(timeoutId);
}
```

---

## Common Pitfalls & Solutions

| Pitfall | Solution | How to Verify |
|---------|----------|---------------|
| Config field is `undefined` | Add to Joi schema FIRST | `node scripts/test-config-loading.js` |
| TOC missing in merged PDF | Scrape before merge | Check `articleTitles.json` size >1KB |
| Wrong selectors from curl | Use Puppeteer inspector | `node scripts/inspect-selectors.js` |
| Code blocks overflow PDF | Already handled in `pandocPdfService.js` | Test with long samples |
| Vitest open handles warning | Clear timers, use `unref()` | `npm test -- --reporter=hanging-process --maxWorkers=1` |
| Wrong service for titles | Use `metadataService` only | Follow SSOT table above |

---

## Documentation Sources

For detailed information, always consult:
1. **AGENTS.md** - Authoritative guide (architecture, commands, config, troubleshooting)
2. **This file** - Critical AI agent rules and pitfalls
3. **CLAUDE.md** - Quick start pointer to AGENTS.md

**Avoid duplicating `AGENTS.md`.** If anything conflicts, treat `AGENTS.md` as canonical; this file is a fast checklist of non-obvious pitfalls.

---

## Quick Decision Tree

**Adding a config field?**
→ Joi schema FIRST, then JSON

**Getting article metadata?**
→ Use `metadataService`, never `stateManager`

**PDF TOC is wrong?**
→ Run scraper BEFORE merge

**Selector not working?**
→ Use Puppeteer inspector, not curl

**Need production logs?**
→ Use `logger.info()`, not `logger.debug()`

**Pre-commit checklist?**
→ `make clean && make test && make lint`

---

_This file is optimized for AI agent context efficiency. For comprehensive project documentation, see AGENTS.md._
