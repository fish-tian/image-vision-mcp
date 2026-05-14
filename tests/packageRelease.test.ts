import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

interface PackageJson {
  scripts: Record<string, string>;
}

describe('release package manifest', () => {
  test('package script creates a no-install script-free release zip', async () => {
    const script = await readFile('scripts/package-release.ts', 'utf8');

    expect(script).toContain('config.example.json');
    expect(script).toContain('SKILL.md');
    expect(script).toContain('SKILL.zh-CN.md');
    expect(script).toContain('README.zh-CN.md');
    expect(script).toContain('dist/index.js');
    expect(script).toContain('package.json');
    expect(script).not.toContain('install-claude-code.ps1');
    expect(script).not.toContain('install-claude-code.sh');
  });
});

describe('release package scripts', () => {
  test('supports minified and debug bundle packaging', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;

    expect(pkg.scripts['build:bundle']).toContain('--minify');
    expect(pkg.scripts['build:bundle:debug']).toBe('bun build src/index.ts --outfile dist/index.js --target node --format esm');
    expect(pkg.scripts['build:bundle:debug']).not.toContain('--minify');
    expect(pkg.scripts.package).toBe('bun run build:bundle && bun run scripts/package-release.ts');
    expect(pkg.scripts['package:debug']).toBe('bun run build:bundle:debug && bun run scripts/package-release.ts');
  });
});
