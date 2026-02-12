import { describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Dependabot configuration', () => {
  test('should define version updates for npm, uv, and github-actions', async () => {
    const filePath = path.resolve(process.cwd(), '.github/dependabot.yml');
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('version: 2');
    expect(content).toContain('package-ecosystem: "npm"');
    expect(content).toContain('package-ecosystem: "uv"');
    expect(content).toContain('package-ecosystem: "github-actions"');
  });

  test('should use scheduled updates with bounded PR volume', async () => {
    const filePath = path.resolve(process.cwd(), '.github/dependabot.yml');
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toContain('interval: "weekly"');
    expect(content).toContain('open-pull-requests-limit: 10');
    expect(content).toContain('open-pull-requests-limit: 5');
  });
});
