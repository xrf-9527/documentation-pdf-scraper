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
});
