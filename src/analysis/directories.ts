/**
 * 目录用途标注（确定性规则表 + 内容启发式）
 *
 * 原理：
 *   1. 规则表（约 30 条）按"目录名/文件名"精确或前缀匹配，命中即给出 purpose key；
 *   2. 规则未命中时用内容启发式：统计目录内文件扩展名分布推断用途；
 *   3. 只标注前两层目录（提示词要求的"目录结构解释"范围），避免深层噪音。
 *
 * 返回的 key 指向 i18n analysis:purpose.* 文案，组件不硬编码任何中文/英文。
 */

import { FileNode } from '../types/repo';

export interface PurposeRule {
  /** 匹配的目录/文件名（小写比较） */
  names: string[];
  key: string;
}

/** 规则表：顺序即优先级（越具体的放前面） */
export const PURPOSE_RULES: PurposeRule[] = [
  // 测试与夹具
  { names: ['__tests__', 'test', 'tests', 'spec', 'specs', 'e2e'], key: 'tests' },
  { names: ['fixtures', '__fixtures__', '__mocks__', 'mocks'], key: 'fixtures' },
  { names: ['benchmark', 'benchmarks', 'bench'], key: 'benchmarks' },
  // 源码相关
  { names: ['src', 'source', 'lib', 'app', 'core'], key: 'source' },
  { names: ['components', 'ui', 'views', 'pages', 'widgets'], key: 'components' },
  { names: ['hooks', 'composables'], key: 'hooks' },
  { names: ['utils', 'util', 'helpers', 'common', 'shared'], key: 'utils' },
  { names: ['api', 'apis', 'services', 'service', 'routes', 'controllers'], key: 'api' },
  { names: ['types', 'typings', '@types', 'interfaces'], key: 'types' },
  { names: ['db', 'database', 'models', 'entities', 'repositories', 'dao'], key: 'database' },
  { names: ['migrations', 'migration'], key: 'migrations' },
  { names: ['styles', 'style', 'css', 'scss', 'theme', 'themes'], key: 'styles' },
  // 文档与示例
  { names: ['docs', 'doc', 'documentation', 'wiki'], key: 'docs' },
  { names: ['examples', 'example', 'demo', 'demos', 'samples', 'playground'], key: 'examples' },
  { names: ['templates', 'template'], key: 'templates' },
  // 配置与工具链
  { names: ['config', 'configs', 'configuration', 'settings'], key: 'config' },
  { names: ['.github', '.gitlab', '.circleci'], key: 'ci' },
  { names: ['scripts', 'script', 'bin', 'tools', 'tooling'], key: 'scripts' },
  { names: ['infra', 'infrastructure', 'deploy', 'deployment', 'terraform', 'k8s', 'kubernetes'], key: 'infrastructure' },
  { names: ['docker', '.docker'], key: 'docker' },
  { names: ['.vscode', '.idea', '.devcontainer'], key: 'editor' },
  // 产物与依赖
  { names: ['dist', 'build', 'out', 'output', 'target', 'release'], key: 'build' },
  { names: ['node_modules', 'vendor', 'third_party', 'third-party'], key: 'vendor' },
  { names: ['.cache', 'cache', '.tmp', 'tmp'], key: 'cache' },
  // 多语言与静态资源
  { names: ['locales', 'locale', 'i18n', 'lang', 'langs', 'translations', 'messages'], key: 'localization' },
  { names: ['public', 'static', 'assets', 'images', 'img', 'fonts', 'media', 'resources'], key: 'assets' },
  // 平台相关
  { names: ['packages', 'libs', 'modules', 'workspaces'], key: 'monorepo' },
  { names: ['android', 'ios', 'mobile'], key: 'mobile' },
  { names: ['desktop', 'electron', 'tauri', 'src-tauri'], key: 'desktop' },
];

/** 目录名 → 规则 key 的快速索引 */
const RULE_INDEX = new Map<string, string>();
for (const rule of PURPOSE_RULES) {
  for (const name of rule.names) {
    if (!RULE_INDEX.has(name)) RULE_INDEX.set(name, rule.key);
  }
}

export interface DirPurpose {
  key: string;
  /** 判定来源：规则命中 vs 内容启发式 */
  confidence: 'rule' | 'heuristic';
}

/** 单个名字的规则匹配（不含启发式） */
export function matchPurposeRule(name: string): string | null {
  return RULE_INDEX.get(name.toLowerCase()) ?? null;
}

/**
 * 内容启发式：依据目录内文件扩展名/命名分布推断用途。
 * 仅在规则未命中时使用，返回 null 表示无法判断。
 */
export function detectPurposeByContent(dirPath: string, allFilePaths: string[]): string | null {
  const prefix = dirPath + '/';
  const files = allFilePaths.filter((p) => p.startsWith(prefix));
  if (files.length === 0) return null;

  const exts = new Map<string, number>();
  let testLike = 0;
  for (const f of files) {
    const base = f.split('/').pop() ?? '';
    const ext = base.split('.').pop()?.toLowerCase() ?? '';
    exts.set(ext, (exts.get(ext) ?? 0) + 1);
    // foo.test.ts / foo.spec.js / test_foo.py
    if (/\.(test|spec)\.[a-z]+$/.test(base) || /^test_/.test(base)) testLike++;
  }

  const ratio = (n: number) => n / files.length;

  // 测试：测试命名文件占比高
  if (ratio(testLike) >= 0.4) return 'tests';
  // 文档：markdown 占比过半
  if (ratio(exts.get('md') ?? 0) >= 0.5) return 'docs';
  // 样式：css/scss/less 占比过半
  const styleCount = (exts.get('css') ?? 0) + (exts.get('scss') ?? 0) + (exts.get('less') ?? 0);
  if (ratio(styleCount) >= 0.5) return 'styles';
  // 数据：json/yaml 占比过半
  const dataCount = (exts.get('json') ?? 0) + (exts.get('yaml') ?? 0) + (exts.get('yml') ?? 0);
  if (ratio(dataCount) >= 0.6) return 'config';

  return null;
}

/**
 * 标注前两层目录：返回 path → DirPurpose。
 * depth 0 = 仓库根的直接子目录，depth 1 = 其下一层。
 */
export function annotateDirectories(tree: FileNode[], maxDepth = 2): Map<string, DirPurpose> {
  const allFiles: string[] = [];
  const walkFiles = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file') allFiles.push(n.path);
      else if (n.children) walkFiles(n.children);
    }
  };
  walkFiles(tree);

  const result = new Map<string, DirPurpose>();

  const walkDirs = (nodes: FileNode[], depth: number) => {
    if (depth >= maxDepth) return;
    for (const node of nodes) {
      if (node.type !== 'dir') continue;
      const name = node.path.split('/').pop() ?? node.path;
      const ruleKey = matchPurposeRule(name);
      if (ruleKey) {
        result.set(node.path, { key: ruleKey, confidence: 'rule' });
      } else {
        const heuristic = detectPurposeByContent(node.path, allFiles);
        if (heuristic) result.set(node.path, { key: heuristic, confidence: 'heuristic' });
      }
      if (node.children) walkDirs(node.children, depth + 1);
    }
  };

  walkDirs(tree, 0);
  return result;
}
