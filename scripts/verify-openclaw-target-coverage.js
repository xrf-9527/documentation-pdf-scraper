#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractTargetUrlsFromSitemap } from '../src/utils/sitemapTargetBuilder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_SITEMAP_URL = 'https://docs.openclaw.ai/sitemap.xml';
const DEFAULT_ORIGIN = 'https://docs.openclaw.ai';
const DEFAULT_PATH_PREFIX = '/zh-CN';
const DEFAULT_TARGET_PATH = path.join(rootDir, 'doc-targets', 'openclaw-zh-cn.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function normalizeTargetUrls(rawUrls) {
  const result = [];
  const seen = new Set();

  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      continue;
    }

    let normalized = null;
    try {
      normalized = normalizeUrl(rawUrl.trim());
    } catch {
      continue;
    }

    if (!normalized.startsWith(`${DEFAULT_ORIGIN}${DEFAULT_PATH_PREFIX}`)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

async function fetchSitemapXml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'documentation-pdf-scraper/2.0',
      'Accept': 'application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const sitemapXml = await fetchSitemapXml(DEFAULT_SITEMAP_URL);
  const sitemapUrls = extractTargetUrlsFromSitemap(sitemapXml, {
    origin: DEFAULT_ORIGIN,
    pathPrefix: DEFAULT_PATH_PREFIX,
  });

  const config = readJson(DEFAULT_TARGET_PATH);
  const targetUrls = normalizeTargetUrls(Array.isArray(config.targetUrls) ? config.targetUrls : []);

  const sitemapSet = new Set(sitemapUrls);
  const targetSet = new Set(targetUrls);

  const missing = sitemapUrls.filter((url) => !targetSet.has(url));
  const extra = targetUrls.filter((url) => !sitemapSet.has(url));

  console.log('OpenClaw zh-CN coverage verification');
  console.log(`- Sitemap URLs: ${sitemapUrls.length}`);
  console.log(`- Target URLs : ${targetUrls.length}`);
  console.log(`- Missing     : ${missing.length}`);
  console.log(`- Extra       : ${extra.length}`);

  if (missing.length > 0) {
    console.log('\nMissing URLs sample:');
    missing.slice(0, 20).forEach((url) => console.log(`  - ${url}`));
  }

  if (extra.length > 0) {
    console.log('\nExtra URLs sample:');
    extra.slice(0, 20).forEach((url) => console.log(`  - ${url}`));
  }

  if (missing.length > 0 || extra.length > 0) {
    process.exit(1);
  }

  console.log('\nCoverage verification passed.');
}

main().catch((error) => {
  console.error(`Coverage verification failed: ${error.message}`);
  process.exit(1);
});
