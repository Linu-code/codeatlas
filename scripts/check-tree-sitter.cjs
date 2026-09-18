/**
 * tree-sitter 环境自检脚本（开发/CI 诊断用）
 *
 * 作用：在 Node 环境下真实加载 web-tree-sitter 与 tree-sitter-wasms 语法包，
 * 对**每一种受支持语言**解析一段样例代码，验证三件事：
 *   ① 运行时与语法包 ABI 兼容（0.25+ 的 dylink 变更会让旧 ABI 包加载失败）
 *   ② 语法包版本没有引入回归（样例必须无语法错误）
 *   ③ 多语言共存安全（全部语法包加载进同一运行时后，再回头复解析仍正常）
 *
 * 背景（踩过的坑）：
 *   · web-tree-sitter 0.25+ 使用新版 dylink 段加载 wasm，与 tree-sitter-wasms
 *     （旧 ABI 构建）不兼容，会报 `getDylinkMetadata` 失败 —— 因此项目锁定
 *     web-tree-sitter@0.22.6 + tree-sitter-wasms@0.1.13 这一组合。
 *   · 部分语法包本身有缺陷，已逐一实测并排除（见 EXCLUDED 注释）。
 *     升级 tree-sitter-wasms 时应重新评估这些语言是否可用。
 *
 * 运行：node scripts/check-tree-sitter.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

/**
 * 受支持语言的样例代码（键为**语法包名**，即 tree-sitter-<name>.wasm 里的 name）。
 * 样例刻意保持极小，只要求能无错解析 —— 这是语法包可用性的最小充分条件。
 */
const LANG_SAMPLES = {
  javascript: 'export function foo(){ return bar(); }\n',
  typescript: 'export class A { run(): number { return helper(); } }\n',
  tsx: 'export function A() { return <div>{x()}</div>; }\n',
  python: 'def foo():\n    return bar()\n',
  go: 'package main\n\nfunc a() { b() }\n',
  rust: 'pub fn a() { b(); }\n',
  java: 'class A { void a() { b(); } }\n',
  c: 'int a(void) { return b(); }\n',
  cpp: 'int a() { return b(); }\n',
  c_sharp: 'class A { void M() { B(); } }\n',
  php: '<?php\nfunction a() { b(); }\n',
  kotlin: 'fun a() { b() }\n',
  swift: 'func a() { b() }\n',
  ruby: 'def a\n  b()\nend\n',
};

/**
 * 已实测排除的语言（不参与断言，仅作文档化）：
 *   lua   —— 与其它语法包共存时解析失败（单独加载正常），且 dispose 后不可恢复
 *   bash  —— 遇到 `case ... esac` 会直接抛异常（"_ is not a function"）
 *   scala —— 语法包无法识别 while / for（被解析成 infix_expression）
 *   dart  —— 语言版本 15，超出运行时支持范围（13–14）
 *   elm / ql —— 加载即报 memory access out of bounds
 * 处理方式：待 tree-sitter-wasms 上游修复后重新实测，再决定是否纳入。
 */
const EXCLUDED = {
  lua: '多语言共存时解析失败',
  bash: 'case 语句导致语法包抛异常',
  scala: '无法识别 while / for',
  dart: '语言版本 15 与运行时（13–14）不兼容',
  elm: '加载报 memory access out of bounds',
  ql: '加载报 memory access out of bounds',
};

/** web-tree-sitter 运行时 wasm 的文件名随版本变化，逐个探测 */
function runtimeWasmPath() {
  const dir = path.dirname(require.resolve('web-tree-sitter'));
  for (const name of ['web-tree-sitter.wasm', 'tree-sitter.wasm']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`runtime wasm not found in ${dir}`);
}

/** 语法包所在目录（tree-sitter-wasms/out） */
function grammarDir() {
  return path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
}

(async () => {
  const wt = require('web-tree-sitter');
  const Parser = wt.Parser ?? wt;

  // 0.22 中 Language/Query 等静态成员是在 init() 完成后才挂到 Parser 上的
  const treeSitter = await Parser.init({ locateFile: () => runtimeWasmPath() });
  const Language = Parser.Language ?? (treeSitter && treeSitter.Language);
  console.log(
    `web-tree-sitter runtime wasm = ${path.basename(runtimeWasmPath())}` +
      (wt.LANGUAGE_VERSION ? ` (LANGUAGE_VERSION=${wt.LANGUAGE_VERSION})` : ''),
  );
  console.log(`受支持语法包 ${Object.keys(LANG_SAMPLES).length} 个，逐一解析样例：`);

  let failed = 0;
  const parsers = new Map();

  // ---------- 阶段 1：加载并解析 ----------
  for (const [lang, code] of Object.entries(LANG_SAMPLES)) {
    try {
      const wasm = path.join(grammarDir(), `tree-sitter-${lang}.wasm`);
      if (!fs.existsSync(wasm)) throw new Error(`grammar wasm missing: ${wasm}`);

      const language = await Language.load(wasm);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(code);
      const root = tree.rootNode;
      if (root.hasError) throw new Error('样例解析出现语法错误（语法包可能已变更）');
      parsers.set(lang, parser);
      console.log(`[ok] ${lang.padEnd(10)} root=${root.type} children=${root.childCount}`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${lang.padEnd(10)} ${e instanceof Error ? e.message || e.name : String(e)}`);
    }
  }

  // ---------- 阶段 2：共存复解析（防"加载多个后状态损坏"） ----------
  if (failed === 0) {
    let contaminated = 0;
    for (const [lang, parser] of parsers) {
      const tree = parser.parse(LANG_SAMPLES[lang]);
      if (tree.rootNode.hasError) {
        contaminated++;
        console.log(`[FAIL] ${lang.padEnd(10)} ${Object.keys(LANG_SAMPLES).length} 个语法包共存后复解析失败`);
      }
    }
    if (contaminated === 0) {
      console.log(`[ok] 共存复解析：${parsers.size} 个语法包在同一运行时内互不影响`);
    } else {
      failed += contaminated;
    }
  }

  for (const p of parsers.values()) {
    try {
      p.delete();
    } catch {
      // 忽略释放异常
    }
  }

  console.log('');
  console.log(`已知排除（不在断言范围，详见脚本内 EXCLUDED 注释）：`);
  for (const [lang, reason] of Object.entries(EXCLUDED)) {
    console.log(`  - ${lang.padEnd(6)} ${reason}`);
  }

  process.exit(failed === 0 ? 0 : 1);
})();
