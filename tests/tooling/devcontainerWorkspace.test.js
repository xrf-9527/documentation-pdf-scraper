import { describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Windows host container workspace', () => {
  test('devcontainer image should install the PDF toolchain required by the project', async () => {
    const dockerfilePath = path.resolve(process.cwd(), '.devcontainer/Dockerfile');
    const dockerfile = await fs.readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain(
      'FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm'
    );
    expect(dockerfile).not.toContain('@anthropic-ai/claude-code');
    expect(dockerfile).not.toContain('.claude');
    expect(dockerfile).not.toContain('init-firewall.sh');
    expect(dockerfile).toContain('pandoc');
    expect(dockerfile).toContain('texlive-xetex');
    expect(dockerfile).toContain('texlive-latex-extra');
    expect(dockerfile).toContain('fonts-noto-cjk');
    expect(dockerfile).toMatch(/uv\/install\.sh|install uv/i);
    expect(dockerfile).toContain('make');
  });

  test('devcontainer should use named volumes for dependency directories on Windows hosts', async () => {
    const devcontainerPath = path.resolve(
      process.cwd(),
      '.devcontainer/devcontainer.json'
    );
    const config = await fs.readFile(devcontainerPath, 'utf8');

    expect(config).not.toContain('.claude');
    expect(config).not.toContain('CLAUDE_CONFIG_DIR');
    expect(config).not.toContain('claude-code-bashhistory');
    expect(config).toContain('/workspace/node_modules');
    expect(config).toContain('/workspace/.venv');
    expect(config).toContain('type=volume');
    expect(config).toContain('postCreateCommand');
  });

  test('project docs should document Windows container development separately from macOS host development', async () => {
    const readmePath = path.resolve(process.cwd(), 'README.md');
    const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
    const readme = await fs.readFile(readmePath, 'utf8');
    const agents = await fs.readFile(agentsPath, 'utf8');

    expect(readme).toContain('Docker Desktop');
    expect(readme).toContain('devcontainer');
    expect(agents).toContain('Windows host');
    expect(agents).toContain('macOS');
    expect(agents).toContain('Linux container');
    expect(agents).toContain('/workspace');
  });
});
