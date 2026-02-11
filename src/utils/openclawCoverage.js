const DEFAULT_ORIGIN = 'https://docs.openclaw.ai';
const DEFAULT_PATH_PREFIX = '/zh-CN';

function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function normalizeTargetUrls(rawUrls, options = {}) {
  const origin = options.origin || DEFAULT_ORIGIN;
  const pathPrefix = options.pathPrefix || DEFAULT_PATH_PREFIX;
  const requiredPrefix = `${origin}${pathPrefix}`;
  const result = [];
  const seen = new Set();

  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      continue;
    }

    let normalized;
    try {
      normalized = normalizeUrl(rawUrl.trim());
    } catch {
      continue;
    }

    if (!normalized.startsWith(requiredPrefix)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function buildCoverageReport({ sitemapUrls = [], targetUrls = [] } = {}) {
  const sitemapSet = new Set(sitemapUrls);
  const targetSet = new Set(targetUrls);

  return {
    sitemapCount: sitemapUrls.length,
    targetCount: targetUrls.length,
    missing: sitemapUrls.filter((url) => !targetSet.has(url)),
    extra: targetUrls.filter((url) => !sitemapSet.has(url)),
  };
}

function resolveVerificationMode({ argv = [], env = {} } = {}) {
  const args = new Set(argv);
  const allowFetchFailure =
    args.has('--allow-fetch-failure') || env.OPENCLAW_VERIFY_ALLOW_FETCH_FAILURE === '1';
  const warnOnly = args.has('--warn-only') || env.OPENCLAW_VERIFY_WARN_ONLY === '1';

  return {
    allowFetchFailure,
    warnOnly,
  };
}

export {
  DEFAULT_ORIGIN,
  DEFAULT_PATH_PREFIX,
  normalizeUrl,
  normalizeTargetUrls,
  buildCoverageReport,
  resolveVerificationMode,
};
