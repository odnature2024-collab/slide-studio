// 左パネル：スライドのサムネイル一覧と並べ替え・複製・削除
// パフォーマンスのため、画面内（付近）にあるサムネイルだけ iframe を生成する

import { useEffect, useRef, useState } from "react";
import type { EditorEngine } from "../lib/engine";
import { injectStyleIntoHtml, onlySlideCss, finishAllAnimations } from "../lib/editorDoc";

interface Props {
  engine: EditorEngine;
  version: number;
  /** パネル幅（スプリッターで可変） */
  panelWidth: number;
}

/** サムネイル再生成のデバウンス（編集が落ち着いてから作り直す） */
const THUMB_DEBOUNCE_MS = 600;

export default function SlidePanel({ engine, version, panelWidth }: Props) {
  const [thumbHtml, setThumbHtml] = useState("");
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const panelRef = useRef<HTMLElement>(null);

  // サムネイルの再生成は変更が落ち着いてから（負荷対策）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setThumbHtml(engine.loaded ? engine.serialize(true) : "");
    }, THUMB_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [engine, version]);

  // 画面内（±300px）に入っているサムネイルだけ iframe を持たせる
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.idx);
            if (Number.isNaN(idx)) continue;
            if (entry.isIntersecting && !next.has(idx)) {
              next.add(idx);
              changed = true;
            } else if (!entry.isIntersecting && next.has(idx)) {
              next.delete(idx);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: panel, rootMargin: "300px" }
    );
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(".thumb"))) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [engine.slides.length, panelWidth]);

  const { width: sw, height: sh } = engine.slideSize;
  const thumbWidth = Math.max(80, panelWidth - 28);
  const scale = thumbWidth / sw;
  const thumbHeight = Math.round(sh * scale);

  return (
    <aside className="slide-panel" ref={panelRef} style={{ width: panelWidth }}>
      <div className="slide-panel-title">スライド（{engine.slides.length}）</div>
      {engine.slides.map((_, i) => (
        <div
          key={i}
          data-idx={i}
          className={`thumb ${i === engine.current ? "active" : ""}`}
          onClick={() => engine.setCurrent(i)}
        >
          <div className="thumb-frame" style={{ height: thumbHeight }}>
            {thumbHtml && visible.has(i) && (
              <iframe
                title={`スライド ${i + 1}`}
                tabIndex={-1}
                sandbox="allow-same-origin"
                onLoad={(e) => {
                  const doc = (e.currentTarget as HTMLIFrameElement).contentDocument;
                  if (doc) finishAllAnimations(doc);
                }}
                srcDoc={injectStyleIntoHtml(thumbHtml, onlySlideCss(i))}
                style={{
                  width: sw,
                  height: sh,
                  transform: `scale(${scale})`,
                }}
              />
            )}
          </div>
          <span className="thumb-num">{i + 1}</span>
          <div className="thumb-ops" onClick={(e) => e.stopPropagation()}>
            <button title="上へ移動" onClick={() => engine.moveSlide(i, -1)}>
              ↑
            </button>
            <button title="下へ移動" onClick={() => engine.moveSlide(i, 1)}>
              ↓
            </button>
            <button title="複製" onClick={() => engine.duplicateSlide(i)}>
              ⧉
            </button>
            <button title="削除" onClick={() => engine.deleteSlide(i)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}
