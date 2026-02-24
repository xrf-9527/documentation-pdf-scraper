import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import fs from 'fs';
import path from 'path';

describe('doc-target selector compatibility', () => {
  test('does not use unsupported :contains pseudo selector', () => {
    const targetsDir = path.resolve(process.cwd(), 'doc-targets');
    const files = fs.readdirSync(targetsDir).filter((name) => name.endsWith('.json'));

    for (const fileName of files) {
      const filePath = path.join(targetsDir, fileName);
      const content = fs.readFileSync(filePath, 'utf8');
      const config = JSON.parse(content);

      const selectorEntries = Object.entries(config).filter(([key, value]) => {
        return key.toLowerCase().includes('selector') && typeof value === 'string';
      });

      for (const [selectorKey, selectorValue] of selectorEntries) {
        expect(selectorValue).not.toMatch(/:contains\s*\(/i);
      }
    }
  });

  test('openclaw zh-CN target list should not include retired URLs', () => {
    const filePath = path.resolve(process.cwd(), 'doc-targets', 'openclaw-zh-cn.json');
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    const targetUrls = Array.isArray(config.targetUrls) ? config.targetUrls : [];

    expect(targetUrls).not.toContain('https://docs.openclaw.ai/zh-CN/help/submitting-a-pr');
    expect(targetUrls).not.toContain('https://docs.openclaw.ai/zh-CN/help/submitting-an-issue');
    expect(targetUrls).not.toContain('https://docs.openclaw.ai/zh-CN/hooks/soul-evil');
  });
});
