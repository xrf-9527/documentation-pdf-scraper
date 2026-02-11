const normalizePathPrefix = (pathPrefix) => {
  if (!pathPrefix || pathPrefix === '/') {
    return '';
  }
  return pathPrefix.endsWith('/') ? pathPrefix.slice(0, -1) : pathPrefix;
};

const isPathUnderPrefix = (pathname, pathPrefix) => {
  if (!pathPrefix) {
    return true;
  }
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
};

const normalizeHttpUrl = (rawUrl, baseOrigin) => {
  const parsed = new URL(rawUrl, baseOrigin || undefined);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed;
};

export function extractTargetUrlsFromSitemap(xml, options = {}) {
  const { origin, pathPrefix = '' } = options;

  if (typeof xml !== 'string' || !xml.trim()) {
    return [];
  }

  let baseOrigin = '';
  if (origin) {
    try {
      baseOrigin = new URL(origin).origin;
    } catch {
      return [];
    }
  }

  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  const urlRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  const results = [];
  const seen = new Set();

  let match = null;
  while ((match = urlRegex.exec(xml)) !== null) {
    const locValue = (match[1] || '').trim();
    if (!locValue) {
      continue;
    }

    let normalizedUrl = null;
    try {
      normalizedUrl = normalizeHttpUrl(locValue, baseOrigin);
    } catch {
      continue;
    }

    if (!normalizedUrl) {
      continue;
    }

    if (baseOrigin && normalizedUrl.origin !== baseOrigin) {
      continue;
    }

    if (!isPathUnderPrefix(normalizedUrl.pathname, normalizedPrefix)) {
      continue;
    }

    const finalUrl = normalizedUrl.toString();
    if (!seen.has(finalUrl)) {
      seen.add(finalUrl);
      results.push(finalUrl);
    }
  }

  return results;
}
