/**
 * search.worker.ts —— 全局代码搜索（Web Worker 中执行正则）
 *
 * 为什么放 Worker：正则搜索（尤其带 .* 的回溯模式）会长时间占用主线程导致 UI 卡死。
 * 本 Worker 在独立线程里逐行匹配，主线程只负责超时与结果渲染。
 *
 * 超时保护：主线程 10 秒未收到结果就 terminate() 该 Worker（见 hooks/useGlobalSearch.ts），
 * 因此 Worker 内不需要也无法做抢占式中断。
 *
 * 输入：{ files: {path,text}[], pattern, flags, maxResults }
 * 输出：{ type:'done', results, totalMatches, truncated } | { type:'error', code }
 */

export interface SearchRequest {
  files: { path: string; text: string }[];
  pattern: string;
  /** 正则标志，如 'i'、'gi' */
  flags: string;
  maxResults: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  /** 该行文本（截断到 300 字符） */
  text: string;
  /** 该行匹配次数 */
  count: number;
}

export interface SearchResponse {
  type: 'done' | 'error';
  /** 正则语法错误时为 'bad-regex' */
  code?: string;
  results?: SearchMatch[];
  totalMatches?: number;
  filesMatched?: number;
  truncated?: boolean;
}

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const { files, pattern, flags, maxResults } = event.data;

  let regex: RegExp;
  try {
    // 保证有 g 标志，便于逐行统计匹配次数
    const normalized = flags.includes('g') ? flags : flags + 'g';
    regex = new RegExp(pattern, normalized);
  } catch {
    postMessage({ type: 'error', code: 'bad-regex' } satisfies SearchResponse);
    return;
  }

  const results: SearchMatch[] = [];
  let totalMatches = 0;
  let truncated = false;

  for (const file of files) {
    if (truncated) break;
    const lines = file.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      let count = 0;
      // 逐行统计匹配次数（不跨行，符合编辑器搜索直觉）
      while (regex.exec(line) !== null) {
        count++;
        // 防御：零宽匹配会死循环
        if (regex.lastIndex === 0) break;
      }
      if (count === 0) continue;
      totalMatches += count;
      if (results.length < maxResults) {
        results.push({ path: file.path, line: i + 1, text: line.slice(0, 300), count });
      } else {
        truncated = true;
        break;
      }
    }
  }

  postMessage({
    type: 'done',
    results,
    totalMatches,
    filesMatched: new Set(results.map((r) => r.path)).size,
    truncated,
  } satisfies SearchResponse);
};

export {};
