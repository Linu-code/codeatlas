/**
 * tree-sitter 环境自检脚本（开发/CI 诊断用）
 *
 * 作用：在 Node 环境下真实加载 web-tree-sitter 与 tree-sitter-wasms 语法包，
 * 解析一段 JS/TS/Python 代码并打印 AST 根节点，验证二者 ABI 兼容性。
 *
 * 背景（踩过的坑）：web-tree-sitter 0.25+ 使用新版 dylink 段加载 wasm，
 * 与 tree-sitter-wasms（旧 ABI 构建）不兼容，会报 `getDylinkMetadata` 失败。
 * 因此项目锁定 web-tree-sitter 0.22.6 + tree-sitter-wasms 0.1.13 这一组合。
 *
 * 运行：node scripts/check-tree-sitter.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

const SAMPLES = {
  javascript: 'function foo(){ return bar(); }\nfunction bar(){ return 1; }\n',
  typescript:
    'class A { run(): number { return helper(); } }\nfunction helper(): number { return 1; }\n',
  python: 'def foo():\n    return bar()\n\ndef bar():\n    return 1\n',
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

  let failed = 0;
  for (const [lang, code] of Object.entries(SAMPLES)) {
    try {
      const wasm = path.join(
        path.dirname(require.resolve('tree-sitter-wasms/package.json')),
        'out',
        `tree-sitter-${lang}.wasm`,
      );
      if (!fs.existsSync(wasm)) throw new Error(`grammar wasm missing: ${wasm}`);

      const language = await Language.load(wasm);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(code);
      const root = tree.rootNode;
      console.log(`[ok] ${lang}: root=${root.type} children=${root.childCount}`);
      parser.delete();
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${lang}: ${e instanceof Error ? e.message || e.name : String(e)}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
