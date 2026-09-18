/**
 * Go / Rust 语言处理器测试（真实 wasm 解析，非 mock）
 *
 * 环境配置方式沿用 symbols.test.ts：直接指向 node_modules 里的语法包。
 * 覆盖：扩展名映射、定义识别（函数 / 方法 / 类）、导出规则、调用提取、导入提取。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configureParserEnv, langOfPath, parseCode, type LangId } from '../../src/analysis/parser';
import { extractFile } from '../../src/analysis/symbols';

const require = createRequire(import.meta.url);

beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(
    path.dirname(require.resolve('tree-sitter-wasms/package.json')),
    'out',
  );
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    grammarWasm: (lang: LangId) => path.join(grammarDir, `tree-sitter-${lang}.wasm`),
  });
});

const GO_SAMPLE = `
package main

import (
	"fmt"
	"strings"
)

type User struct {
	Name string
}

func Exported(name string) string {
	return fmt.Sprintf("hi %s", name)
}

func (u User) greet() string {
	return strings.ToUpper(u.Name)
}

func main() {
	u := User{Name: "a"}
	fmt.Println(u.greet())
	Exported("x")
}
`;

const RUST_SAMPLE = `
use std::collections::HashMap;

pub struct Config {
    name: String,
}

pub fn load(path: &str) -> Config {
    let map = HashMap::new();
    helper(path);
    Config { name: String::new() }
}

fn helper(p: &str) -> usize {
    p.len()
}

impl Config {
    pub fn new() -> Self {
        Config::default()
    }
}
`;

describe('扩展名 → 语言（多语言扩容）', () => {
  it('识别 Go / Rust', () => {
    expect(langOfPath('main.go')).toBe('go');
    expect(langOfPath('src/lib.rs')).toBe('rust');
    // 既有语言不受影响
    expect(langOfPath('a.ts')).toBe('typescript');
    expect(langOfPath('a.py')).toBe('python');
  });
});

describe('Go 语言处理器', () => {
  it('识别定义种类与导出规则', async () => {
    const tree = await parseCode(GO_SAMPLE, 'go');
    expect(tree).not.toBeNull();

    const res = extractFile(tree!.rootNode, 'main.go', 'go');
    const defs = new Map(res.definitions.map((d) => [d.name, d]));

    // struct → class
    expect(defs.get('User')?.kind).toBe('class');
    // 包级函数 → function；首字母大写即导出
    expect(defs.get('Exported')?.kind).toBe('function');
    expect(defs.get('Exported')?.exported).toBe(true);
    // 带接收者 → method；小写不导出
    expect(defs.get('greet')?.kind).toBe('method');
    expect(defs.get('greet')?.exported).toBe(false);
    expect(defs.get('main')?.exported).toBe(false);
  });

  it('提取导入块中的全部路径', async () => {
    const tree = await parseCode(GO_SAMPLE, 'go');
    const res = extractFile(tree!.rootNode, 'main.go', 'go');
    expect(res.imports).toContain('fmt');
    expect(res.imports).toContain('strings');
  });

  it('提取调用（含选择器调用的末段）', async () => {
    const tree = await parseCode(GO_SAMPLE, 'go');
    const res = extractFile(tree!.rootNode, 'main.go', 'go');
    const calls = res.calls.map((c) => c.to);

    expect(calls).toContain('Sprintf'); // fmt.Sprintf(...)
    expect(calls).toContain('ToUpper'); // strings.ToUpper(...)
    expect(calls).toContain('greet'); // u.greet()
    expect(calls).toContain('Exported'); // Exported("x")

    // 调用归属：greet 的调用者应为 greet
    const greetCall = res.calls.find((c) => c.to === 'ToUpper');
    expect(greetCall?.from).toBe('greet');
  });
});

describe('Rust 语言处理器', () => {
  it('识别定义种类与导出规则（pub）', async () => {
    const tree = await parseCode(RUST_SAMPLE, 'rust');
    expect(tree).not.toBeNull();

    const res = extractFile(tree!.rootNode, 'src/lib.rs', 'rust');
    const defs = new Map(res.definitions.map((d) => [d.name, d]));

    expect(defs.get('Config')?.kind).toBe('class');
    expect(defs.get('Config')?.exported).toBe(true); // pub struct

    expect(defs.get('load')?.kind).toBe('function');
    expect(defs.get('load')?.exported).toBe(true); // pub fn

    expect(defs.get('helper')?.kind).toBe('function');
    expect(defs.get('helper')?.exported).toBe(false); // 无 pub

    // impl 块内的 fn → method
    expect(defs.get('new')?.kind).toBe('method');
    expect(defs.get('new')?.exported).toBe(true); // pub fn in impl
  });

  it('提取 use 导入', async () => {
    const tree = await parseCode(RUST_SAMPLE, 'rust');
    const res = extractFile(tree!.rootNode, 'src/lib.rs', 'rust');
    expect(res.imports.some((s) => s.includes('HashMap'))).toBe(true);
  });

  it('提取三种调用形态（标识符 / 字段 / 路径）', async () => {
    const tree = await parseCode(RUST_SAMPLE, 'rust');
    const res = extractFile(tree!.rootNode, 'src/lib.rs', 'rust');
    const calls = res.calls.map((c) => c.to);

    expect(calls).toContain('helper'); // helper(path)  → identifier
    expect(calls).toContain('new'); // HashMap::new()  → scoped_identifier
    expect(calls).toContain('len'); // p.len()         → field_expression
    expect(calls).toContain('default'); // Config::default() → scoped_identifier
  });
});
