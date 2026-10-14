// 兼容层：web-tree-sitter 0.25 的 `Node` 类型比 0.22 更严格——
// `child()` / `parent` / `nextSibling` / `children` / `namedChildren` 现在返回 `Node | null`
// （0.22 中这些返回非空的 `SyntaxNode`）。整套分析代码是按 0.22 的宽松契约写的，
// 因此这里把 `SyntaxNode` 重新导出为一个「宽松节点」接口，等价还原 0.22 的契约：
//   · 所有子节点/父节点访问返回 any（不强制空值），保持既有解析逻辑零改动、行为不变；
//   · children / namedChildren 显式声明为 any[]，使 `for (const c of node.children)` 中的
//     `c` 拥有上下文类型，避免 noImplicitAny 误报；
//   · 该接口是 `Node` 的父类型（成员类型均放宽），所以 `tree.rootNode: Node` 仍可赋值给
//     `SyntaxNode`，解析边界无需改动。
//
// 说明：这是一次 ABI 升级（0.22 → 0.25）的兼容性垫片，不改变运行时行为。
// 后续若要做彻底的空安全改造，应移除此垫片后逐步为各语言处理器补上空值处理。
declare module 'web-tree-sitter' {
  export interface SyntaxNode {
    [key: string]: any;
    children: any[];
    namedChildren: any[];
    child(index: number): any;
    namedChild(index: number): any;
    childForFieldName(name: string): any;
    childForFieldId(id: number): any;
    firstChild: any;
    firstNamedChild: any;
    lastChild: any;
    lastNamedChild: any;
    nextSibling: any;
    previousSibling: any;
    nextNamedSibling: any;
    previousNamedSibling: any;
    parent: any;
  }
}
