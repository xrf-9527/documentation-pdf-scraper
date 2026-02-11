import {
  buildCoverageReport,
  normalizeTargetUrls,
  resolveVerificationMode,
} from '../../src/utils/openclawCoverage.js';

describe('verify-openclaw-target-coverage helpers', () => {
  test('normalizeTargetUrls should deduplicate and keep zh-CN URLs only', () => {
    const urls = normalizeTargetUrls([
      'https://docs.openclaw.ai/zh-CN/intro',
      'https://docs.openclaw.ai/zh-CN/intro/',
      'https://docs.openclaw.ai/zh-CN/guide?x=1#anchor',
      'https://docs.openclaw.ai/en-US/intro',
      'not-a-url',
    ]);

    expect(urls).toEqual([
      'https://docs.openclaw.ai/zh-CN/intro',
      'https://docs.openclaw.ai/zh-CN/guide',
    ]);
  });

  test('buildCoverageReport should compute missing and extra urls', () => {
    const report = buildCoverageReport({
      sitemapUrls: ['https://docs.openclaw.ai/zh-CN/a', 'https://docs.openclaw.ai/zh-CN/b'],
      targetUrls: ['https://docs.openclaw.ai/zh-CN/a', 'https://docs.openclaw.ai/zh-CN/c'],
    });

    expect(report.missing).toEqual(['https://docs.openclaw.ai/zh-CN/b']);
    expect(report.extra).toEqual(['https://docs.openclaw.ai/zh-CN/c']);
  });

  test('resolveVerificationMode should read args and env', () => {
    const mode = resolveVerificationMode({
      argv: ['--allow-fetch-failure', '--warn-only'],
      env: {},
    });
    expect(mode.allowFetchFailure).toBe(true);
    expect(mode.warnOnly).toBe(true);

    const modeFromEnv = resolveVerificationMode({
      argv: [],
      env: { OPENCLAW_VERIFY_ALLOW_FETCH_FAILURE: '1' },
    });
    expect(modeFromEnv.allowFetchFailure).toBe(true);
    expect(modeFromEnv.warnOnly).toBe(false);
  });
});
