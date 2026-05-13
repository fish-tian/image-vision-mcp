import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('release package manifest', () => {
  test('package script creates a no-install script-free release zip', async () => {
    const script = await readFile('scripts/package-release.ts', 'utf8');

    expect(script).toContain('config.example.json');
    expect(script).toContain('SKILL.md');
    expect(script).toContain('dist/index.js');
    expect(script).toContain('package.json');
    expect(script).not.toContain('install-claude-code.ps1');
    expect(script).not.toContain('install-claude-code.sh');
  });
});
