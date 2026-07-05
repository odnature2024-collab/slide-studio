// 左パネル：スライドのサムネイル一覧と並べ替え・複製・削除

import { useEffect, useState } from "react";
import type { EditorEngine } from "../lib/engine";
import { injectStyleIntoHtml, onlySlideCss, finishAllAnimations } from "../lib/editorDoc";

interface Props {
  engine: EditorEngine;
  version: number;
  /** パネル幅（スプリッターで可変） */
  panelWidth: number;
}

export default function SlidePanel({ engine, version, panelWidth }: Props) {
  const [thumbHtml, setThumbHtml] = useState("");

  // サムネイルの再生成は変更が落ち着いてから（負荷対策）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setThumbHtml(engine.loaded ? engine.serialize(true) : "");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [engine, version]);

  const { width: sw, height: sh } = engine.slideSize;
  const thumbWidth = Math.max(80, panelWidth - 28);
  const scale = thumbWidth / sw;
  const thumbHeight = Math.round(sh * scale);

  return (
    <aside className="slide-panel" style={{ width: panelWidth }}>
      <div className="slide-panel-title">スライド（{engine.slides.length}）</div>
      {engine.slides.map((_, i) => (
        <div
          key={i}
          className={`thumb ${i === engine.current ? "active" : ""}`}
          onClick={() => engine.setCurrent(i)}
        >
          <div className="thumb-frame" style={{ height: thumbHeight }}>
            {thumbHtml && (
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
