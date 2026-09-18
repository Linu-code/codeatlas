/**
 * importResolver —— 跨语言导入解析
 *
 * 重点验证"宁可少连不可乱连"的策略：
 *   · 相对路径（含扩展名补全与 /index）
 *   · 点号包名（Java/C#/PHP）
 *   · 斜杠模块路径（Go/Rust）
 *   · 别名前缀（@/、~/）
 *   · 外部依赖与歧义必须返回 null（不猜）
 */
import { describe, expect, it } from 'vitest';
import {
  buildImportEdges,
  buildResolveContext,
  normalizePath,
  resolveImportSpec,
  stemOf,
} from '../../src/analysis/importResolver';
import type { FileAnalysis } from '../../src/analysis/symbols';

function mkFile(path: string, imports: string[] = []): FileAnalysis {
  return { path, language: 'typescript', definitions: [], calls: [], references: [], imports, hasError: false };
}

describe('stemOf / normalizePath', () => {
  it('取文件名并去掉扩展名（小写）', () => {
    expect(stemOf('src/utils/format.ts')).toBe('format');
    expect(stemOf('app.py')).toBe('app');
    expect(stemOf('a/b/Foo.java')).toBe('foo');
  });

  it('路径规范化处理 ./ 与 ../', () => {
    expect(normalizePath('src/a/../b/./c')).toBe('src/b/c');
    expect(normalizePath('../x')).toBe('x');
  });
});

describe('resolveImportSpec —— 相对路径', () => {
  const ctx = buildResolveContext([
    'src/utils/format.ts',
    'src/utils/index.ts',
    'src/app.ts',
    'src/components/Button.tsx',
  ]);

  it('补全扩展名', () => {
    expect(resolveImportSpec('src/app.ts', './utils/format', ctx)).toBe('src/utils/format.ts');
  });

  it('目录入口补全为 index', () => {
    expect(resolveImportSpec('src/app.ts', './utils', ctx)).toBe('src/utils/index.ts');
  });

  it('../ 上跳', () => {
    expect(resolveImportSpec('src/utils/format.ts', '../app', ctx)).toBe('src/app.ts');
  });

  it('解析不到时返回 null（外部依赖）', () => {
    expect(resolveImportSpec('src/app.ts', 'react', ctx)).toBeNull();
    expect(resolveImportSpec('src/app.ts', './missing', ctx)).toBeNull();
  });

  it('不会解析到自身（自环）', () => {
    expect(resolveImportSpec('src/app.ts', './app', ctx)).toBeNull();
  });
});

describe('resolveImportSpec —— 模块路径（点号 / 斜杠 / 别名）', () => {
  const ctx = buildResolveContext([
    'src/main/java/com/example/Helper.java',
    'src/main/java/com/example/User.java',
    'internal/util/util.go',
    'src/utils/format.ts',
    'src/utils/parse.ts',
  ]);

  it('Java 点号包名按目录层级匹配', () => {
    expect(resolveImportSpec('src/main/java/com/example/User.java', 'com.example.Helper', ctx)).toBe(
      'src/main/java/com/example/Helper.java',
    );
  });

  it('Go 斜杠模块路径按末段 + 上级段匹配', () => {
    expect(resolveImportSpec('cmd/main.go', 'app/internal/util', ctx)).toBe('internal/util/util.go');
  });

  it('不会把自己解析成依赖（自环防护）', () => {
    expect(resolveImportSpec('internal/util/util.go', 'app/internal/util', ctx)).toBeNull();
  });

  it('别名前缀 @/ 会被丢弃', () => {
    expect(resolveImportSpec('src/utils/format.ts', '@/utils/parse', ctx)).toBe('src/utils/parse.ts');
  });

  it('第三方包名（无对应文件）返回 null', () => {
    expect(resolveImportSpec('src/utils/format.ts', 'lodash', ctx)).toBeNull();
    expect(resolveImportSpec('src/utils/format.ts', 'java.util.List', ctx)).toBeNull();
  });

  it('多个同名候选（歧义）时不猜', () => {
    const ambiguous = buildResolveContext(['a/util.ts', 'b/util.ts']);
    expect(resolveImportSpec('a/x.ts', 'pkg.util', ambiguous)).toBeNull();
  });
});

describe('buildImportEdges', () => {
  it('去重、排序，且忽略无法解析的说明符', () => {
    const files = [
      mkFile('src/app.ts', ['./utils/format', './utils/format', 'react']),
      mkFile('src/utils/format.ts'),
      mkFile('src/utils/index.ts', ['../app']),
    ];
    const ctx = buildResolveContext(files.map((f) => f.path));
    const edges = buildImportEdges(files, ctx);
    expect(edges).toEqual([
      { from: 'src/app.ts', to: 'src/utils/format.ts' },
      { from: 'src/utils/index.ts', to: 'src/app.ts' },
    ]);
  });
});
