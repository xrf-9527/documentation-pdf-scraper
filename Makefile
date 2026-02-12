# Makefile for Next.js PDF Documentation Scraper

UV = uv
UV_ENV_DIR = .venv
UV_PYTHON = $(UV_ENV_DIR)/bin/python
NODE_MODULES = node_modules

.PHONY: help install install-python install-node venv clean-venv clean clean-all clean-cache run run-clean test demo lint lint-fix ci verify-openclaw verify-openclaw-ci check-venv python-info kindle7 kindle-paperwhite kindle-oasis kindle-scribe kindle-all reset-config list-configs clean-kindle docs-openai docs-claude docs-openclaw docs-cloudflare docs-anthropic docs-53ai docs-claude-blog docs-current

help:
	@echo "Available commands:"
	@echo "  install        - Install all dependencies (Python + Node.js)"
	@echo "  install-python - Create uv virtual environment and install Python dependencies"
	@echo "  install-node   - Install Node.js dependencies"
	@echo "  venv          - Create uv-managed Python virtual environment"
	@echo "  clean-venv    - Remove and recreate uv Python virtual environment"
	@echo "  run           - Generate PDF documentation"
	@echo "  run-clean     - Clean output and generate PDF documentation"
	@echo "  test          - Run tests"
	@echo "  lint          - Run linter"
	@echo "  verify-openclaw - Verify openclaw zh-CN targetUrls coverage against sitemap"
	@echo "  ci            - Run CI checks (test + lint + verify-openclaw-ci)"
	@echo "  clean         - Clean generated PDFs and metadata"
	@echo "  clean-cache   - Clean translation cache and metadata (keep PDFs)"
	@echo "  clean-all     - Clean everything including dependencies"
	@echo ""
	@echo "Kindle PDF optimization:"
	@echo "  kindle7           - Generate PDFs for Kindle 7-inch"
	@echo "  kindle-paperwhite - Generate PDFs for Kindle Paperwhite"
	@echo "  kindle-oasis      - Generate PDFs for Kindle Oasis"
	@echo "  kindle-scribe     - Generate PDFs for Kindle Scribe"
	@echo "  kindle-all        - Generate PDFs for all Kindle devices"
	@echo "  reset-config      - Reset to base configuration"
	@echo "  list-configs      - List all available configurations"
	@echo "  clean-kindle      - Clean Kindle PDF files"
	@echo ""
	@echo "Doc targets:"
	@echo "  docs-openai       - Apply OpenAI docs configuration"
	@echo "  docs-claude       - Apply Claude Code docs configuration"
	@echo "  docs-openclaw     - Apply OpenClaw zh-CN docs configuration"
	@echo "  docs-cloudflare   - Apply Cloudflare Blog configuration"
	@echo "  docs-anthropic    - Apply Anthropic Research configuration"
	@echo "  docs-53ai         - Apply 53ai configuration"
	@echo "  docs-claude-blog  - Apply Claude Blog configuration"
	@echo "  docs-current      - Show current doc configuration"

# Create Python virtual environment with uv
venv:
	@echo "\033[0;34m=== Creating uv Python Virtual Environment ===\033[0m"
	@if ! command -v $(UV) >/dev/null 2>&1; then \
		echo "\033[0;31mError: uv not found\033[0m"; \
		echo "\033[1;33mInstall uv from https://github.com/astral-sh/uv\033[0m"; \
		exit 1; \
	fi
	@if [ ! -f "pyproject.toml" ]; then \
		echo "\033[0;31mError: pyproject.toml not found in current directory\033[0m"; \
		exit 1; \
	fi
	@if [ -d "$(UV_ENV_DIR)" ]; then \
		echo "\033[1;33mVirtual environment already exists at $(UV_ENV_DIR)\033[0m"; \
		echo "\033[1;33mRun 'make clean-venv' first to recreate it\033[0m"; \
	else \
		echo "\033[0;34mCreating virtual environment at $(UV_ENV_DIR)...\033[0m"; \
		$(UV) venv $(UV_ENV_DIR) || (echo "\033[0;31mFailed to create virtual environment\033[0m"; exit 1); \
		echo "\033[0;32m✅ Virtual environment created successfully!\033[0m"; \
	fi

# Install Python dependencies in virtual environment
install-python: venv
	@echo "\033[0;34m=== Installing Python Dependencies ===\033[0m"
	@echo "\033[0;34mSyncing dependencies with uv...\033[0m"
	@$(UV) sync --locked
	@echo "\033[0;32m✅ Python dependencies installed successfully!\033[0m"
	@echo "\033[0;34m=== Usage Instructions ===\033[0m"
	@echo "\033[1;33m1. Activate virtual environment:\033[0m source .venv/bin/activate"
	@echo "\033[1;33m2. Run the project:\033[0m make run"
	@echo "\033[1;33m3. Deactivate virtual environment:\033[0m deactivate"

# Install Node.js dependencies
install-node:
	@echo "Installing Node.js dependencies..."
	npm install
	@echo "Node.js dependencies installed successfully"

# Install all dependencies
install: install-python install-node
	@echo "All dependencies installed successfully"

# Generate PDF documentation
run:
	@echo "Generating PDF documentation..."
	npm start

# Clean output and generate PDF documentation
run-clean:
	@echo "Cleaning output and generating PDF documentation..."
	npm run start:clean

# Run tests
test:
	@echo "Running tests..."
	npm test

# Run demo
demo:
	@echo "Running demo..."
	npm run test:demo

# Run linter
lint:
	@echo "Running linter..."
	npm run lint

# Verify OpenClaw zh-CN target URLs coverage
verify-openclaw:
	@echo "Verifying OpenClaw zh-CN target URL coverage..."
	npm run docs:openclaw:verify

# Verify OpenClaw zh-CN target URLs coverage (allow network fetch failures in CI)
verify-openclaw-ci:
	@echo "Verifying OpenClaw zh-CN target URL coverage (CI mode)..."
	OPENCLAW_VERIFY_ALLOW_FETCH_FAILURE=1 npm run docs:openclaw:verify

# CI checks
ci: test lint verify-openclaw-ci
	@echo "✅ CI checks passed"

# Fix linting issues
lint-fix:
	@echo "Fixing linting issues..."
	npm run lint:fix

# Clean and recreate Python virtual environment
clean-venv:
	@echo "\033[1;33mRemoving existing Python virtual environment...\033[0m"
	@rm -rf $(UV_ENV_DIR)
	@echo "\033[0;32mVirtual environment removed\033[0m"
	@$(MAKE) install-python

# Clean generated files
clean:
	@echo "Cleaning generated PDFs and metadata..."
	npm run clean

# Clean caches and metadata without removing generated PDFs
clean-cache:
	@echo "Cleaning translation cache and metadata (keeping PDFs)..."
	rm -rf .temp
	rm -rf pdfs/metadata/*

# Clean all generated files and dependencies
clean-all: clean
	@echo "Removing Python virtual environment..."
	rm -rf $(UV_ENV_DIR)
	@echo "Removing Node.js dependencies..."
	rm -rf $(NODE_MODULES)
	@echo "All dependencies and generated files removed"

# Check if virtual environment exists
check-venv:
	@if [ ! -d "$(UV_ENV_DIR)" ]; then \
		echo "Virtual environment not found. Run 'make install-python' first."; \
		exit 1; \
	fi

# Show Python environment info
python-info: check-venv
	@echo "Python virtual environment info (uv):"
	@echo "uv version: $$($(UV) --version)"
	@echo "Python executable: $(UV_PYTHON)"
	@echo "Python version: $$($(UV_PYTHON) --version)"
	@echo "Installed packages:"
	@$(UV) pip list --python $(UV_PYTHON)

# Kindle PDF optimization commands
CONFIG_SCRIPT = scripts/use-kindle-config.js
DOC_TARGET_SCRIPT = scripts/use-doc-target.js

# Generate PDFs for Kindle 7-inch
kindle7:
	@set -e; \
	backup_file=$$(mktemp); \
	cp config.json "$$backup_file"; \
	trap 'cp "$$backup_file" config.json >/dev/null 2>&1; rm -f "$$backup_file"' EXIT; \
	echo "🔧 切换到Kindle 7英寸配置..."; \
	node $(CONFIG_SCRIPT) use kindle7; \
	echo "🧹 清理旧文件..."; \
	rm -rf pdfs/finalPdf-kindle7; \
	echo "📄 生成Kindle 7英寸优化PDF..."; \
	node src/app.js; \
	echo "✅ Kindle 7英寸PDF生成完成"; \
	echo "📍 PDF位置: pdfs/finalPdf-kindle7/"

# Generate PDFs for Kindle Paperwhite
kindle-paperwhite:
	@set -e; \
	backup_file=$$(mktemp); \
	cp config.json "$$backup_file"; \
	trap 'cp "$$backup_file" config.json >/dev/null 2>&1; rm -f "$$backup_file"' EXIT; \
	echo "🔧 切换到Kindle Paperwhite配置..."; \
	node $(CONFIG_SCRIPT) use paperwhite; \
	echo "🧹 清理旧文件..."; \
	rm -rf pdfs/finalPdf-paperwhite; \
	echo "📄 生成Kindle Paperwhite优化PDF..."; \
	node src/app.js; \
	echo "✅ Kindle Paperwhite PDF生成完成"; \
	echo "📍 PDF位置: pdfs/finalPdf-paperwhite/"

# Generate PDFs for Kindle Oasis
kindle-oasis:
	@set -e; \
	backup_file=$$(mktemp); \
	cp config.json "$$backup_file"; \
	trap 'cp "$$backup_file" config.json >/dev/null 2>&1; rm -f "$$backup_file"' EXIT; \
	echo "🔧 切换到Kindle Oasis配置..."; \
	node $(CONFIG_SCRIPT) use oasis; \
	echo "🧹 清理旧文件..."; \
	rm -rf pdfs/finalPdf-oasis; \
	echo "📄 生成Kindle Oasis优化PDF..."; \
	node src/app.js; \
	echo "✅ Kindle Oasis PDF生成完成"; \
	echo "📍 PDF位置: pdfs/finalPdf-oasis/"

# Generate PDFs for Kindle Scribe
kindle-scribe:
	@set -e; \
	backup_file=$$(mktemp); \
	cp config.json "$$backup_file"; \
	trap 'cp "$$backup_file" config.json >/dev/null 2>&1; rm -f "$$backup_file"' EXIT; \
	echo "🔧 切换到Kindle Scribe配置..."; \
	node $(CONFIG_SCRIPT) use scribe; \
	echo "🧹 清理旧文件..."; \
	rm -rf pdfs/finalPdf-scribe; \
	echo "📄 生成Kindle Scribe优化PDF..."; \
	node src/app.js; \
	echo "✅ Kindle Scribe PDF生成完成"; \
	echo "📍 PDF位置: pdfs/finalPdf-scribe/"

# Generate PDFs for all Kindle devices
kindle-all: kindle7 kindle-paperwhite kindle-oasis kindle-scribe
	@echo "🎉 所有Kindle设备PDF生成完成！"
	@echo ""
	@echo "生成的PDF文件："
	@echo "  - pdfs/finalPdf-kindle7/"
	@echo "  - pdfs/finalPdf-paperwhite/"
	@echo "  - pdfs/finalPdf-oasis/"
	@echo "  - pdfs/finalPdf-scribe/"

# Documentation target helpers
docs-openai:
	@node $(DOC_TARGET_SCRIPT) use openai

docs-claude:
	@node $(DOC_TARGET_SCRIPT) use claude-code

docs-openclaw:
	@node $(DOC_TARGET_SCRIPT) use openclaw

docs-cloudflare:
	@node $(DOC_TARGET_SCRIPT) use cloudflare-blog

docs-anthropic:
	@node $(DOC_TARGET_SCRIPT) use anthropic-research

docs-53ai:
	@node $(DOC_TARGET_SCRIPT) use 53ai

docs-claude-blog:
	@node $(DOC_TARGET_SCRIPT) use claude-blog

docs-current:
	@node $(DOC_TARGET_SCRIPT) current
	@echo ""
	@echo "请将这些PDF传输到相应设备进行验证"

# Reset to base configuration
reset-config:
	@echo "🔄 重置为基础配置..."
	@node $(CONFIG_SCRIPT) reset
	@echo "✅ 配置已重置"

# List all configurations
list-configs:
	@node $(CONFIG_SCRIPT) list

# Clean Kindle PDF files
clean-kindle:
	@echo "🧹 清理所有Kindle PDF文件..."
	@rm -rf pdfs/finalPdf-kindle7
	@rm -rf pdfs/finalPdf-paperwhite
	@rm -rf pdfs/finalPdf-oasis
	@rm -rf pdfs/finalPdf-scribe
	@echo "✅ 清理完成"
