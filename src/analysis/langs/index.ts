/**
 * 语言处理器注册表（LangId → LangHandler）
 *
 * 新增语言时在此登记。REGISTRY 的类型是 Record<LangId, LangHandler>，
 * 一旦 LangId 增加而这里漏登记，TypeScript 会直接编译报错 —— 不会静默失效。
 */

import type { LangId } from '../parser';
import type { LangHandler } from './types';
import { javascriptHandler } from './javascript';
import { pythonHandler } from './python';
import { goHandler } from './go';
import { rustHandler } from './rust';
import { javaHandler } from './java';
import { cHandler } from './c';
import { cppHandler } from './cpp';
import { csharpHandler } from './csharp';
import { phpHandler } from './php';
import { kotlinHandler } from './kotlin';
import { swiftHandler } from './swift';
import { rubyHandler } from './ruby';

const REGISTRY: Record<LangId, LangHandler> = {
  javascript: javascriptHandler,
  typescript: javascriptHandler, // TS 与 JS 的节点类型一致
  tsx: javascriptHandler, // TSX 只是放开了 JSX 语法，节点命名与 TS 相同
  python: pythonHandler,
  go: goHandler,
  rust: rustHandler,
  java: javaHandler,
  c: cHandler,
  cpp: cppHandler,
  csharp: csharpHandler,
  php: phpHandler,
  kotlin: kotlinHandler,
  swift: swiftHandler,
  ruby: rubyHandler,
};

export function handlerFor(lang: LangId): LangHandler {
  return REGISTRY[lang];
}
