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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

async function fetchSitemapXml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'documentation-pdf-scraper/2.0',
      Accept: 'application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const targetPath = DEFAULT_TARGET_PATH;
  const sitemapXml = await fetchSitemapXml(DEFAULT_SITEMAP_URL);
  const targetUrls = extractTargetUrlsFromSitemap(sitemapXml, {
    origin: DEFAULT_ORIGIN,
    pathPrefix: DEFAULT_PATH_PREFIX,
  });

  if (targetUrls.length === 0) {
    throw new Error('No target URLs extracted from sitemap');
  }

  const config = readJson(targetPath);
  config.targetUrls = targetUrls;
  writeJson(targetPath, config);

  console.log('Updated OpenClaw zh-CN target URLs successfully');
  console.log(`- Target file: ${targetPath}`);
  console.log(`- Sitemap URL: ${DEFAULT_SITEMAP_URL}`);
  console.log(`- Extracted URLs: ${targetUrls.length}`);
  console.log(`- Sample first URL: ${targetUrls[0]}`);
  console.log(`- Sample last URL: ${targetUrls[targetUrls.length - 1]}`);
}

main().catch((error) => {
  console.error(`Failed to update OpenClaw target URLs: ${error.message}`);
  process.exit(1);
});
