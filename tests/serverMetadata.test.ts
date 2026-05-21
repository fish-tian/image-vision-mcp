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

  test('registers Z.AI-style image vision tools except video analysis', async () => {
    const source = await readFile('src/index.ts', 'utf8');

    expect(source).toContain("name: 'image_analysis'");
    expect(source).toContain("name: 'extract_text_from_screenshot'");
    expect(source).toContain("name: 'diagnose_error_screenshot'");
    expect(source).toContain("name: 'understand_technical_diagram'");
    expect(source).toContain("name: 'analyze_data_visualization'");
    expect(source).toContain("name: 'ui_to_artifact'");
    expect(source).toContain("name: 'ui_diff_check'");
    expect(source).toContain("['code', 'prompt', 'spec', 'description']");
    expect(source).not.toContain("name: 'video_analysis'");
  });
});
