/**
 * CodeView —— 代码视图（Prism 语法高亮 + 行号槽）
 *
 * 行号实现原理：
 *   高亮后整块代码不能按行切分（块注释/模板字符串跨行，切分破坏 HTML），
 *   因此渲染为「左侧行号槽 + 右侧 <pre>」两栏，二者共用同一 line-height（20px，见 index.css）；
 *   右侧滚动时用 onScroll 同步行号槽 scrollTop，实现视觉对齐。
 *
 * 语言包按需加载：首屏只带 4 个核心语法，打开具体文件时动态 import（见 utils/prismLoader）。
 *
 * 预留能力（M5 使用）：
 *   · scrollToLine(line) —— 滚动定位并高亮目标行
 *   · onSymbolClick(token, line) —— 点击标识符（F12 / Ctrl+Click 转到定义）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Prism, ensurePrismLanguage, hasPrismLanguage } from '../utils/prismLoader';

const LINE_HEIGHT = 20; // 与 index.css 的 .code-scroll 保持一致

export interface CodeViewHandle {
  scrollToLine: (line: number) => void;
}

interface Props {
  code: string;
  language: string;
  /** 目标行（M5 跳转用；为空表示不高亮） */
  highlightLine?: number | null;
  /** 点击标识符（M5 转到定义用） */
  onSymbolClick?: (token: string, line: number) => void;
  onReady?: (handle: CodeViewHandle) => void;
}

export default function CodeView({ code, language, highlightLine, onSymbolClick, onReady }: Props) {
  const { t } = useTranslation('viewer');
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [grammarReady, setGrammarReady] = useState(() => hasPrismLanguage(language));

  const lineCount = useMemo(() => code.split('\n').length, [code]);

  // 按需加载语法包，加载完成后触发一次重渲染
  useEffect(() => {
    let cancelled = false;
    if (hasPrismLanguage(language)) {
      setGrammarReady(true);
      return undefined;
    }
    setGrammarReady(false);
    void ensurePrismLanguage(language).then(() => {
      if (!cancelled) setGrammarReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const highlighted = useMemo(() => {
    const grammar = grammarReady ? Prism.languages[language] : undefined;
    if (!grammar) {
      // 无语法（未加载/不支持）：转义后原样展示，保证内容可读
      return Prism.util.encode(code) as string;
    }
    try {
      return Prism.highlight(code, grammar, language);
    } catch {
      return Prism.util.encode(code) as string;
    }
  }, [code, language, grammarReady]);

  // 行号槽与代码区滚动同步
  const handleScroll = useCallback(() => {
    if (preRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = preRef.current.scrollTop;
    }
  }, []);

  const scrollToLine = useCallback(
    (line: number) => {
      const el = preRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT);
      handleScroll();
    },
    [handleScroll],
  );

  useEffect(() => {
    onReady?.({ scrollToLine });
  }, [onReady, scrollToLine]);

  useEffect(() => {
    if (highlightLine) scrollToLine(highlightLine);
  }, [highlightLine, scrollToLine]);

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!onSymbolClick || !preRef.current) return;
    // 仅 Ctrl/Cmd + 点击触发"转到定义"（与 VSCode 一致的交互，避免普通点击误跳转）
    if (!e.ctrlKey && !e.metaKey) return;
    const target = e.target as HTMLElement;
    // 优先取用户选中的文本，否则取点击 token 的文本内容
    const token =
      (window.getSelection()?.toString().trim() || target.textContent || '').replace(
        /[^A-Za-z0-9_$]/g,
        '',
      );
    if (!token) return;
    // 由点击位置换算行号（等宽字体 + 固定 line-height，换算可靠）
    const rect = target.getBoundingClientRect();
    const preRect = preRef.current.getBoundingClientRect();
    const line = Math.max(
      1,
      Math.round((rect.top - preRect.top + preRef.current.scrollTop) / LINE_HEIGHT) + 1,
    );
    onSymbolClick(token, line);
  };

  return (
    <div className="flex h-full min-h-0" style={{ background: 'var(--c-bg)' }}>
      {/* 行号槽 */}
      <div
        ref={gutterRef}
        aria-hidden
        className="code-gutter shrink-0 overflow-hidden border-e py-3 pe-2 ps-3"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg)' }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            style={
              highlightLine === i + 1
                ? { color: 'var(--c-primary)', fontWeight: 600 }
                : undefined
            }
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* 代码区 */}
      <pre
        ref={preRef}
        onScroll={handleScroll}
        onClick={handleClick}
        className="code-scroll m-0 flex-1 overflow-auto py-3 pe-6 ps-3"
        style={{ background: 'var(--c-bg)' }}
        aria-label={t('lines')}
      >
        <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
