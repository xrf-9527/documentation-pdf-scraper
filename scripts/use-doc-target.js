#!/usr/bin/env node

/**
 * 文档站点配置切换脚本
 * 用于在不同的文档来源之间快速切换（OpenAI / Claude Code 等）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const CONFIG_FILE = path.resolve(rootDir, 'config.json');
const TARGETS_DIR = path.resolve(rootDir, 'doc-targets');

const DOC_TARGETS = {
  openai: 'openai-docs.json',
  openclaw: 'openclaw-zh-cn.json',
  'claude-code': 'claude-code.json',
  'cloudflare-blog': 'cloudflare-blog.json',
  'anthropic-research': 'anthropic-research.json',
  'claude-blog': 'claude-blog.json',
};

function validateSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(rootDir, resolved);
  return !(relative.startsWith('..') || path.isAbsolute(relative));
}

function assertPathInsideDirectory(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path (outside ${resolvedBase}): ${targetPath}`);
  }
}

function isReadableFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function resolveDocTargetConfigPath(docTarget) {
  const trimmed = String(docTarget || '').trim();
  if (!trimmed) {
    throw new Error('docTarget 不能为空');
  }

  const looksLikePath =
    trimmed.includes('/') || trimmed.includes('\\') || trimmed.toLowerCase().endsWith('.json');

  if (looksLikePath) {
    const resolvedPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(rootDir, trimmed);
    if (!validateSafePath(resolvedPath)) {
      throw new Error(`无效的站点配置路径: ${trimmed}`);
    }
    if (!isReadableFile(resolvedPath)) {
      throw new Error(`站点配置文件不存在: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  // 1) 允许 doc-targets/<name>.json
  const directPath = path.resolve(TARGETS_DIR, `${trimmed}.json`);
  assertPathInsideDirectory(TARGETS_DIR, directPath);
  if (isReadableFile(directPath)) {
    return directPath;
  }

  // 2) 向后兼容：使用别名映射（如 openai -> openai-docs.json）
  const mappedFileName = DOC_TARGETS[trimmed];
  if (mappedFileName) {
    const mappedPath = path.resolve(TARGETS_DIR, mappedFileName);
    assertPathInsideDirectory(TARGETS_DIR, mappedPath);
    if (isReadableFile(mappedPath)) {
      return mappedPath;
    }
  }

  throw new Error(`Doc target config not found for: ${trimmed}`);
}

function deepMerge(target, source) {
  if (!target || typeof target !== 'object') target = {};
  if (!source || typeof source !== 'object') return target;

  const result = { ...target };

  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] || {}, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function validateConfigStructure(config) {
  const requiredFields = ['rootURL', 'baseUrl', 'pdfDir'];
  return requiredFields.every((field) => typeof config[field] === 'string' && config[field].trim());
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stripDocSpecificConfig(config) {
  const cleaned = { ...config };

  // 这些字段应由 doc-targets/*.json 提供，config.json 仅保留公共配置
  const docSpecificKeys = [
    'rootURL',
    'baseUrl',
    'navLinksSelector',
    'paginationSelector',
    'maxPaginationPages',
    'contentSelector',
    'removeSelectors',
    'sectionEntryPoints',
    'sectionTitles',
    'targetUrls',
    'ignoreURLs',
    'allowedDomains',
    'enablePDFStyleProcessing',
    'navigationStrategy',
    'markdownSource',
  ];

  for (const key of docSpecificKeys) {
    delete cleaned[key];
  }

  return cleaned;
}

function showHelp() {
  console.log(`
文档站点配置切换工具

用法:
  node scripts/use-doc-target.js <command> [target]

命令:
  use <target>    设置 config.json 的 docTarget (别名或 doc-targets/<name>.json)
  list            列出可用站点
  current         显示当前根URL和域名
  help            查看帮助

示例:
  node scripts/use-doc-target.js use claude-code
  node scripts/use-doc-target.js use openai
  node scripts/use-doc-target.js use openai-docs
  node scripts/use-doc-target.js use doc-targets/new-site.json
  node scripts/use-doc-target.js current
  `);
}

function listTargets() {
  console.log('可用文档站点配置:');
  console.log('\n别名（推荐）:');
  for (const [key, file] of Object.entries(DOC_TARGETS)) {
    console.log(`  - ${key} (${file})`);
  }

  console.log('\ndoc-targets/*.json:');
  try {
    const files = fs
      .readdirSync(TARGETS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const name = path.basename(file, '.json');
      console.log(`  - ${name}`);
    }
  } catch {
    console.log('  (无法读取 doc-targets 目录)');
  }
}

function showCurrentConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('❌ 找不到 config.json');
    process.exit(1);
  }

  const baseConfig = readJSON(CONFIG_FILE);
  const docTarget = baseConfig.docTarget;

  let config = baseConfig;
  if (typeof docTarget === 'string' && docTarget.trim()) {
    try {
      const targetFile = resolveDocTargetConfigPath(docTarget.trim());
      const targetConfig = readJSON(targetFile);
      config = deepMerge(baseConfig, targetConfig);
    } catch (error) {
      console.warn(`⚠️  docTarget 配置解析失败: ${error.message}`);
    }
  }

  console.log('\n当前文档配置:');
  console.log(`  Doc Target    : ${docTarget || '(未设置)'}`);
  console.log(`  Root URL      : ${config.rootURL}`);
  console.log(`  Base URL      : ${config.baseUrl || '(未设置)'}`);
  console.log(
    `  允许域名       : ${Array.isArray(config.allowedDomains) ? config.allowedDomains.join(', ') : '(未设置)'}`
  );
  const entryPoints = Array.isArray(config.sectionEntryPoints)
    ? config.sectionEntryPoints.length
    : 0;
  console.log(`  额外入口数量   : ${entryPoints}`);
  console.log(`  内容选择器     : ${config.contentSelector || '(未设置)'}`);
  console.log(
    `  样式处理       : enablePDFStyleProcessing=${config.enablePDFStyleProcessing === true ? 'true' : 'false'}`
  );
  console.log('');
}

function useTarget(targetName) {
  if (!validateSafePath(CONFIG_FILE)) {
    console.error('❌ 无效的配置文件路径');
    process.exit(1);
  }

  let targetFile;
  try {
    targetFile = resolveDocTargetConfigPath(targetName);
  } catch (error) {
    console.error(`❌ 未知站点: ${targetName}`);
    console.error(`   ${error.message}`);
    listTargets();
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('❌ 基础配置文件不存在');
    process.exit(1);
  }

  if (!fs.existsSync(targetFile)) {
    console.error(`❌ 站点配置文件不存在: ${targetFile}`);
    process.exit(1);
  }

  const baseConfig = stripDocSpecificConfig(readJSON(CONFIG_FILE));
  const targetConfig = readJSON(targetFile);
  const updatedBaseConfig = { ...baseConfig, docTarget: String(targetName).trim() };
  const mergedConfig = deepMerge(updatedBaseConfig, targetConfig);

  if (!validateConfigStructure(mergedConfig)) {
    console.error('❌ 合并后的配置缺少必要字段 (rootURL/baseUrl/pdfDir)');
    process.exit(1);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updatedBaseConfig, null, 2) + '\n');
  console.log(`✅ 已切换到 ${targetName} 文档配置`);
  showCurrentConfig();
}

function main() {
  const [command, target] = process.argv.slice(2);

  switch (command) {
    case 'use':
      if (!target) {
        console.error('❌ 请选择站点名称');
        listTargets();
        process.exit(1);
      }
      useTarget(target);
      break;
    case 'list':
      listTargets();
      break;
    case 'current':
      showCurrentConfig();
      break;
    case 'help':
    default:
      showHelp();
      break;
  }
}

main();
