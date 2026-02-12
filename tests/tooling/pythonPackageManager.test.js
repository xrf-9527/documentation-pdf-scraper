import { describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Python package management', () => {
  test('base config should use uv-managed virtualenv python path', async () => {
    const configPath = path.resolve(process.cwd(), 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);

    expect(config.python?.executable).toBe('./.venv/bin/python');
  });

  test('Makefile should install python dependencies with uv', async () => {
    const makefilePath = path.resolve(process.cwd(), 'Makefile');
    const makefile = await fs.readFile(makefilePath, 'utf8');

    expect(makefile).toContain('$(UV) sync --locked');
    expect(makefile).not.toContain('pip install -r requirements.txt');
    expect(makefile).not.toContain('python3 -m venv');
  });

  test('gitignore should only keep .venv for python virtual env ignore rule', async () => {
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    const gitignore = await fs.readFile(gitignorePath, 'utf8');
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).toContain('.venv/');
    expect(lines).not.toContain('venv/');
  });

  test('legacy requirements.txt should be removed', async () => {
    const requirementsPath = path.resolve(process.cwd(), 'requirements.txt');
    await expect(fs.access(requirementsPath)).rejects.toThrow();
  });
});
