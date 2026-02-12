# Documentation PDF Scraper

A professional web scraper and PDF generator that converts documentation websites into high-quality PDF files. It supports both **live website scraping** and **local Markdown-to-PDF conversion**, featuring modular architecture and device-optimized output (Kindle/Tablets).

## Features

- **Dual Modes**:
    - 🕷️ **Web Scraper**: Intelligent crawling of documentation sites using Puppeteer.
    - 📄 **Batch Markdown**: Direct high-fidelity PDF generation from local Markdown files.
- **Device Optimization**: Specialized layout presets for Kindle (7", Paperwhite, Oasis, Scribe).
- **Multi-Target Support**: Built-in configs for common docs (OpenAI, Claude, Anthropic) + custom targets.
- **Smart Formatting**:
    - Preserves original styling while ensuring readability.
    - Handles wide tables, code blocks, and complex layouts.
    - **LaTeX-enhanced** PDF generation (via Pandoc) for professional typography.
- **Modular Architecture**: Dependency injection, parallel processing, and robust error handling.

## Quick Start

### Installation

```bash
# Install all dependencies (Node.js + Python via uv)
make install
```

### Prerequisites
- Node.js >= 18.0.0
- Python >= 3.8 (for PDF processing)
- uv (Python package/environment manager)
- Pandoc (required for Markdown-to-PDF conversion)

## Usage

### Mode 1: Web Scraping

Scrape a documentation website and convert it to PDF.

```bash
# 1. Select a target (e.g., OpenAI docs)
npm run docs:openai

# 2. Run the scraper
make clean && make run
```

### Mode 2: Batch Markdown PDF

Generate a PDF directly from a folder of Markdown files (bypassing the scraper).

1. Place your `.md` files in `pdfs/markdown` (or configure `markdownPdf.sourceDir`).
2. Ensure `config.json` has `markdownPdf: { "batchMode": true }`.
3. Run:

```bash
# Run in batch mode
make run
```

### device Optimization (Kindle)

Generate PDFs optimized for specific e-readers:

```bash
make kindle7           # Kindle 7-inch
make kindle-paperwhite # Kindle Paperwhite
make kindle-oasis      # Kindle Oasis
make kindle-scribe     # Kindle Scribe
```

## Configuration

### Base Configuration (`config.json`)

The core configuration file. `docTarget` determines which target-specific config is merged in.

```json
{
  "docTarget": "openai",        // Active documentation target
  "pdfDir": "pdfs",             // Output directory
  "concurrency": 5,             // Scraping concurrency
  "markdownPdf": {
    "enabled": true,
    "batchMode": false,         // Set true to skip scraping and use local MD files
    "outputDir": "markdown"     // Directory for intermediate/source MD files
  }
}
```

### Documentation Targets (`doc-targets/*.json`)

Target-specific configurations (URLs, selectors, etc.) are stored in `doc-targets/`.

**Example (`doc-targets/openai.json`):**
```json
{
  "rootURL": "https://platform.openai.com/docs",
  "matchPatterns": ["https://platform.openai.com/docs/**"],
  "contentSelector": ".docs-body",
  "navLinksSelector": ".docs-nav a"
}
```

**Manage Targets via CLI:**
```bash
npm run docs:openai      # Switch to OpenAI config
npm run docs:claude      # Switch to Claude Code config
npm run docs:current     # Show current target info
npm run docs:list        # List all available targets
```

## Architecture

The project uses a **Dependency Injection (DI)** container for modularity:

- **Core**: `Application`, `PythonRunner`
- **Services**:
    - `Scraper`: Puppeteer-based crawler.
    - `MarkdownToPdfService`: Handles Markdown -> PDF conversion via Pandoc/LaTeX.
    - `PythonMergeService`: Merges multiple PDFs using PyMuPDF.

## Development

```bash
# Run tests
make test

# Lint code
make lint

# Check Python environment
make python-info
```

## License

ISC License
