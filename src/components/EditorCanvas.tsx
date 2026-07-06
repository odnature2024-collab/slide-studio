// 中央キャンバス：スケーリングされた iframe と選択オーバーレイ（選択枠・リサイズハンドル）

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorEngine } from "../lib/engine";

interface Props {
  engine: EditorEngine;
  version: number;
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

export default function EditorCanvas({ engine, version }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0);

  // ドラッグ・ホバー等の一時的な更新はキャンバスだけ再描画する
  useEffect(() => {
    engine.onOverlay = () => setTick((t) => t + 1);
    return () => {
      engine.onOverlay = () => {};
    };
  }, [engine]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width: sw, height: sh } = engine.slideSize;
  const margin = 56;
  const scale = Math.max(
    0.05,
    Math.min((containerSize.w - margin) / sw, (containerSize.h - margin) / sh)
  );
  const stageLeft = Math.max(margin / 2, (containerSize.w - sw * scale) / 2);
  const stageTop = Math.max(margin / 2, (containerSize.h - sh * scale) / 2);

  const iframeRef = useCallback(
    (node: HTMLIFrameElement | null) => engine.attachIframe(node),
    [engine]
  );

  // リサイズハンドルのドラッグ
  const handleResizeStart = (handle: Handle, ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!engine.beginResize()) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const target = ev.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      // 合成イベント等で pointerId が無効な場合は無視
    }

    const onMove = (e: PointerEvent) => {
      engine.applyResize(handle, (e.clientX - startX) / scale, (e.clientY - startY) / scale, e.shiftKey);
    };
    const onUp = () => {
      engine.endResize();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // オーバーレイ上の座標を iframe 内座標へ変換する
  const toLocal = (ev: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
  };

  // 複数選択に対応: すべての選択要素に枠を描く（ハンドル・ラベルは単一選択時のみ）
  const selRects = engine.selection
    .map((el) => engine.getRect(el))
    .filter((r): r is DOMRect => r != null);
  const selRect = engine.selection.length === 1 ? selRects[0] ?? null : null;
  const hovRect =
    engine.hovered && !engine.isSelected(engine.hovered) ? engine.getRect(engine.hovered) : null;
  const isSlideSelected = engine.selected === engine.activeSlide();
  const handleSize = 9 / scale;

  const selectedLabel = engine.selected
    ? `${engine.selected.tagName.toLowerCase()}${
        engine.selected.classList[0] ? `.${engine.selected.classList[0]}` : ""
      }`
    : "";

  return (
    <div
      ref={containerRef}
      className="canvas"
      onPointerDown={(e) => {
        // iframe の外側（余白）をクリックしたら選択解除
        if (e.target === containerRef.current) {
          engine.finishEditing();
          engine.select(null);
        }
      }}
    >
      <div
        className="canvas-stage"
        style={{
          left: stageLeft,
          top: stageTop,
          width: sw,
          height: sh,
          transform: `scale(${scale})`,
        }}
      >
        <iframe
          ref={iframeRef}
          title="スライド編集キャンバス"
          sandbox="allow-same-origin"
          style={{ width: sw, height: sh }}
          onLoad={() => engine.handleIframeLoad()}
        />
        {/* 選択・ドラッグ等の入力はすべてこのオーバーレイで受ける。
            iPad の Safari は縮小 iframe へのタッチ入力に不具合があるため、
            iframe 内には直接触れさせない（テキスト編集中のみ通す） */}
        <div
          className="overlay"
          ref={overlayRef}
          style={{ pointerEvents: engine.editingEl ? "none" : "auto" }}
          onPointerDown={(e) => {
            if (e.target !== overlayRef.current) return; // ハンドルは自身で処理する
            e.preventDefault();
            try {
              overlayRef.current.setPointerCapture(e.pointerId);
            } catch {
              // 合成イベント等で pointerId が無効な場合は無視
            }
            const p = toLocal(e);
            engine.overlayPointerDown(p.x, p.y, e.shiftKey || e.ctrlKey || e.metaKey);
          }}
          onPointerMove={(e) => {
            if (!engine.doc) return;
            const p = toLocal(e);
            engine.overlayPointerMove(p.x, p.y);
          }}
          onPointerUp={(e) => {
            const p = toLocal(e);
            engine.overlayPointerUp(p.x, p.y);
          }}
          onPointerLeave={() => engine.overlayLeave()}
          onDoubleClick={(e) => {
            const p = toLocal(e);
            engine.overlayDoubleClick(p.x, p.y);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) await engine.insertImageFromFile(file);
          }}
        >
          {hovRect && (
            <div
              className="hover-box"
              style={{
                left: hovRect.left,
                top: hovRect.top,
                width: hovRect.width,
                height: hovRect.height,
              }}
            />
          )}
          {selRects.map((r, i) => (
            <div
              key={i}
              className="select-box"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ))}
          {selRect && (
            <>
              <div
                className="select-label"
                style={{ left: selRect.left, top: selRect.top, fontSize: 10 / scale }}
              >
                {selectedLabel}
              </div>
              {!isSlideSelected &&
                !engine.editingEl &&
                HANDLES.map((h) => {
                  const cx = h.includes("w")
                    ? selRect.left
                    : h.includes("e")
                      ? selRect.left + selRect.width
                      : selRect.left + selRect.width / 2;
                  const cy = h.includes("n")
                    ? selRect.top
                    : h.includes("s")
                      ? selRect.top + selRect.height
                      : selRect.top + selRect.height / 2;
                  return (
                    <div
                      key={h}
                      className={`handle ${h}`}
                      style={{
                        left: cx - handleSize / 2,
                        top: cy - handleSize / 2,
                        width: handleSize,
                        height: handleSize,
                        borderWidth: 1.5 / scale,
                      }}
                      onPointerDown={(e) => handleResizeStart(h, e)}
                    />
                  );
                })}
            </>
          )}
        </div>
      </div>
      <div className="canvas-hint">
        クリックで選択 ／ Shift+クリックで複数選択 ／ ダブルクリックで文字編集 ／ ドラッグで移動 ／ ⌘Z で元に戻す
      </div>
    </div>
  );
}
