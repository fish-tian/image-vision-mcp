import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('analyze_image tool metadata', () => {
  test('instructs callers to pass the original image source directly', async () => {
    const source = await readFile('src/index.ts', 'utf8');

    expect(source).toContain('Original user-provided local image path or original image URL');
    expect(source).toContain('Do not call a host Read tool first');
    expect(source).toContain('data-uri/null URLs');
    expect(source).toContain('readOnlyHint: true');
    expect(source).toContain('use-original-user-path-or-url');
  });
});
