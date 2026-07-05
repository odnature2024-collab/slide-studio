// フルスクリーンのプレゼンプレビュー
// - 矢印キー・クリックでスライド送り、Esc・✕ で終了
// - ポインター（レーザー風）／ペン（書き残し・5色）／自動で消えるペン付き

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorEngine } from "../lib/engine";
import { injectStyleIntoHtml, onlySlideCss } from "../lib/editorDoc";

interface Props {
  engine: EditorEngine;
  onClose: () => void;
}

const STYLE_ID = "hse-present-style";

type Tool = "none" | "pointer" | "pen" | "fade";

const PEN_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff"];

/** フェードペンの挙動: 書き終えてから待つ時間と、消えるのにかかる時間 */
const FADE_DELAY_MS = 800;
const FADE_DURATION_MS = 500;
/** ペンの基本の太さ（スライダーで変更可能） */
const PEN_WIDTH_DEFAULT = 4;
const PEN_WIDTH_MIN = 1.5;
const PEN_WIDTH_MAX = 12;
/** 万年筆らしいインクの濃度（わずかに透ける） */
const INK_ALPHA = 0.92;

interface InkPoint {
  x: number;
  y: number;
  /** その地点での線の太さ（速度・筆圧から算出） */
  w: number;
}

interface Stroke {
  color: string;
  points: InkPoint[];
}

interface FadeStroke extends Stroke {
  /** 書き終えた時刻（ms）。描画中は null */
  endedAt: number | null;
}

/** 2点間を、その区間の太さで描く（万年筆の可変幅表現） */
function drawInkSegment(
  ctx: CanvasRenderingContext2D,
  a: InkPoint,
  b: InkPoint
): void {
  ctx.lineWidth = Math.max(0.8, (a.w + b.w) / 2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, alpha: number): void {
  if (stroke.points.length === 0) return;
  ctx.globalAlpha = alpha * INK_ALPHA;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.points.length === 1) {
    // タップだけの場合は点を描く
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.8, p.w) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      drawInkSegment(ctx, stroke.points[i - 1], stroke.points[i]);
    }
  }
  ctx.globalAlpha = 1;
}

function ToolIcon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14">
      <path
        d={d}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PresentModal({ engine, onClose }: Props) {
  const [index, setIndex] = useState(engine.current);
  const [winSize, setWinSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [tool, setTool] = useState<Tool>("none");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTH_DEFAULT);
  const [strokeVersion, setStrokeVersion] = useState(0); // クリアボタン表示の更新用
  /** 速度から太さを滑らかに求めるための、直前の状態 */
  const inkStateRef = useRef({ lastT: 0, lastW: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDotRef = useRef<HTMLDivElement>(null);
  const permStrokesRef = useRef<Map<number, Stroke[]>>(new Map());
  const fadeStrokesRef = useRef<FadeStroke[]>([]);
  const drawingRef = useRef<Stroke | FadeStroke | null>(null);
  const total = engine.slides.length;

  // srcdoc は初回だけ生成し、以降はスタイルの差し替えでスライドを切り替える。
  // プレゼンではスライド本来のアニメーションを活かす（instantAnimation: false）
  const html = useMemo(
    () =>
      injectStyleIntoHtml(
        engine.serialize(true),
        onlySlideCss(engine.current, { instantAnimation: false }),
        STYLE_ID
      ),
    [engine]
  );

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    const styleEl = doc?.getElementById(STYLE_ID);
    if (styleEl) styleEl.textContent = onlySlideCss(index, { instantAnimation: false });
    // スライドを切り替えたらフェードペンの書き込みは消す
    fadeStrokesRef.current = [];
  }, [index]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        // ツール使用中はまずツールを解除、もう一度押すと終了
        if (tool !== "none") setTool("none");
        else onClose();
      } else if (ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown") {
        setIndex((i) => Math.min(total - 1, i + 1));
      } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [total, onClose, tool]);

  // キャンバス全体を描き直す（スライド切替・クリア・フェード進行時に使う）
  const indexRef = useRef(index);
  indexRef.current = index;
  const fadeRafRef = useRef(0);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return false;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const stroke of permStrokesRef.current.get(indexRef.current) ?? []) {
      drawStroke(ctx, stroke, 1);
    }
    const now = performance.now();
    const alive: FadeStroke[] = [];
    let fading = false;
    for (const stroke of fadeStrokesRef.current) {
      let alpha = 1;
      if (stroke.endedAt != null) {
        const t = now - stroke.endedAt;
        if (t > FADE_DELAY_MS + FADE_DURATION_MS) continue; // 消滅
        if (t > FADE_DELAY_MS) alpha = 1 - (t - FADE_DELAY_MS) / FADE_DURATION_MS;
        fading = true; // 待機中 or フェード中は再描画を続ける
      } else {
        fading = true;
      }
      drawStroke(ctx, stroke, alpha);
      alive.push(stroke);
    }
    fadeStrokesRef.current = alive;
    return fading;
  }, []);

  // フェードペンの消滅アニメーション用ループ（フェード対象がある間だけ回す）
  const ensureFadeLoop = useCallback(() => {
    if (fadeRafRef.current) return;
    const loop = () => {
      const stillFading = redrawAll();
      fadeRafRef.current = stillFading ? requestAnimationFrame(loop) : 0;
    };
    fadeRafRef.current = requestAnimationFrame(loop);
  }, [redrawAll]);

  useEffect(() => () => cancelAnimationFrame(fadeRafRef.current), []);

  // キャンバスサイズの設定と、スライド切替時の描き直し
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(winSize.w * dpr);
    canvas.height = Math.round(winSize.h * dpr);
    redrawAll();
  }, [winSize, index, redrawAll]);

  const penActive = tool === "pen" || tool === "fade";

  /** 速度（速いほど細い）と筆圧（ペン入力時）から、この地点の線の太さを求める */
  const computeInkWidth = (ev: React.PointerEvent, prev: InkPoint | null): number => {
    const state = inkStateRef.current;
    let target: number;
    if (ev.pointerType === "pen" && ev.pressure > 0) {
      // タブレットペンは筆圧をそのまま太さに反映する
      target = penWidth * (0.4 + ev.pressure * 1.3);
    } else if (prev) {
      const dt = Math.max(1, ev.timeStamp - state.lastT);
      const speed = Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) / dt; // px/ms
      // ゆっくり書くと太く、走らせると細く（万年筆のインクだまり感）
      target = penWidth * Math.min(1.45, Math.max(0.35, 1.45 - speed * 0.5));
    } else {
      target = penWidth * 0.6; // 書き出しはやや細く
    }
    // 急激な変化を抑えてなめらかに
    const w = state.lastW > 0 ? state.lastW * 0.65 + target * 0.35 : target;
    state.lastW = w;
    state.lastT = ev.timeStamp;
    return w;
  };

  const handleDrawStart = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!penActive) return;
    ev.preventDefault();
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // 合成イベント等で pointerId が無効な場合は無視
    }
    inkStateRef.current = { lastT: ev.timeStamp, lastW: 0 };
    const stroke: FadeStroke = {
      color: penColor,
      points: [{ x: ev.clientX, y: ev.clientY, w: computeInkWidth(ev, null) }],
      endedAt: null,
    };
    drawingRef.current = stroke;
    if (tool === "pen") {
      const list = permStrokesRef.current.get(index) ?? [];
      list.push(stroke);
      permStrokesRef.current.set(index, list);
    } else {
      fadeStrokesRef.current.push(stroke);
    }
    // タップした瞬間に点を描く
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStroke(ctx, stroke, 1);
    }
  };

  const handleDrawMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    const prev = stroke.points[stroke.points.length - 1];
    const p: InkPoint = { x: ev.clientX, y: ev.clientY, w: computeInkWidth(ev, prev) };
    stroke.points.push(p);
    // rAF を待たずにその場で線分を描く（イベント駆動で確実に描画される）
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && prev) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = stroke.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = INK_ALPHA;
      drawInkSegment(ctx, prev, p);
      ctx.globalAlpha = 1;
    }
  };

  const handleDrawEnd = () => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    // 書き終わりを先細りにする（万年筆の抜きの表現）
    const pts = stroke.points;
    const taper = [0.75, 0.55, 0.35];
    for (let i = 0; i < taper.length; i++) {
      const p = pts[pts.length - 1 - i];
      if (p) p.w *= taper[i];
    }
    (stroke as FadeStroke).endedAt = performance.now();
    drawingRef.current = null;
    redrawAll(); // 先細りを反映して描き直す
    setStrokeVersion((v) => v + 1);
    if (tool === "fade") ensureFadeLoop();
  };

  // レーザーポインターの光点をカーソルに追従させる（再レンダリングなしで直接動かす）
  const handleOverlayPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const dot = pointerDotRef.current;
      if (!dot || tool !== "pointer") return;
      dot.style.left = `${ev.clientX}px`;
      dot.style.top = `${ev.clientY}px`;
      dot.style.opacity = "1";
    },
    [tool]
  );

  const toggleTool = (next: Tool) => setTool((cur) => (cur === next ? "none" : next));

  const clearCurrentSlide = () => {
    permStrokesRef.current.delete(index);
    fadeStrokesRef.current = [];
    redrawAll();
    setStrokeVersion((v) => v + 1);
  };

  const hasStrokes =
    (permStrokesRef.current.get(index)?.length ?? 0) > 0 && strokeVersion >= 0;

  const { width: sw, height: sh } = engine.slideSize;
  const scale = Math.min(winSize.w / sw, winSize.h / sh);

  return (
    <div
      className="present-overlay"
      style={tool === "pointer" ? { cursor: "none" } : undefined}
      onPointerMove={handleOverlayPointerMove}
      onPointerLeave={() => {
        if (pointerDotRef.current) pointerDotRef.current.style.opacity = "0";
      }}
      onClick={() => {
        if (tool !== "none") return; // ツール使用中はクリックで進めない
        setIndex((i) => (i + 1 < total ? i + 1 : (onClose(), i)));
      }}
    >
      {/* pointer-events: none で iframe がクリック・キー入力を吸わないようにする */}
      <iframe
        ref={iframeRef}
        title="プレゼンテーション"
        tabIndex={-1}
        sandbox="allow-same-origin"
        srcDoc={html}
        style={{ width: sw, height: sh, transform: `scale(${scale})`, pointerEvents: "none" }}
      />

      {/* 書き込みレイヤー */}
      <canvas
        ref={canvasRef}
        className="present-ink"
        style={{
          width: winSize.w,
          height: winSize.h,
          pointerEvents: penActive ? "auto" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handleDrawStart}
        onPointerMove={handleDrawMove}
        onPointerUp={handleDrawEnd}
        onPointerCancel={handleDrawEnd}
      />

      {/* レーザーポインターの光点 */}
      {tool === "pointer" && <div ref={pointerDotRef} className="present-pointer-dot" />}

      <button
        className="present-close"
        title="プレゼンを終了（Esc）"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>

      {/* ツール（✕ ボタンの下） */}
      <div className="present-tools" onClick={(e) => e.stopPropagation()}>
        <button
          className={`present-tool ${tool === "pointer" ? "on" : ""}`}
          title="ポインター"
          onClick={() => toggleTool("pointer")}
        >
          <ToolIcon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" filled />
        </button>
        <button
          className={`present-tool ${tool === "pen" ? "on" : ""}`}
          title="ペン（書いた内容が残ります）"
          onClick={() => toggleTool("pen")}
        >
          <ToolIcon d="M3 21l1-4L16 5l3 3L7 20l-4 1zM14 7l3 3" />
        </button>
        <button
          className={`present-tool ${tool === "fade" ? "on" : ""}`}
          title="自動で消えるペン（書き終えるとすぐフェードアウト）"
          onClick={() => toggleTool("fade")}
        >
          <ToolIcon d="M3 21l1-4L16 5l3 3L7 20l-4 1zM19 14v0.01M21 11v0.01M22 7v0.01" />
        </button>

        {penActive && (
          <div className="present-palette">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`present-color ${penColor === c ? "on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => setPenColor(c)}
              />
            ))}
            <div className="present-width-sep" />
            <span
              className="present-width-preview"
              title={`太さ: ${penWidth}px`}
              style={{ width: penWidth + 3, height: penWidth + 3, background: penColor }}
            />
            <div className="present-width-wrap" title="ペンの太さ">
              <input
                type="range"
                className="present-width-slider"
                min={PEN_WIDTH_MIN}
                max={PEN_WIDTH_MAX}
                step={0.5}
                value={penWidth}
                style={{ accentColor: penColor }}
                onChange={(e) => setPenWidth(parseFloat(e.target.value))}
              />
            </div>
          </div>
        )}

        {hasStrokes && (
          <button
            className="present-tool"
            title="このスライドの書き込みを消す"
            onClick={clearCurrentSlide}
          >
            <ToolIcon d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
          </button>
        )}
      </div>

      <div className="present-controls" onClick={(e) => e.stopPropagation()}>
        <button
          className="present-arrow"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          title="前のスライド（←）"
        >
          ←
        </button>
        <span className="present-count">
          {index + 1} / {total}
        </span>
        <button
          className="present-arrow"
          disabled={index >= total - 1}
          onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          title="次のスライド（→）"
        >
          →
        </button>
      </div>
    </div>
  );
}
