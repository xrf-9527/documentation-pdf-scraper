import { extractTargetUrlsFromSitemap } from '../../src/utils/sitemapTargetBuilder.js';

describe('sitemapTargetBuilder', () => {
  test('extracts zh-CN URLs from sitemap and normalizes entries', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs.openclaw.ai/zh-CN/start/getting-started/</loc></url>
  <url><loc>https://docs.openclaw.ai/zh-CN/start/getting-started?utm=1#section</loc></url>
  <url><loc>https://docs.openclaw.ai/zh-CN/tools/web</loc></url>
  <url><loc>https://docs.openclaw.ai/start/getting-started</loc></url>
</urlset>`;

    const urls = extractTargetUrlsFromSitemap(sampleXml, {
      origin: 'https://docs.openclaw.ai',
      pathPrefix: '/zh-CN',
    });

    expect(urls).toEqual([
      'https://docs.openclaw.ai/zh-CN/start/getting-started',
      'https://docs.openclaw.ai/zh-CN/tools/web',
    ]);
  });

  test('ignores invalid or empty loc values', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc></loc></url>
  <url><loc>not-a-url</loc></url>
  <url><loc>https://docs.openclaw.ai/zh-CN/cli</loc></url>
</urlset>`;

    const urls = extractTargetUrlsFromSitemap(sampleXml, {
      origin: 'https://docs.openclaw.ai',
      pathPrefix: '/zh-CN',
    });

    expect(urls).toEqual(['https://docs.openclaw.ai/zh-CN/cli']);
  });
});
