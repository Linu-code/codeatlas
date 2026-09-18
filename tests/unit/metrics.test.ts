import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { configureParserEnv, parseCode, type LangId } from '../../src/analysis/parser';
import {
  COGNITIVE_WARN,
  CYCLOMATIC_WARN,
  computeMetrics,
  healthScore,
  type FileMetrics,
} from '../../src/analysis/metrics';

const require = createRequire(import.meta.url);

beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    // 入参是语法包名（grammarFileName 已由 parser 内部换算）
    grammarWasm: (grammar) => path.join(grammarDir, `tree-sitter-${grammar}.wasm`),
  });
});

async function metricsOf(code: string, lang: LangId, filePath = 'a.ts'): Promise<FileMetrics> {
  const parsed = await parseCode(code, lang);
  if (!parsed) throw new Error('parse failed');
  return computeMetrics(parsed.rootNode, filePath, lang, code);
}

/** 圈复杂度 = 1 + 判定点：3 个 if + 1 个 for + 1 个 && = 1 + 5 = 6 */
const SIMPLE_TS = `
export function classify(n: number) {
  let out = '';
  if (n > 10) out = 'big';
  if (n > 5 && n <= 10) out = 'mid';
  if (n > 0) out = 'small';
  for (let i = 0; i < n; i++) out += '.';
  return out;
}
`;

/** 认知复杂度验证：嵌套加权（if 内再 if → +1 与 +(1+1)） */
const NESTED_TS = `
export function deep(a: number, b: number) {
  if (a > 0) {          // +1（深度 0）
    if (b > 0) {        // +1 + 1（深度 1）
      while (a > b) {   // +1 + 2（深度 2）
        a--;
      }
    }
  }
  return a;
}
`;

const PY_SAMPLE = `
def classify(n):
    if n > 10:
        return "big"
    elif n > 5:
        return "mid"
    elif n > 0 and n <= 5:
        return "small"
    for i in range(n):
        print(i)
    return "zero"
`;

describe('computeMetrics —— 圈复杂度（McCabe）', () => {
  it('TS 函数：if/for/&& 逐个计入', async () => {
    const m = await metricsOf(SIMPLE_TS, 'typescript');
    const fn = m.functions.find((f) => f.name === 'classify')!;
    expect(fn.cyclomatic).toBe(6);
    expect(fn.line).toBe(2);
  });

  it('无分支函数复杂度为 1（基准值）', async () => {
    const m = await metricsOf('export function noop() { return 1; }', 'typescript');
    expect(m.functions[0].cyclomatic).toBe(1);
    expect(m.functions[0].cognitive).toBe(0);
  });

  it('Python：if/elif/for/and 均计入', async () => {
    const m = await metricsOf(PY_SAMPLE, 'python', 'app.py');
    const fn = m.functions.find((f) => f.name === 'classify')!;
    // 1 + if + elif + elif + and + for = 6
    expect(fn.cyclomatic).toBe(6);
  });

  it('文件级复杂度 = 函数之和 + 模块级判定点', async () => {
    const code = `
if (typeof window !== 'undefined') { console.log('top'); }
export function a() { return 1; }
`;
    const m = await metricsOf(code, 'typescript');
    expect(m.cyclomatic).toBe(2); // 顶层 if(1) + 函数基准(1)
  });
});

describe('computeMetrics —— 认知复杂度（SonarSource 简化）', () => {
  it('嵌套结构按深度加权', async () => {
    const m = await metricsOf(NESTED_TS, 'typescript');
    const fn = m.functions.find((f) => f.name === 'deep')!;
    // if(+1) + if(+1+1) + while(+1+2) = 6
    expect(fn.cognitive).toBe(6);
  });

  it('扁平 if 序列不叠加嵌套权重', async () => {
    const code = `
export function flat(a) {
  if (a === 1) return 1;
  if (a === 2) return 2;
  if (a === 3) return 3;
  return 0;
}
`;
    const m = await metricsOf(code, 'typescript');
    expect(m.functions[0].cognitive).toBe(3);
  });

  it('break/continue 计入但不受嵌套加权', async () => {
    const code = `
export function loopLoop(xs) {
  for (const x of xs) {
    if (!x) continue;
    if (x > 100) break;
  }
  return xs.length;
}
`;
    const m = await metricsOf(code, 'typescript');
    const fn = m.functions[0];
    // for(1) + if(1+1) + continue(1) + if(1+1) + break(1) = 7
    expect(fn.cognitive).toBe(7);
  });
});

describe('computeMetrics —— SLOC', () => {
  it('注释与空行不计入代码行', async () => {
    const code = `// 头部注释
// 第二行注释

export function a() {
  // 内部注释
  return 1;
}
`;
    const m = await metricsOf(code, 'typescript');
    expect(m.totalLines).toBe(8);
    expect(m.commentLines).toBe(3);
    // 代码行：export function a() { / return 1; / } = 3
    expect(m.sloc).toBe(3);
  });

  it('多行块注释整体计入注释行', async () => {
    const code = `/*
 * 文档注释
 * 第二行
 */
export const a = 1;
`;
    const m = await metricsOf(code, 'typescript');
    expect(m.commentLines).toBe(4);
    expect(m.sloc).toBe(1);
  });
});

describe('healthScore（项目健康评分）', () => {
  const fake = (funcs: { cyclomatic: number; cognitive: number }[]): FileMetrics[] => [
    {
      path: 'a.ts',
      language: 'typescript',
      cyclomatic: funcs.reduce((s, f) => s + f.cyclomatic, 0),
      cognitive: funcs.reduce((s, f) => s + f.cognitive, 0),
      totalLines: 100,
      sloc: 80,
      commentLines: 10,
      functions: funcs.map((f, i) => ({
        name: `f${i}`,
        line: i + 1,
        endLine: i + 5,
        cyclomatic: f.cyclomatic,
        cognitive: f.cognitive,
        sloc: 5,
      })),
      maxFunctionComplexity: Math.max(0, ...funcs.map((f) => f.cyclomatic)),
    },
  ];

  it('全部低复杂度 → 满分 100', () => {
    const health = healthScore(fake([{ cyclomatic: 2, cognitive: 1 }, { cyclomatic: 3, cognitive: 2 }]));
    expect(health.score).toBe(100);
    expect(health.highComplexityCount).toBe(0);
    expect(health.avgCyclomatic).toBeCloseTo(2.5, 2);
  });

  it('高复杂度函数按阈值扣分', () => {
    const health = healthScore(
      fake([
        { cyclomatic: CYCLOMATIC_WARN + 1, cognitive: COGNITIVE_WARN + 1 }, // 各扣 3 + 2
        { cyclomatic: 2, cognitive: 1 },
      ]),
    );
    expect(health.highComplexityCount).toBe(2); // 圈 + 认知 各 1 个
    expect(health.score).toBeLessThan(100);
  });

  it('极差代码时评分钳制到 0（不会出现负分）', () => {
    const health = healthScore(
      fake(Array.from({ length: 20 }, () => ({ cyclomatic: 40, cognitive: 60 }))),
    );
    expect(health.score).toBe(0);
  });

  it('平均复杂度过高时按超出量扣分（但仍为正分）', () => {
    const health = healthScore(fake([{ cyclomatic: 40, cognitive: 60 }]));
    // 100 - 高复杂度扣分(5) - 平均复杂度扣分 = 仍大于 0 且明显低于 100
    expect(health.score).toBeGreaterThan(0);
    expect(health.score).toBeLessThan(60);
  });

  it('无函数时评分为 100', () => {
    expect(healthScore([]).score).toBe(100);
  });
});
