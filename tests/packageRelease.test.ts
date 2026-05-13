import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('release package manifest', () => {
  test('package script includes config example in release zip inputs', async () => {
    const script = await readFile('scripts/package-release.ts', 'utf8');

    expect(script).toContain('config.example.json');
    expect(script).toContain('INSTALL_CLAUDE_CODE.md');
    expect(script).toContain('CLAUDECODE_INSTALL_PROMPT.md');
    expect(script).toContain('dist/index.js');
  });
});
