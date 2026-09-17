import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configureParserEnv, parseCode, langOfPath, type LangId } from '../../src/analysis/parser';
import { extractFile } from '../../src/analysis/symbols';

const require = createRequire(import.meta.url);

/** 测试环境：直接指向 node_modules 里的 wasm（浏览器走 public/grammars） */
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

const TS_SAMPLE = `
import { helper } from './helper';
import fs from 'fs';

export function loadConfig(path: string): Config {
  const raw = fs.readFileSync(path);
  return JSON.parse(raw);
}

function internalHelper(x: number) {
  return helper(x) + 1;
}

export class Loader {
  run() {
    return internalHelper(2);
  }
}

const callback = () => {
  return internalHelper(3);
};
`;

const PY_SAMPLE = `
import os
from typing import List

def load_config(path):
    return _parse(open(path).read())

def _parse(text):
    return text.strip()

class Loader:
    def run(self):
        return load_config("a.toml")
`;

describe('langOfPath（扩展名 → 语言）', () => {
  it('识别 JS/TS/Python 家族', () => {
    expect(langOfPath('src/a.ts')).toBe('typescript');
    expect(langOfPath('src/a.tsx')).toBe('tsx');
    expect(langOfPath('src/a.js')).toBe('javascript');
    expect(langOfPath('a/b/c.py')).toBe('python');
    expect(langOfPath('README.md')).toBeNull();
    expect(langOfPath('noext')).toBeNull();
  });
});

describe('extractFile + tree-sitter 真实解析（TypeScript）', () => {
  it('提取定义（函数/类/方法/箭头函数）、调用与导入', async () => {
    const parsed = await parseCode(TS_SAMPLE, 'typescript');
    expect(parsed).not.toBeNull();
    const analysis = extractFile(parsed!.rootNode, 'src/config.ts', 'typescript');

    const names = analysis.definitions.map((d) => `${d.kind}:${d.name}`);
    expect(names).toContain('function:loadConfig');
    expect(names).toContain('function:internalHelper');
    expect(names).toContain('class:Loader');
    expect(names).toContain('method:run');
    expect(names).toContain('function:callback');

    // 导出标记
    const loadConfig = analysis.definitions.find((d) => d.name === 'loadConfig')!;
    expect(loadConfig.exported).toBe(true);
    const internal = analysis.definitions.find((d) => d.name === 'internalHelper')!;
    expect(internal.exported).toBe(false);

    // 导入模块路径
    expect(analysis.imports).toContain('./helper');
    expect(analysis.imports).toContain('fs');

    // 调用关系：run() 调用了 internalHelper
    const callInRun = analysis.calls.find((c) => c.to === 'internalHelper' && c.from === 'run');
    expect(callInRun).toBeTruthy();
    // 成员调用取属性名：fs.readFileSync → readFileSync
    expect(analysis.calls.some((c) => c.to === 'readFileSync')).toBe(true);

    // 行号必须是 1-based 且落在文件范围内
    for (const d of analysis.definitions) {
      expect(d.line).toBeGreaterThan(0);
      expect(d.endLine).toBeGreaterThanOrEqual(d.line);
    }
  });

  it('提取函数签名（不含函数体）', async () => {
    const parsed = await parseCode(TS_SAMPLE, 'typescript');
    const analysis = extractFile(parsed!.rootNode, 'src/config.ts', 'typescript');
    const sig = analysis.definitions.find((d) => d.name === 'loadConfig')!.signature;
    expect(sig).toContain('loadConfig');
    expect(sig).toContain('string');
    expect(sig).not.toContain('readFileSync'); // 函数体不应出现在签名里
  });
});

describe('extractFile（Python）', () => {
  it('提取 def/class/方法调用与 import', async () => {
    const parsed = await parseCode(PY_SAMPLE, 'python');
    expect(parsed).not.toBeNull();
    const analysis = extractFile(parsed!.rootNode, 'pkg/app.py', 'python');

    const kinds = analysis.definitions.map((d) => `${d.kind}:${d.name}`);
    expect(kinds).toContain('function:load_config');
    expect(kinds).toContain('function:_parse');
    expect(kinds).toContain('class:Loader');
    expect(kinds).toContain('method:run');

    expect(analysis.imports.some((i) => i.includes('os'))).toBe(true);

    // Python 调用节点为 call
    expect(analysis.calls.some((c) => c.to === '_parse')).toBe(true);
    expect(analysis.calls.some((c) => c.to === 'load_config' && c.from === 'run')).toBe(true);
  });

  it('Python 顶层函数默认视为公开（非 _ 前缀）', async () => {
    const parsed = await parseCode(PY_SAMPLE, 'python');
    const analysis = extractFile(parsed!.rootNode, 'pkg/app.py', 'python');
    expect(analysis.definitions.find((d) => d.name === 'load_config')!.exported).toBe(true);
    expect(analysis.definitions.find((d) => d.name === '_parse')!.exported).toBe(false);
  });
});

describe('降级行为', () => {
  it('语法错误时不抛异常，仍返回部分结果（hasError 标记为 true）', async () => {
    const broken = 'function ok(){ return 1; }\nfunction broken( {\n  ??? \n';
    const parsed = await parseCode(broken, 'typescript');
    expect(parsed).not.toBeNull();
    expect(parsed!.hasError).toBe(true);
    const analysis = extractFile(parsed!.rootNode, 'broken.ts', 'typescript');
    expect(analysis.hasError).toBe(true);
    expect(analysis.definitions.some((d) => d.name === 'ok')).toBe(true);
  });
});
