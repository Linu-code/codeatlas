import { describe, expect, it } from 'vitest';
import {
  githubLinkBase,
  githubRawBase,
  isAbsoluteSrc,
  md,
  resolveRelativeSrc,
} from '../../src/utils/markdown';
import { applyTheme, prismLangOf, resolveTheme, isPreviewable } from '../../src/theme/themes';

describe('resolveRelativeSrc（README 相对资源路径改写）', () => {
  const base = 'https://raw.githubusercontent.com/facebook/react/main/';

  it('相对路径拼接到 base', () => {
    expect(resolveRelativeSrc('./docs/logo.png', base)).toBe(`${base}docs/logo.png`);
    expect(resolveRelativeSrc('docs/logo.png', base)).toBe(`${base}docs/logo.png`);
  });

  it('去掉 ../ 但不越界', () => {
    expect(resolveRelativeSrc('../assets/x.svg', base)).toBe(`${base}assets/x.svg`);
    expect(resolveRelativeSrc('../../../../etc/passwd', base)).toBe(`${base}etc/passwd`);
  });

  it('绝对地址与 data/blob 原样返回', () => {
    expect(resolveRelativeSrc('https://img.shields.io/x.svg', base)).toBe('https://img.shields.io/x.svg');
    expect(resolveRelativeSrc('//cdn.example.com/a.png', base)).toBe('//cdn.example.com/a.png');
    expect(resolveRelativeSrc('data:image/png;base64,AAA', base)).toBe('data:image/png;base64,AAA');
    expect(resolveRelativeSrc('blob:http://localhost/abc', base)).toBe('blob:http://localhost/abc');
  });

  it('base 为空（离线 ZIP）时原样返回，交由 blob 解析器处理', () => {
    expect(resolveRelativeSrc('./img/a.png', null)).toBe('./img/a.png');
  });

  it('base 末尾斜杠缺失时自动补齐', () => {
    expect(resolveRelativeSrc('a.png', 'https://raw.githubusercontent.com/o/r/main')).toBe(
      'https://raw.githubusercontent.com/o/r/main/a.png',
    );
  });

  it('isAbsoluteSrc 判定', () => {
    expect(isAbsoluteSrc('https://a.com/b')).toBe(true);
    expect(isAbsoluteSrc('./b')).toBe(false);
  });

  it('GitHub base 生成', () => {
    expect(githubRawBase('o', 'r', 'main')).toBe('https://raw.githubusercontent.com/o/r/main/');
    expect(githubLinkBase('o', 'r', 'main')).toBe('https://github.com/o/r/blob/main/');
  });
});

describe('markdown-it 渲染', () => {
  it('渲染基础 Markdown', () => {
    const html = md.render('# Title\n\n- a\n- b');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>a</li>');
  });

  it('禁用原始 HTML（防注入）', () => {
    const html = md.render('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('主题解析与文件类型判定', () => {
  it('四主题解析：atlas 与 system 跟随系统偏好', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('atlas', true)).toBe('atlas-dark');
    expect(resolveTheme('atlas', false)).toBe('atlas-light');
  });

  it('applyTheme 在无 DOM 环境下不抛错（node 测试环境）', () => {
    expect(() => applyTheme('atlas')).not.toThrow();
  });

  it('可预览扩展名白名单与 Prism 语言映射', () => {
    expect(isPreviewable('src/a.ts')).toBe(true);
    expect(isPreviewable('README.md')).toBe(true);
    expect(isPreviewable('a.py')).toBe(true);
    expect(isPreviewable('bin/app.exe')).toBe(false);
    expect(prismLangOf('a.tsx')).toBe('tsx');
    expect(prismLangOf('a.py')).toBe('python');
    expect(prismLangOf('a.unknownext')).toBe('none');
  });
});
