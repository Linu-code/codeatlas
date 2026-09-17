/**
 * mermaid.ts —— 调用图 → Mermaid 文本
 *
 * 输出形状：按文件分组的 subgraph（一眼看出跨文件调用），节点标签为「函数名 (行号)」。
 * 三个必须处理的细节：
 *   1. id 必须合法：Mermaid 的节点 id 不支持 / # @ 等字符，统一哈希化。
 *   2. 标签必须转义：函数签名里的引号/尖括号会破坏语法。
 *   3. 超大图要限制：Mermaid 渲染节点数过多会卡死，截断逻辑在 callgraph.ts 完成，这里只做保护。
 */

import type { CallGraph } from './callgraph';

/** 稳定的短 id 生成（同输入必得同输出，便于导出对比） */
export function sanitizeId(raw: string): string {
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  return `n${(hash >>> 0).toString(36)}`;
}

/** Mermaid 标签转义 */
export function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\|/g, '/');
}

/**
 * 生成 Mermaid graph LR 文本。
 * @param direction 图方向，默认 LR（横向，长文件名更易读）
 */
export function toMermaid(graph: CallGraph, direction: 'LR' | 'TD' = 'LR'): string {
  const lines: string[] = [`graph ${direction}`];

  // 按文件分组（subgraph），组内按行号排序
  const byFile = new Map<string, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const list = byFile.get(node.file) ?? [];
    list.push(node);
    byFile.set(node.file, list);
  }

  const fileIds = new Map<string, string>();
  for (const [file, nodes] of byFile) {
    const groupId = `f_${sanitizeId(file)}`;
    fileIds.set(file, groupId);
    lines.push(`  subgraph ${groupId}["${escapeLabel(file)}"]`);
    for (const node of nodes) {
      const label = `${node.name} (${node.line})`;
      lines.push(`    ${sanitizeId(node.id)}["${escapeLabel(label)}"]`);
    }
    lines.push('  end');
  }

  // 边：跨文件调用加粗线，文件内调用实线
  for (const edge of graph.edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    const fromFile = edge.from.slice(0, edge.from.indexOf('#'));
    const toFile = edge.to.slice(0, edge.to.indexOf('#'));
    if (fromFile !== toFile) {
      lines.push(`  ${from} ==> ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }

  // 节点样式：入度越高（被复用越多）颜色越突出，逻辑与阅读路线一致
  const hot = graph.nodes.filter((n) => n.inDegree >= 2).map((n) => sanitizeId(n.id));
  if (hot.length) {
    lines.push(`  classDef hot fill:#4a6cf7,stroke:#5d7bff,color:#ffffff;`);
    lines.push(`  class ${hot.join(',')} hot;`);
  }

  return lines.join('\n');
}

/** 生成独立可分享的 HTML（导出/调试用，含深色背景） */
export function toStandaloneHtml(mermaidCode: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeLabel(title)}</title>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
<style>body{margin:0;background:#1b1d23;color:#e4e6eb;font-family:system-ui}</style>
</head>
<body>
<pre class="mermaid">
${mermaidCode}
</pre>
</body>
</html>`;
}
