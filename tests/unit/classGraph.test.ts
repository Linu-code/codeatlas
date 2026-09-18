/**
 * classGraph —— 类图 / 继承·实现关系（N3）
 *
 * 两部分：
 *   ① 纯函数：名字解析策略（同文件优先 / 全局唯一 / 歧义不连 / 外部节点）
 *   ② 真实 AST：各语言 LangHandler 的 superTypes 实现（不是 mock）
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildClassGraph } from '../../src/analysis/classGraph';
import { normalizeTypeName, splitTypeNames } from '../../src/analysis/langs/types';
import { configureParserEnv, parseCode, type LangId } from '../../src/analysis/parser';
import { extractFile, type FileAnalysis } from '../../src/analysis/symbols';

const require = createRequire(import.meta.url);

beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    grammarWasm: (grammar) => path.join(grammarDir, `tree-sitter-${grammar}.wasm`),
  });
});

/** 构造带类关系的文件分析结果 */
function mkClassFile(
  file: string,
  classes: { name: string; line: number; extends?: string[]; implements?: string[] }[],
): FileAnalysis {
  return {
    path: file,
    language: 'typescript',
    definitions: classes.map((c) => ({
      name: c.name,
      kind: 'class' as const,
      line: c.line,
      endLine: c.line + 5,
      signature: `class ${c.name}`,
      exported: true,
    })),
    calls: [],
    references: [],
    imports: [],
    classRelations: classes.map((c) => ({
      name: c.name,
      extends: c.extends ?? [],
      implements: c.implements ?? [],
      line: c.line,
    })),
    hasError: false,
  };
}

describe('normalizeTypeName / splitTypeNames', () => {
  it('去掉泛型、数组、参数与访问修饰符', () => {
    expect(normalizeTypeName('React.Component<Props>')).toBe('Component');
    expect(normalizeTypeName('Base()')).toBe('Base');
    expect(normalizeTypeName('public Base')).toBe('Base');
    expect(normalizeTypeName('com.example.User')).toBe('User');
    expect(normalizeTypeName('Foo::Bar')).toBe('Bar');
    expect(normalizeTypeName('string[]')).toBe('string');
  });

  it('逗号列表逐项规范化并丢弃空项', () => {
    expect(splitTypeNames('Base, IGreeter, Runnable')).toEqual(['Base', 'IGreeter', 'Runnable']);
    expect(splitTypeNames(': public Base, public IFace')).toEqual(['Base', 'IFace']);
    expect(splitTypeNames('')).toEqual([]);
  });
});

describe('buildClassGraph —— 名字解析', () => {
  it('继承与实现分别成边', () => {
    const g = buildClassGraph([
      mkClassFile('a.ts', [
        { name: 'Base', line: 1 },
        { name: 'IGreeter', line: 5 },
        { name: 'User', line: 9, extends: ['Base'], implements: ['IGreeter'] },
      ]),
    ]);
    const byKind = (k: string) => g.edges.filter((e) => e.kind === k);
    expect(byKind('extends')).toHaveLength(1);
    expect(byKind('implements')).toHaveLength(1);
    expect(g.classCount).toBe(3);
  });

  it('同名类优先解析到同一个文件内', () => {
    const g = buildClassGraph([
      mkClassFile('a.ts', [
        { name: 'Base', line: 1 },
        { name: 'User', line: 5, extends: ['Base'] },
      ]),
      mkClassFile('b.ts', [{ name: 'Base', line: 1 }]),
    ]);
    expect(g.edges).toEqual([{ from: 'a.ts#User', to: 'a.ts#Base', kind: 'extends' }]);
    expect(g.ambiguous).toEqual([]);
  });

  it('跨文件重名（歧义）时不建边，并记录名字', () => {
    const g = buildClassGraph([
      mkClassFile('a.ts', [{ name: 'Base', line: 1 }]),
      mkClassFile('b.ts', [{ name: 'Base', line: 1 }]),
      mkClassFile('c.ts', [{ name: 'User', line: 1, extends: ['Base'] }]),
    ]);
    expect(g.edges).toHaveLength(0);
    expect(g.ambiguous).toEqual(['Base']);
  });

  it('解析不到的类型视为外部依赖节点（虚线关系仍可见）', () => {
    const g = buildClassGraph([mkClassFile('a.ts', [{ name: 'User', line: 1, extends: ['NSObject'] }])]);
    expect(g.external).toEqual(['NSObject']);
    const ext = g.nodes.find((n) => n.external);
    expect(ext?.name).toBe('NSObject');
    expect(ext?.file).toBe('');
    expect(g.edges[0].to).toBe('ext:NSObject');
  });

  it('自引用被忽略', () => {
    const g = buildClassGraph([mkClassFile('a.ts', [{ name: 'A', line: 1, extends: ['A'] }])]);
    expect(g.edges).toHaveLength(0);
  });

  it('没有类关系时是空图', () => {
    const g = buildClassGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.classCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 真实 AST：各语言 superTypes
// ---------------------------------------------------------------------------

async function relationsOf(code: string, lang: LangId, file: string) {
  const tree = await parseCode(code, lang);
  if (!tree) throw new Error(`parse failed: ${lang}`);
  expect(tree.hasError).toBe(false);
  return extractFile(tree.rootNode, file, lang).classRelations ?? [];
}

describe('superTypes —— 真实 AST', () => {
  it('TypeScript：extends 与 implements 分开', async () => {
    const rel = await relationsOf(
      `class Base {}\ninterface IGreeter {}\nclass User extends Base implements IGreeter {}\n`,
      'typescript',
      'a.ts',
    );
    const user = rel.find((r) => r.name === 'User')!;
    expect(user.extends).toEqual(['Base']);
    expect(user.implements).toEqual(['IGreeter']);
  });

  it('Java：类与接口两条路径', async () => {
    const rel = await relationsOf(
      `class Base {}\ninterface IGreeter {}\ninterface Other {}\nclass User extends Base implements IGreeter, Other {}\n`,
      'java',
      'A.java',
    );
    const user = rel.find((r) => r.name === 'User')!;
    expect(user.extends).toEqual(['Base']);
    expect(user.implements).toEqual(['IGreeter', 'Other']);
  });

  it('Python：基类列表（忽略 metaclass 关键字参数）', async () => {
    const rel = await relationsOf(
      `class Base:\n    pass\n\nclass User(Base, metaclass=object):\n    pass\n`,
      'python',
      'a.py',
    );
    expect(rel.find((r) => r.name === 'User')?.extends).toEqual(['Base']);
  });

  it('C++：base_class_clause（剔除访问修饰符）', async () => {
    const rel = await relationsOf(
      `class Base {};\nclass IFace {};\nclass User : public Base, public IFace {};\n`,
      'cpp',
      'a.cpp',
    );
    expect(rel.find((r) => r.name === 'User')?.extends).toEqual(['Base', 'IFace']);
  });

  it('C#：base_list', async () => {
    const rel = await relationsOf(
      `class Base {}\ninterface IGreeter {}\nclass User : Base, IGreeter {}\n`,
      'csharp',
      'A.cs',
    );
    expect(rel.find((r) => r.name === 'User')?.extends).toEqual(['Base', 'IGreeter']);
  });

  it('Kotlin：带构造调用的是父类，不带的是接口', async () => {
    const rel = await relationsOf(
      `open class Base\ninterface IGreeter\nclass User : Base(), IGreeter\n`,
      'kotlin',
      'A.kt',
    );
    const user = rel.find((r) => r.name === 'User')!;
    expect(user.extends).toEqual(['Base']);
    expect(user.implements).toEqual(['IGreeter']);
  });

  it('Swift：class 的首项是父类，其余按协议', async () => {
    const rel = await relationsOf(
      `protocol Greeter {}\nclass Base {}\nclass User: Base, Greeter {}\nstruct Point: Equatable {}\n`,
      'swift',
      'A.swift',
    );
    const user = rel.find((r) => r.name === 'User')!;
    expect(user.extends).toEqual(['Base']);
    expect(user.implements).toEqual(['Greeter']);
    const point = rel.find((r) => r.name === 'Point')!;
    expect(point.extends).toEqual([]);
    expect(point.implements).toEqual(['Equatable']);
  });

  it('PHP：base_clause 与 class_interface_clause', async () => {
    const rel = await relationsOf(
      `<?php\ninterface IGreeter {}\nclass Base {}\nclass User extends Base implements IGreeter {}\n`,
      'php',
      'A.php',
    );
    const user = rel.find((r) => r.name === 'User')!;
    expect(user.extends).toEqual(['Base']);
    expect(user.implements).toEqual(['IGreeter']);
  });

  it('Ruby：只需 superclass（include 不算继承）', async () => {
    const rel = await relationsOf(`class Base\nend\n\nclass User < Base\nend\n`, 'ruby', 'a.rb');
    expect(rel.find((r) => r.name === 'User')?.extends).toEqual(['Base']);
  });

  it('Go / Rust / C 不提供类关系（明确不猜）', async () => {
    expect(await relationsOf(`package main\n\ntype User struct{}\n`, 'go', 'a.go')).toEqual([]);
    expect(await relationsOf(`pub struct User;\n`, 'rust', 'a.rs')).toEqual([]);
    expect(await relationsOf(`struct Point { int x; };\n`, 'c', 'a.c')).toEqual([]);
  });
});
