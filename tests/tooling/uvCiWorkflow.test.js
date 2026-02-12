import { describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('CI workflow uv setup', () => {
  test('GitHub Actions CI should install uv and sync locked dependencies', async () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
    const workflow = await fs.readFile(workflowPath, 'utf8');

    expect(workflow).toContain('uses: astral-sh/setup-uv@v7');
    expect(workflow).toContain('enable-cache: true');
    expect(workflow).toContain('uv sync --locked');
  });
});
