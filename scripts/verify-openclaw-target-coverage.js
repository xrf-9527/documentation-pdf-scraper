#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { extractTargetUrlsFromSitemap } from '../src/utils/sitemapTargetBuilder.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PATH_PREFIX,
  buildCoverageReport,
  normalizeTargetUrls,
  resolveVerificationMode,
} from '../src/utils/openclawCoverage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_SITEMAP_URL = 'https://docs.openclaw.ai/sitemap.xml';
const DEFAULT_TARGET_PATH = path.join(rootDir, 'doc-targets', 'openclaw-zh-cn.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const mode = resolveVerificationMode({
    argv: process.argv.slice(2),
    env: process.env,
  });

  const config = readJson(DEFAULT_TARGET_PATH);
  const targetUrls = normalizeTargetUrls(
    Array.isArray(config.targetUrls) ? config.targetUrls : [],
    {
      origin: DEFAULT_ORIGIN,
      pathPrefix: DEFAULT_PATH_PREFIX,
    }
  );

  let sitemapUrls = [];
  try {
    const sitemapXml = await fetchSitemapXml(DEFAULT_SITEMAP_URL);
    sitemapUrls = extractTargetUrlsFromSitemap(sitemapXml, {
      origin: DEFAULT_ORIGIN,
      pathPrefix: DEFAULT_PATH_PREFIX,
    });
  } catch (error) {
    if (!mode.allowFetchFailure) {
      throw error;
    }

    console.warn(`⚠️ OpenClaw coverage check skipped due to fetch failure: ${error.message}`);
    return;
  }

  const report = buildCoverageReport({ sitemapUrls, targetUrls });

  console.log('OpenClaw zh-CN coverage verification');
  console.log(`- Sitemap URLs: ${report.sitemapCount}`);
  console.log(`- Target URLs : ${report.targetCount}`);
  console.log(`- Missing     : ${report.missing.length}`);
  console.log(`- Extra       : ${report.extra.length}`);

  if (report.missing.length > 0) {
    console.log('\nMissing URLs sample:');
    report.missing.slice(0, 20).forEach((url) => console.log(`  - ${url}`));
  }

  if (report.extra.length > 0) {
    console.log('\nExtra URLs sample:');
    report.extra.slice(0, 20).forEach((url) => console.log(`  - ${url}`));
  }

  if (report.missing.length > 0 || report.extra.length > 0) {
    if (mode.warnOnly) {
      console.warn('\n⚠️ Coverage mismatch detected in warn-only mode.');
      return;
    }
    process.exit(1);
  }

  console.log('\nCoverage verification passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Coverage verification failed: ${error.message}`);
    process.exit(1);
  });
}
