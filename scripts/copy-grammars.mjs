/**
 * 把 tree-sitter 运行时与语法包复制到 public/grammars/
 *
 * 背景：web-tree-sitter 的运行时 wasm 与 tree-sitter-wasms 的语法包都在 node_modules 里，
 * 浏览器/Tauri 需要能通过 URL 访问它们，所以在 dev/build 前统一复制到 public/ 下。
 * 复制为构建步骤（predev / prebuild），产物目录 public/grammars 不纳入版本控制。
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'public', 'grammars');

/**
 * 支持分析的语法包（需与 src/analysis/parser.ts 的 LangId 保持一致）。
 * 注意：此处写的是**语法包名**（wasm 文件名 tree-sitter-<name>.wasm 里的 name），
 * C# 的包名是 `c_sharp`，而 LangId 是 `csharp` —— 两者由 parser.ts 的 GRAMMAR_FILE 映射。
 */
const GRAMMARS = [
  'javascript',
  'typescript',
  'tsx',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'c_sharp',
  'php',
  'kotlin',
  'swift',
  'ruby',
];

async function main() {
  await mkdir(outDir, { recursive: true });

  // 1) 运行时 wasm（文件名随 web-tree-sitter 版本变化，逐个探测）
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const runtime = ['web-tree-sitter.wasm', 'tree-sitter.wasm']
    .map((n) => path.join(wtDir, n))
    .find((p) => existsSync(p));
  if (!runtime) throw new Error('web-tree-sitter runtime wasm not found');
  await copyFile(runtime, path.join(outDir, 'tree-sitter.wasm'));

  // 2) 各语言语法包
  const grammarDir = path.join(
    path.dirname(require.resolve('tree-sitter-wasms/package.json')),
    'out',
  );
  let copied = 0;
  for (const lang of GRAMMARS) {
    const src = path.join(grammarDir, `tree-sitter-${lang}.wasm`);
    if (!existsSync(src)) {
      console.warn(`[grammars] skip missing grammar: ${lang}`);
      continue;
    }
    await copyFile(src, path.join(outDir, `tree-sitter-${lang}.wasm`));
    copied++;
  }

  console.log(`[grammars] runtime + ${copied}/${GRAMMARS.length} grammars -> public/grammars`);
}

main().catch((e) => {
  console.error('[grammars] failed:', e);
  process.exit(1);
});
