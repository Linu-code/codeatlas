/**
 * targets.ts —— 分析目标筛选（面向数万行 / 数千文件的系统级项目）
 *
 * 为什么需要：原实现用 `flattenFiles(tree).slice(0, MAX_ANALYSIS_FILES)`，
 * 即"按文件树字典序取前 N 个"。超大项目一旦超过上限，会**整块漏掉后半段模块**
 * （例如只剩 kernel/a-c，完全没有 net/、drivers/），比随机还糟。
 *
 * 策略（仅在超过上限时启用，小项目保持原样、零行为变化）：
 *   1. 排除明显的第三方/产物目录（node_modules / third_party / vendor / build …），
 *      把预算留给项目自身代码；
 *   2. 按启发式打分排序，取前 N：
 *      · 目录越浅越重要（入口与基础设施通常在浅层）
 *      · src / lib / core / include / kernel / drivers / net 等核心目录加权
 *      · main / index / app / server … 入口文件额外加权
 *      · test / spec / fixtures / mocks 降权（理解系统时优先级低）
 *   3. 输出确定（分数相同按路径字典序），保证同仓库多次分析结果一致。
 */

/** 第三方 / 构建产物 / 生成代码：超出预算时直接排除 */
const VENDOR = /(^|\/)(node_modules|\.git|dist|build|out|target|coverage|__pycache__|\.venv|venv|third[_-]?party|vendor|external|deps|generated|gen)(\/|$)/i;

/** 核心代码目录：加权 */
const CORE = /(^|\/)(src|lib|libs|core|app|apps|include|internal|pkg|cmd|module|modules|kernel|drivers|arch|fs|net|mm|sys|base|framework|engine)(\/|$)/i;

/** 测试 / 夹具：降权（不是不能分析，而是不该抢占理解系统结构的名额） */
const TESTY = /(^|\/)(test|tests|spec|specs|__tests__|e2e|fixture|fixtures|mock|mocks|bench|benchmarks)(\/|$)/i;

/** 入口文件：额外加权 */
const ENTRY = /(^|\/)(main|index|app|server|cli|bootstrap|entry|init|start)\.[a-z0-9]+$/i;

export interface TargetSelection {
  /** 实际参与分析的文件（≤ cap） */
  paths: string[];
  /** 候选源码文件总数 */
  total: number;
  /** 因上限被舍弃的候选数 */
  excluded: number;
}

/** 单个文件的启发式得分（越大越优先） */
export function scorePath(path: string): number {
  const depth = path.split('/').length - 1;
  let score = 100 - depth * 4;
  if (CORE.test(path)) score += 30;
  if (ENTRY.test(path)) score += 40;
  if (TESTY.test(path)) score -= 40;
  return score;
}

/**
 * 选取分析目标。
 * 未超上限时**原样返回**（保证小项目行为与旧版完全一致）。
 */
export function selectAnalysisPaths(all: string[], cap: number): TargetSelection {
  const total = all.length;
  if (total <= cap) return { paths: all, total, excluded: 0 };

  // 先排第三方；若排完反而不够 N（极端仓库），退回全量池，避免欠采样
  const real = all.filter((p) => !VENDOR.test(p));
  const pool = real.length >= cap ? real : all;

  const paths = [...pool]
    .sort((a, b) => scorePath(b) - scorePath(a) || a.localeCompare(b))
    .slice(0, cap);

  return { paths, total, excluded: total - paths.length };
}
