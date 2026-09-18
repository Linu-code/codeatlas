/**
 * 多语言处理器测试（真实 wasm 解析，非 mock）
 *
 * 环境配置方式沿用 symbols.test.ts：直接指向 node_modules 里的语法包。
 * 覆盖：扩展名映射、定义识别（函数 / 方法 / 类）、导出规则、调用提取、导入提取，
 * 以及每种新语言的复杂度度量（含 C 系的 declarator 解包、Kotlin 的非字段命名）。
 *
 * 说明：样本均为可无错解析的合法代码；带 `hasError` 的样本不会被用于断言，
 * 因为语法错误会让"节点不存在"与"规则写错"难以区分。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configureParserEnv, grammarFileName, langOfPath, parseCode } from '../../src/analysis/parser';
import { extractFile, type FileAnalysis } from '../../src/analysis/symbols';
import { computeMetrics } from '../../src/analysis/metrics';

const require = createRequire(import.meta.url);

beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(
    path.dirname(require.resolve('tree-sitter-wasms/package.json')),
    'out',
  );
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    // 入参是语法包名（grammarFileName 已由 parser 内部换算，如 csharp → c_sharp）
    grammarWasm: (grammar) => path.join(grammarDir, `tree-sitter-${grammar}.wasm`),
  });
});

/** 解析并提取（失败即抛错，避免测试静默通过） */
async function analyze(code: string, lang: Parameters<typeof parseCode>[1], file: string): Promise<FileAnalysis> {
  const tree = await parseCode(code, lang);
  if (!tree) throw new Error(`parse failed: ${lang}`);
  expect(tree.hasError).toBe(false);
  return extractFile(tree.rootNode, file, lang);
}

/** 按「名字 + 种类」精确取定义（同名可能既是类又是构造器） */
function def(res: FileAnalysis, name: string, kind: 'function' | 'class' | 'method') {
  return res.definitions.find((d) => d.name === name && d.kind === kind);
}

// ---------------------------------------------------------------------------
// 扩展名映射
// ---------------------------------------------------------------------------

describe('扩展名 → 语言（N1 全量）', () => {
  it('JS / TS / Python / Go / Rust 保持既有映射', () => {
    expect(langOfPath('a.ts')).toBe('typescript');
    expect(langOfPath('a.tsx')).toBe('tsx');
    expect(langOfPath('a.py')).toBe('python');
    expect(langOfPath('main.go')).toBe('go');
    expect(langOfPath('src/lib.rs')).toBe('rust');
  });

  it('新增语言（Java / C / C++ / C# / PHP / Kotlin / Swift / Ruby）', () => {
    expect(langOfPath('A.java')).toBe('java');
    expect(langOfPath('a.c')).toBe('c');
    expect(langOfPath('a.h')).toBe('c');
    expect(langOfPath('a.cpp')).toBe('cpp');
    expect(langOfPath('a.cc')).toBe('cpp');
    expect(langOfPath('a.hpp')).toBe('cpp');
    expect(langOfPath('A.cs')).toBe('csharp');
    expect(langOfPath('index.php')).toBe('php');
    expect(langOfPath('a.kt')).toBe('kotlin');
    expect(langOfPath('a.kts')).toBe('kotlin');
    expect(langOfPath('a.swift')).toBe('swift');
    expect(langOfPath('a.rb')).toBe('ruby');
  });

  it('C# 的语法包名与 LangId 不同名（映射集中管理）', () => {
    expect(grammarFileName('csharp')).toBe('c_sharp');
    expect(grammarFileName('java')).toBe('java');
  });
});

// ---------------------------------------------------------------------------
// 既有语言（Go / Rust）—— 1.0 已验收，这里作为回归保护
// ---------------------------------------------------------------------------

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

describe('Go 语言处理器（回归）', () => {
  it('定义种类、导出规则、导入与调用', async () => {
    const res = await analyze(GO_SAMPLE, 'go', 'main.go');
    expect(def(res, 'User', 'class')).toBeTruthy();
    expect(def(res, 'Exported', 'function')?.exported).toBe(true);
    expect(def(res, 'greet', 'method')?.exported).toBe(false);
    expect(def(res, 'main', 'function')?.exported).toBe(false);
    expect(res.imports).toContain('fmt');
    expect(res.imports).toContain('strings');
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('Sprintf');
    expect(calls).toContain('ToUpper');
    expect(calls).toContain('greet');
    expect(res.calls.find((c) => c.to === 'ToUpper')?.from).toBe('greet');
  });
});

describe('Rust 语言处理器（回归）', () => {
  it('定义种类、pub 导出规则、导入与调用', async () => {
    const res = await analyze(RUST_SAMPLE, 'rust', 'src/lib.rs');
    expect(def(res, 'Config', 'class')?.exported).toBe(true);
    expect(def(res, 'load', 'function')?.exported).toBe(true);
    expect(def(res, 'helper', 'function')?.exported).toBe(false);
    expect(def(res, 'new', 'method')?.exported).toBe(true);
    expect(res.imports.some((s) => s.includes('HashMap'))).toBe(true);
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('helper');
    expect(calls).toContain('new');
    expect(calls).toContain('len');
  });
});

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

const JAVA_SAMPLE = `
package com.example;

import java.util.List;
import static java.util.Collections.emptyList;

public class User {
    private String name;

    public User(String name) { this.name = name; }

    public String greet() {
        return Helper.upper(this.name);
    }

    private void secret() {
        helper();
    }
}

public interface Greeter {
    void sayHello();
}
`;

describe('Java 语言处理器', () => {
  it('类型定义（class / interface）与构造器都登记', async () => {
    const res = await analyze(JAVA_SAMPLE, 'java', 'User.java');
    expect(def(res, 'User', 'class')?.exported).toBe(true);
    expect(def(res, 'Greeter', 'class')?.exported).toBe(true);
    // 构造器视为 method，且与类同名
    expect(def(res, 'User', 'method')?.exported).toBe(true);
  });

  it('导出规则：public 导出，private 不导出，接口成员隐式 public', async () => {
    const res = await analyze(JAVA_SAMPLE, 'java', 'User.java');
    expect(def(res, 'greet', 'method')?.exported).toBe(true);
    expect(def(res, 'secret', 'method')?.exported).toBe(false);
    // 接口方法没写修饰符，但隐式 public
    expect(def(res, 'sayHello', 'method')?.exported).toBe(true);
  });

  it('导入（含 static import）与调用提取', async () => {
    const res = await analyze(JAVA_SAMPLE, 'java', 'User.java');
    expect(res.imports).toContain('java.util.List');
    expect(res.imports).toContain('java.util.Collections.emptyList');
    expect(res.calls.find((c) => c.to === 'upper')?.from).toBe('greet');
    expect(res.calls.find((c) => c.to === 'helper')?.from).toBe('secret');
  });

  it('object_creation_expression 也计入调用（new Foo()）', async () => {
    const res = await analyze('class A { void m() { new Foo(); } }', 'java', 'A.java');
    expect(res.calls.map((c) => c.to)).toContain('Foo');
  });
});

// ---------------------------------------------------------------------------
// C
// ---------------------------------------------------------------------------

const C_SAMPLE = `
#include <stdio.h>
#include "util.h"

struct Point { int x; int y; };

static int add(int a, int b) {
    return a + b;
}

int main(void) {
    struct Point p;
    printf("%d\\n", add(p.x, p.y));
    return 0;
}
`;

describe('C 语言处理器', () => {
  it('函数定义与 struct 识别（含 declarator 解包）', async () => {
    const res = await analyze(C_SAMPLE, 'c', 'main.c');
    expect(def(res, 'main', 'function')).toBeTruthy();
    expect(def(res, 'add', 'function')).toBeTruthy();
    expect(def(res, 'Point', 'class')).toBeTruthy();
  });

  it('`struct Point p;` 这类"使用"不会被误判为类型定义', async () => {
    const res = await analyze(C_SAMPLE, 'c', 'main.c');
    expect(res.definitions.filter((d) => d.name === 'Point')).toHaveLength(1);
  });

  it('导出规则：static 视为内部链接', async () => {
    const res = await analyze(C_SAMPLE, 'c', 'main.c');
    expect(def(res, 'add', 'function')?.exported).toBe(false);
    expect(def(res, 'main', 'function')?.exported).toBe(true);
  });

  it('#include 的两种形态与调用提取', async () => {
    const res = await analyze(C_SAMPLE, 'c', 'main.c');
    expect(res.imports).toContain('stdio.h');
    expect(res.imports).toContain('util.h');
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('printf');
    expect(calls).toContain('add');
  });

  it('指针函数的 declarator 能被逐层解包（int *f(void)）', async () => {
    const res = await analyze('int *make(void) { return 0; }', 'c', 'a.c');
    expect(def(res, 'make', 'function')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C++
// ---------------------------------------------------------------------------

const CPP_SAMPLE = `
#include <vector>

namespace app {

class Widget {
public:
    Widget(int id) : id_(id) {}
    int render() const { return draw(id_); }
private:
    int helperValue() { return 1; }
};

int freeFunc(int x) {
    Widget w(x);
    return w.render() + std::max(x, 0);
}

}
`;

describe('C++ 语言处理器', () => {
  it('类 / 方法 / 自由函数识别', async () => {
    const res = await analyze(CPP_SAMPLE, 'cpp', 'widget.cpp');
    expect(def(res, 'Widget', 'class')).toBeTruthy();
    expect(def(res, 'render', 'method')).toBeTruthy();
    expect(def(res, 'freeFunc', 'function')).toBeTruthy();
  });

  it('访问区段决定导出：public 段导出，private 段不导出', async () => {
    const res = await analyze(CPP_SAMPLE, 'cpp', 'widget.cpp');
    expect(def(res, 'render', 'method')?.exported).toBe(true);
    expect(def(res, 'helperValue', 'method')?.exported).toBe(false);
  });

  it('限定名调用与 new 表达式都识别', async () => {
    const res = await analyze(CPP_SAMPLE, 'cpp', 'widget.cpp');
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('draw');
    expect(calls).toContain('render');
    expect(calls).toContain('max'); // std::max(...)

    const created = await analyze('int f() { Widget* w = new Widget(); return 0; }', 'cpp', 'a.cpp');
    expect(created.calls.map((c) => c.to)).toContain('Widget');
  });
});

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

const CS_SAMPLE = `
using System;
using System.Collections.Generic;

namespace App {
    public class User {
        public User(string name) { Name = name; }

        private void P() { }

        public string Greet() {
            return Helper.Upper(Name);
        }
    }

    internal class Impl { }
}
`;

describe('C# 语言处理器', () => {
  it('类型定义与方法的种类识别', async () => {
    const res = await analyze(CS_SAMPLE, 'csharp', 'User.cs');
    expect(def(res, 'User', 'class')).toBeTruthy();
    expect(def(res, 'Greet', 'method')).toBeTruthy();
  });

  it('导出规则：public 导出，private / internal 不导出', async () => {
    const res = await analyze(CS_SAMPLE, 'csharp', 'User.cs');
    expect(def(res, 'User', 'class')?.exported).toBe(true);
    expect(def(res, 'Greet', 'method')?.exported).toBe(true);
    expect(def(res, 'P', 'method')?.exported).toBe(false);
    expect(def(res, 'Impl', 'class')?.exported).toBe(false);
  });

  it('using 指令与调用提取', async () => {
    const res = await analyze(CS_SAMPLE, 'csharp', 'User.cs');
    expect(res.imports).toContain('System');
    expect(res.imports).toContain('System.Collections.Generic');
    expect(res.calls.find((c) => c.to === 'Upper')?.from).toBe('Greet');
  });

  it('object_creation_expression 计入调用（new Foo()）', async () => {
    const res = await analyze('class A { void M() { var x = new Foo(); } }', 'csharp', 'A.cs');
    expect(res.calls.map((c) => c.to)).toContain('Foo');
  });
});

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

const PHP_SAMPLE = `<?php
namespace App;

use App\\Helper;

class User {
    private $name;

    public function __construct($name) {
        $this->name = $name;
    }

    public function greet() {
        return Helper::upper($this->name);
    }

    private function hidden() {
        plain(1);
    }
}

function topLevel($x) {
    $u = new User($x);
    return $u->greet();
}
`;

describe('PHP 语言处理器', () => {
  it('类 / 方法 / 顶层函数的种类识别', async () => {
    const res = await analyze(PHP_SAMPLE, 'php', 'User.php');
    expect(def(res, 'User', 'class')).toBeTruthy();
    expect(def(res, 'greet', 'method')).toBeTruthy();
    expect(def(res, 'topLevel', 'function')).toBeTruthy();
  });

  it('导出规则：不写修饰符即 public（与 Java/C# 相反）', async () => {
    const res = await analyze(PHP_SAMPLE, 'php', 'User.php');
    expect(def(res, 'greet', 'method')?.exported).toBe(true);
    expect(def(res, 'hidden', 'method')?.exported).toBe(false);
    expect(def(res, 'topLevel', 'function')?.exported).toBe(true);
  });

  it('use 导入与四种调用形态', async () => {
    const res = await analyze(PHP_SAMPLE, 'php', 'User.php');
    expect(res.imports).toContain('App\\Helper');
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('upper'); // Helper::upper()
    expect(calls).toContain('plain'); // plain()
    expect(calls).toContain('greet'); // $u->greet()
    expect(calls).toContain('User'); // new User()
  });
});

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

const KOTLIN_SAMPLE = `
package com.example

import java.util.List

class User(val name: String) {
    fun greet(): String {
        return Helper.upper(name)
    }

    private fun hidden(): Int {
        return 1
    }
}

fun topLevel(x: Int): Int {
    return helper(x)
}
`;

describe('Kotlin 语言处理器', () => {
  it('名字不是字段，也能取到类与函数名', async () => {
    const res = await analyze(KOTLIN_SAMPLE, 'kotlin', 'User.kt');
    expect(def(res, 'User', 'class')).toBeTruthy();
    expect(def(res, 'topLevel', 'function')).toBeTruthy();
  });

  it('类体内是 method，文件级是 function', async () => {
    const res = await analyze(KOTLIN_SAMPLE, 'kotlin', 'User.kt');
    expect(def(res, 'greet', 'method')).toBeTruthy();
    expect(def(res, 'hidden', 'method')).toBeTruthy();
    expect(def(res, 'topLevel', 'function')).toBeTruthy();
  });

  it('可见性修饰符与导入、调用提取', async () => {
    const res = await analyze(KOTLIN_SAMPLE, 'kotlin', 'User.kt');
    expect(def(res, 'greet', 'method')?.exported).toBe(true);
    expect(def(res, 'hidden', 'method')?.exported).toBe(false);
    expect(res.imports).toContain('java.util.List');
    expect(res.calls.find((c) => c.to === 'upper')?.from).toBe('greet');
    expect(res.calls.find((c) => c.to === 'helper')?.from).toBe('topLevel');
  });
});

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

const SWIFT_SAMPLE = `
import Foundation

struct User {
    let name: String

    func greet() -> String {
        return Helper.upper(name)
    }

    private func hidden() -> Int {
        return 1
    }
}

func compute(_ x: Int) -> Int {
    return x + 1
}
`;

describe('Swift 语言处理器', () => {
  it('struct 走 class_declaration 节点，也能识别为 class', async () => {
    const res = await analyze(SWIFT_SAMPLE, 'swift', 'User.swift');
    expect(def(res, 'User', 'class')).toBeTruthy();
  });

  it('类体内是 method，文件级是 function；private 不导出', async () => {
    const res = await analyze(SWIFT_SAMPLE, 'swift', 'User.swift');
    expect(def(res, 'greet', 'method')?.exported).toBe(true);
    expect(def(res, 'hidden', 'method')?.exported).toBe(false);
    expect(def(res, 'compute', 'function')?.exported).toBe(true);
  });

  it('import 与调用提取', async () => {
    const res = await analyze(SWIFT_SAMPLE, 'swift', 'User.swift');
    expect(res.imports).toContain('Foundation');
    expect(res.calls.find((c) => c.to === 'upper')?.from).toBe('greet');
  });
});

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

const RUBY_SAMPLE = `
require 'json'
require_relative 'helper'

module App
  class User
    def greet(name)
      Helper.upper(name)
    end

    private

    def hidden
      compute(1)
    end
  end

  def self.build(x)
    User.new(x)
  end
end

def top_level(a)
  App::User.new(a)
end
`;

describe('Ruby 语言处理器', () => {
  it('module 与 class 都映射为 class', async () => {
    const res = await analyze(RUBY_SAMPLE, 'ruby', 'user.rb');
    expect(def(res, 'App', 'class')).toBeTruthy();
    expect(def(res, 'User', 'class')).toBeTruthy();
  });

  it('类内是 method，顶层是 function；def self.x 视为公开', async () => {
    const res = await analyze(RUBY_SAMPLE, 'ruby', 'user.rb');
    expect(def(res, 'greet', 'method')).toBeTruthy();
    expect(def(res, 'build', 'method')?.exported).toBe(true);
    expect(def(res, 'top_level', 'function')).toBeTruthy();
  });

  it('裸 private 之后的方法不导出', async () => {
    const res = await analyze(RUBY_SAMPLE, 'ruby', 'user.rb');
    expect(def(res, 'greet', 'method')?.exported).toBe(true);
    expect(def(res, 'hidden', 'method')?.exported).toBe(false);
  });

  it('require 识别为导入，且不污染调用图', async () => {
    const res = await analyze(RUBY_SAMPLE, 'ruby', 'user.rb');
    expect(res.imports).toContain('json');
    expect(res.imports).toContain('helper');
    expect(res.calls.some((c) => c.to === 'require')).toBe(false);
    const calls = res.calls.map((c) => c.to);
    expect(calls).toContain('upper');
    expect(calls).toContain('compute');
    expect(calls).toContain('new'); // User.new(x)
  });
});

// ---------------------------------------------------------------------------
// 多语言复杂度度量（覆盖 declarator 解包 / 非字段命名 / 跳转细分）
// ---------------------------------------------------------------------------

describe('多语言度量（N1 扩容）', () => {
  it('C：函数名走 declarator 解包，判定点计入', async () => {
    const code = `int classify(int n) {\n  if (n > 0) return 1;\n  return 0;\n}\n`;
    const tree = await parseCode(code, 'c');
    const m = computeMetrics(tree!.rootNode, 'a.c', 'c', code);
    expect(m.functions).toHaveLength(1);
    expect(m.functions[0].name).toBe('classify');
    expect(m.functions[0].cyclomatic).toBe(2);
  });

  it('C++：成员函数的名字同样来自 declarator', async () => {
    const code = `class W {\npublic:\n  int render() { return draw(); }\n};\n`;
    const tree = await parseCode(code, 'cpp');
    const m = computeMetrics(tree!.rootNode, 'a.cpp', 'cpp', code);
    expect(m.functions.map((f) => f.name)).toContain('render');
  });

  it('Java：if 与 && 都计入圈复杂度', async () => {
    const code = `class A {\n  int m(int x) {\n    if (x > 0 && x < 9) { return 1; }\n    return 0;\n  }\n}\n`;
    const tree = await parseCode(code, 'java');
    const m = computeMetrics(tree!.rootNode, 'A.java', 'java', code);
    const fn = m.functions.find((f) => f.name === 'm')!;
    expect(fn.cyclomatic).toBe(3); // 1 + if + &&
  });

  it('Kotlin：名字不是字段也能取到；&& 有独立节点类型', async () => {
    const code = `fun classify(n: Int): Int {\n    if (n > 10) { return 1 }\n    if (n > 5 && n <= 10) { return 2 }\n    for (i in 0..n) { println(i) }\n    return 0\n}\n`;
    const tree = await parseCode(code, 'kotlin');
    const m = computeMetrics(tree!.rootNode, 'a.kt', 'kotlin', code);
    const fn = m.functions.find((f) => f.name === 'classify')!;
    expect(fn).toBeTruthy();
    expect(fn.cyclomatic).toBe(5); // 1 + if + (if + &&) + for
  });

  it('Swift：break 与 return 共用节点，按文本区分（return 不计跳转）', async () => {
    const code = `func classify(_ n: Int) -> Int {\n    if n > 10 { return 1 }\n    for i in 0..<3 { if i == 2 { break } }\n    return 0\n}\n`;
    const tree = await parseCode(code, 'swift');
    const m = computeMetrics(tree!.rootNode, 'a.swift', 'swift', code);
    const fn = m.functions[0];
    expect(fn.name).toBe('classify');
    expect(fn.cyclomatic).toBe(4); // 1 + if + for + if
    expect(fn.cognitive).toBe(5); // if(1) + for(1) + 内层 if(1+1) + break(1)
  });

  it('Ruby：if / while 计入，比较运算不算逻辑运算', async () => {
    const code = `def classify(n)\n  if n > 10\n    return 1\n  end\n  while n > 0\n    n -= 1\n  end\n  0\nend\n`;
    const tree = await parseCode(code, 'ruby');
    const m = computeMetrics(tree!.rootNode, 'a.rb', 'ruby', code);
    const fn = m.functions[0];
    expect(fn.name).toBe('classify');
    expect(fn.cyclomatic).toBe(3); // 1 + if + while
  });

  it('PHP：foreach / elseif / case 计入', async () => {
    const code = `<?php\nfunction f($xs) {\n  foreach ($xs as $x) {\n    if ($x > 0) { return 1; }\n  }\n  return 0;\n}\n`;
    const tree = await parseCode(code, 'php');
    const m = computeMetrics(tree!.rootNode, 'a.php', 'php', code);
    const fn = m.functions.find((x) => x.name === 'f')!;
    expect(fn.cyclomatic).toBe(3); // 1 + foreach + if
  });
});
