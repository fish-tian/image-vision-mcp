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

  test('steers UI screenshot requests toward ui_to_artifact', async () => {
    const source = await readFile('src/index.ts', 'utf8');

    expect(source).toContain('Use this for UI screenshots');
    expect(source).toContain('识别这个 UI 稿');
    expect(source).toContain('Default to output_type=description');
    expect(source).toContain('Prefer specialized tools when the image is a UI screenshot');
    expect(source).toContain('Fallback general-purpose image understanding');
  });

  test('tells callers to return OCR text verbatim without summarizing', async () => {
    const source = await readFile('src/index.ts', 'utf8');

    expect(source).toContain('the final assistant response must contain only the extracted text');
    expect(source).toContain('识别文字');
    expect(source).toContain('Return only the extracted text.');
    expect(source).toContain('Do not summarize, explain, translate, rewrite, normalize into bullets');
  });
});
