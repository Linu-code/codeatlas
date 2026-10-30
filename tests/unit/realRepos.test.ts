/**
 * 真实仓库 · 宣称能力核查（可长期回归）
 *
 * 用 5 个形态各异的真实仓库跑「我们对外宣称的能力」，每项输出 PASS/FAIL + 数字。
 * 依赖本地样本仓库（`%TEMP%/carepos/extract/<repo>`），缺失时整体跳过，
 * 不影响 CI。准备样本见 `docs/VERIFY-5.0.md`。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { configureParserEnv, langOfPath, parseCode } from '../../src/analysis/parser';
import { extractFile, type FileAnalysis } from '../../src/analysis/symbols';
import { buildScopeIndex } from '../../src/analysis/scopeGraph';
import { generateContextPack, rankSymbols, PACK_INTENTS, type PackIntent } from '../../src/analysis/contextPack';
import { buildDirectoryDigest, buildFileSymbolIndex } from '../../src/analysis/hierarchy';
import { formatSlice, resolveAddress } from '../../src/analysis/slice';
import { computeLedger, planEviction, type SessionSlice } from '../../src/analysis/session';
import { estimateTokens } from '../../src/utils/tokenEstimator';
import { moduleOf } from '../../src/analysis/moduleGraph';

const require = createRequire(import.meta.url);
beforeAll(() => {
  const wtDir = path.dirname(require.resolve('web-tree-sitter'));
  const grammarDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  configureParserEnv({
    runtimeWasm: () => path.join(wtDir, 'tree-sitter.wasm'),
    grammarWasm: (g) => path.join(grammarDir, `tree-sitter-${g}.wasm`),
  });
});

const ROOT = path.join(process.env.TEMP ?? '/tmp', 'carepos', 'extract');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', 'vendor'].includes(e.name)) continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

interface Loaded {
  name: string;
  root: string;
  files: FileAnalysis[];
  paths: string[];
  index: ReturnType<typeof buildScopeIndex>;
}
const cache = new Map<string, Loaded>();

async function load(repo: string): Promise<Loaded> {
  const hit = cache.get(repo);
  if (hit) return hit;
  const base = path.join(ROOT, repo);
  const inner = fs.readdirSync(base, { withFileTypes: true }).find((e) => e.isDirectory())!;
  const root = path.join(base, inner.name);
  const all = walk(root);
  const files: FileAnalysis[] = [];
  for (const abs of all) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const lang = langOfPath(rel);
    if (!lang) continue;
    if (fs.statSync(abs).size > 400_000) continue;
    const parsed = await parseCode(fs.readFileSync(abs, 'utf8'), lang);
    if (parsed) files.push(extractFile(parsed.rootNode, rel, lang));
  }
  const loaded: Loaded = {
    name: repo,
    root,
    files,
    paths: all.map((p) => path.relative(root, p).replace(/\\/g, '/')),
    index: buildScopeIndex(files),
  };
  cache.set(repo, loaded);
  return loaded;
}

const REPOS = ['expressjs_express', 'egoist_tsup', 'vuejs_core', 'pallets_flask', 'gin-gonic_gin'];
const FIXTURES_READY = REPOS.every((r) => fs.existsSync(path.join(ROOT, r)));
const describeReal = FIXTURES_READY ? describe : describe.skip;
const results: string[] = [];
function record(ok: boolean, id: string, detail: string) {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
}

describeReal('真实仓库 · 宣称能力核查', () => {
  it('C1 五种用途 × 三档预算：不超预算、不空包、仍有代码结构', async () => {
    let bad = 0;
    const rows: string[] = [];
    for (const repo of REPOS) {
      const { files, index, paths } = await load(repo);
      for (const intent of PACK_INTENTS) {
        for (const budget of [2000, 8000, 32000]) {
          const pack = generateContextPack({
            repoName: repo,
            files,
            index,
            treePaths: paths,
            maxTokens: budget,
            intent: intent as PackIntent,
            focusQuery: 'render',
          });
          const over = pack.tokens > budget;
          const empty = !pack.markdown.includes('## 项目概览');
          if (over || empty) {
            bad += 1;
            rows.push(`${repo}/${intent}/${budget}: tokens=${pack.tokens} over=${over} empty=${empty}`);
          }
        }
      }
    }
    record(bad === 0, 'C1', `75 组（5 仓库 × 5 用途 × 3 预算）超限/空包=${bad}${bad ? ' ' + rows.slice(0, 3).join(' | ') : ''}`);
    expect(bad).toBe(0);
  }, 300_000);

  it('C2 索引地址可解析率（多语言：JS/TS/Python/Go）', async () => {
    for (const repo of REPOS) {
      const { files, index, paths } = await load(repo);
      const pack = generateContextPack({ repoName: repo, files, index, treePaths: paths, maxTokens: 8000, intent: 'index' });
      const addrs = [...pack.markdown.matchAll(/`([^`\s]+:\d+)`/g)].map((m) => m[1]);
      // 排除使用说明里的示例（它们也应是真实地址，这里只统计符号索引区的）
      const body = pack.markdown.split('## 符号索引')[1] ?? '';
      const symbolAddrs = [...body.matchAll(/`([^`\s]+:\d+)`/g)].map((m) => m[1]);
      let ok = 0;
      for (const a of symbolAddrs) {
        const r = resolveAddress(a, { files, paths });
        if (r.kind === 'ok') ok += 1;
      }
      record(
        symbolAddrs.length > 0 && ok === symbolAddrs.length,
        `C2.${repo}`,
        `索引地址 ${ok}/${symbolAddrs.length}（另有说明区示例 ${addrs.length - symbolAddrs.length} 条）`,
      );
      expect(ok).toBe(symbolAddrs.length);
    }
  });

  it('C3 任意符号三级可达（每仓库抽样 ≤120）', async () => {
    for (const repo of REPOS) {
      const { files, index, paths } = await load(repo);
      const ranked = rankSymbols({ repoName: repo, files, index, treePaths: paths, maxTokens: 2000 });
      const step = Math.max(1, Math.floor(ranked.length / 120));
      const sample = ranked.filter((_, i) => i % step === 0).slice(0, 120);
      let reachable = 0;
      let cost = 0;
      for (const s of sample) {
        const mod = moduleOf(s.file);
        const digest = buildDirectoryDigest(mod === '(root)' ? '' : mod, files, { maxTokens: 1200 });
        const fileIdx = buildFileSymbolIndex(s.file, files);
        const r = resolveAddress(`${s.file}:${s.line}`, { files, paths });
        if (!digest.text || !fileIdx || r.kind !== 'ok') continue;
        reachable += 1;
        cost += estimateTokens(digest.text) + estimateTokens(fileIdx.text);
      }
      record(reachable === sample.length, `C3.${repo}`, `${reachable}/${sample.length} 可达，三次寻址均值 ${Math.round(cost / Math.max(reachable, 1))} token（不含代码）`);
      expect(reachable).toBe(sample.length);
    }
  });

  it('C4 单行地址扩展到整个函数（抽样）', async () => {
    for (const repo of REPOS) {
      const { files, paths, root } = await load(repo);
      let covered = 0;
      let total = 0;
      let sampled = 0;
      for (const f of files) {
        const src = fs.readFileSync(path.join(root, f.path), 'utf8');
        for (const d of f.definitions) {
          if (d.endLine <= d.line) continue;
          total += 1;
          if (total % 17 !== 0) continue;
          sampled += 1;
          const mid = d.line + Math.floor((d.endLine - d.line) / 2);
          const r = resolveAddress(`${f.path}:${mid}`, { files, paths });
          if (r.kind !== 'ok') continue;
          const s = formatSlice(src, r.target, { maxTokens: 1500 });
          if (s.startLine <= d.line && s.endLine >= d.endLine) covered += 1;
        }
      }
      record(
        sampled > 0 && covered / sampled > 0.7,
        `C4.${repo}`,
        `抽样 ${sampled} 个函数，完整取到 ${covered}（${((covered / sampled) * 100).toFixed(1)}%）`,
      );
      expect(covered / Math.max(sampled, 1)).toBeGreaterThan(0.7);
    }
  });

  it('C4b 符号体量分布（判断 1500 截断上限是否合理）', async () => {
    for (const repo of REPOS) {
      const { files, root } = await load(repo);
      const toks: number[] = [];
      for (const f of files) {
        const src = fs.readFileSync(path.join(root, f.path), 'utf8').split(/\r\n|\r|\n/);
        for (const d of f.definitions) {
          if (d.endLine <= d.line) continue;
          toks.push(estimateTokens(src.slice(d.line - 1, d.endLine).join('\n')));
        }
      }
      toks.sort((a, b) => a - b);
      const p = (q: number) => toks[Math.min(toks.length - 1, Math.floor((toks.length * q) / 100))] ?? 0;
      const over1500 = toks.filter((t) => t > 1500).length;
      const over3000 = toks.filter((t) => t > 3000).length;
      record(
        toks.length > 0,
        `C4b.${repo}`,
        `符号 ${toks.length} 个，p50=${p(50)} p90=${p(90)} p99=${p(99)} max=${toks[toks.length - 1]}；>1500 占 ${((over1500 / toks.length) * 100).toFixed(1)}%，>3000 占 ${((over3000 / toks.length) * 100).toFixed(1)}%`,
      );
      expect(toks.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('C5 目录摘要：有子目录/文件，且不超 1200 token', async () => {
    for (const repo of REPOS) {
      const { files } = await load(repo);
      const d = buildDirectoryDigest('', files, { maxTokens: 1200 });
      const t = estimateTokens(d.text);
      const hasFiles = d.text.includes('`');
      record(t <= 1200 && hasFiles, `C5.${repo}`, `根摘要 ${t} token，${d.fileCount} 文件 / ${d.symbolCount} 符号，truncated=${d.truncated}`);
      expect(t).toBeLessThanOrEqual(1200);
    }
  });

  it('C6 文件符号清单条目数 = 该文件定义数', async () => {
    for (const repo of REPOS) {
      const { files } = await load(repo);
      const target = files.slice().sort((a, b) => b.definitions.length - a.definitions.length)[0];
      const r = buildFileSymbolIndex(target.path, files);
      const lines = (r?.text ?? '').split('\n').filter((l) => l.startsWith('- ')).length;
      record(lines === target.definitions.length, `C6.${repo}`, `${target.path}: ${lines}/${target.definitions.length} 条`);
      expect(lines).toBe(target.definitions.length);
    }
  });

  it('C7 会话淘汰：10 个片段在 2× 包预算内收敛', () => {
    const pack = 1000;
    const slices: SessionSlice[] = Array.from({ length: 10 }, (_, i) => ({
      address: `src/f${i}.ts:${i + 1}`,
      tokens: 300,
      round: i,
      hits: i === 3 ? 2 : 0,
    }));
    const plan = planEviction(slices, pack * 2);
    const ledger = computeLedger({ packTokens: pack, slices, plan });
    const newestKept = plan.kept.some((s) => s.round === 9);
    const hitKept = plan.kept.some((s) => s.round === 3);
    record(
      ledger.tokens <= pack * 3 && newestKept && hitKept,
      'C7',
      `窗口 ${ledger.tokens} token（上限 ${pack * 3}），保留 ${plan.kept.length}/10，最新保留=${newestKept}，被引用者保留=${hitKept}`,
    );
    expect(ledger.tokens).toBeLessThanOrEqual(pack * 3);
  });

  it('C8 账本倍数与真实文件 token 一致', async () => {
    const { files, paths, root } = await load('egoist_tsup');
    const f = files.find((x) => x.definitions.length > 3)!;
    const src = fs.readFileSync(path.join(root, f.path), 'utf8');
    const fileTokens = estimateTokens(src);
    const r = resolveAddress(`${f.path}:${f.definitions[0].line}`, { files, paths });
    if (r.kind !== 'ok') throw new Error('address should resolve');
    const s = formatSlice(src, r.target, { maxTokens: 1500 });
    const slices: SessionSlice[] = [{ address: `${f.path}:${f.definitions[0].line}`, tokens: s.tokens, fileTokens, round: 0, hits: 0 }];
    const ledger = computeLedger({ packTokens: 800, slices, plan: planEviction(slices, 0) });
    const expectRatio = Math.round((fileTokens / (800 + s.tokens)) * 10) / 10;
    record(ledger.ratio === expectRatio, 'C8', `ratio=${ledger.ratio} 期望=${expectRatio}（整份 ${fileTokens} / 会话 ${800 + s.tokens}）`);
    expect(ledger.ratio).toBe(expectRatio);
  });

  it('C9 无源码仓库（只有 README）不崩且如实说明', async () => {
    const index = buildScopeIndex([]);
    const pack = generateContextPack({ repoName: 'octocat/Hello-World', files: [], index, treePaths: ['README'], maxTokens: 2000 });
    const hasOverview = pack.markdown.includes('## 项目概览');
    record(pack.tokens <= 2000 && hasOverview, 'C9', `tokens=${pack.tokens} 概览=${hasOverview} 符号=${pack.totalSymbols}`);
    expect(hasOverview).toBe(true);
  });

  it('C10 索引条目不携带签名', async () => {
    const { files, index, paths } = await load('egoist_tsup');
    const pack = generateContextPack({ repoName: 'egoist_tsup', files, index, treePaths: paths, maxTokens: 8000, intent: 'index' });
    const body = pack.markdown.split('## 符号索引')[1] ?? '';
    const entries = body.split('\n').filter((l) => /^- `[^`]+:\d+`/.test(l));
    const withParen = entries.filter((l) => l.includes('(')).length;
    record(entries.length > 0 && withParen === 0, 'C10', `${entries.length} 条索引，带括号签名=${withParen}`);
    expect(withParen).toBe(0);
  });

  it('汇总', () => {
    const fail = results.filter((r) => r.startsWith('FAIL'));
    console.log('\n===== 核查结果 =====');
    for (const r of results) console.log(r);
    console.log(`===== ${results.length - fail.length}/${results.length} 通过 =====`);
  });
});
