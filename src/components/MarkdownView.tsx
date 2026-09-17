/**
 * MarkdownView —— README / Markdown 渲染
 *
 * 关键处理：
 *   1. markdown-it 渲染（html:false 防注入）
 *   2. 相对图片路径改写：
 *      · GitHub 源 → raw.githubusercontent.com/{owner}/{repo}/{branch}/xxx
 *      · ZIP 源   → 通过 resolveAsset 回调取 ZipSource blob URL
 *   3. 相对链接改写为 GitHub 网页视图，外部链接在新标签打开
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { md, resolveRelativeSrc } from '../utils/markdown';

interface Props {
  content: string;
  /** 资源绝对前缀（GitHub 源时传入） */
  baseUrl?: string | null;
  /** 自定义资源解析（ZIP 源传入：相对路径 → blob URL） */
  resolveAsset?: (src: string) => Promise<string | null>;
  /** 链接前缀（GitHub 网页视图） */
  linkBase?: string | null;
}

export default function MarkdownView({ content, baseUrl, resolveAsset, linkBase }: Props) {
  const { t } = useTranslation('viewer');
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => md.render(content), [content]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // ---- 链接改写 ----
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer noopener');
      } else if (linkBase && !href.startsWith('#')) {
        a.setAttribute('href', resolveRelativeSrc(href, linkBase));
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer noopener');
      }
    });

    // ---- 图片改写 ----
    root.querySelectorAll('img').forEach(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      // 优先自定义解析（本地 ZIP）
      const custom = resolveAsset ? await resolveAsset(src) : null;
      const finalSrc = custom ?? resolveRelativeSrc(src, baseUrl ?? null);
      if (finalSrc) img.setAttribute('src', finalSrc);
    });
  }, [rendered, baseUrl, linkBase, resolveAsset]);

  return (
    <div className="h-full overflow-auto px-8 py-6" style={{ background: 'var(--c-bg)' }}>
      <div
        ref={ref}
        className="md-body mx-auto max-w-4xl"
        aria-label={t('readme')}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  );
}
