// フルスクリーンのプレゼンプレビュー
// - 画面の右半分タップで次へ、左半分タップで前へ。矢印キーでも移動、Esc・✕ で終了
// - 上部中央のツールバー: ✕ / ポインター / ペン / 消えるペン
// - ペンは万年筆風（速度・筆圧で太さが変わり、抜きが「シュッ」と先細る）

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

/** 消えるペン: 手が止まってから待つ時間と、消えるのにかかる時間 */
const FADE_IDLE_MS = 1200;
const FADE_DURATION_MS = 700;
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

/** 太さ計算に使う入力サンプル（通常イベントと coalesced イベントの両方を受ける） */
interface InkSample {
  x: number;
  y: number;
  t: number;
  pressure: number;
  pointerType: string;
}

function midOf(a: InkPoint, b: InkPoint): InkPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 };
}

/** 2点間を、その区間の太さで描く */
function drawInkSegment(ctx: CanvasRenderingContext2D, a: InkPoint, b: InkPoint): void {
  ctx.lineWidth = Math.max(0.8, (a.w + b.w) / 2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** 中点法の2次ベジェ曲線: 点 ctrl を制御点として from → to を滑らかに結ぶ */
function drawInkCurve(
  ctx: CanvasRenderingContext2D,
  from: InkPoint,
  ctrl: InkPoint,
  to: InkPoint
): void {
  ctx.lineWidth = Math.max(0.8, (from.w + to.w) / 2);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
  ctx.stroke();
}

function setupInk(ctx: CanvasRenderingContext2D, color: string, alpha: number): void {
  ctx.globalAlpha = alpha * INK_ALPHA;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, alpha: number): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  setupInk(ctx, stroke.color, alpha);
  if (pts.length === 1) {
    // タップだけの場合は点を描く
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.8, pts[0].w) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (pts.length === 2) {
    drawInkSegment(ctx, pts[0], pts[1]);
  } else {
    // 各点を制御点、隣接点との中点を通過点とする2次ベジェで滑らかに描く
    let from = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const to = midOf(pts[i], pts[i + 1]);
      drawInkCurve(ctx, from, pts[i], to);
      from = to;
    }
    drawInkSegment(ctx, from, pts[pts.length - 1]);
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDotRef = useRef<HTMLDivElement>(null);
  const permStrokesRef = useRef<Map<number, Stroke[]>>(new Map());
  const fadeStrokesRef = useRef<Stroke[]>([]);
  /** 消えるペンを最後に動かした時刻。ここから1.2秒止まるとフェード開始 */
  const fadeActivityRef = useRef(0);
  const drawingRef = useRef<Stroke | null>(null);
  /** 速度から太さを滑らかに求めるための、直前の状態 */
  const inkStateRef = useRef({ lastT: 0, lastW: 0 });
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
    // スライドを切り替えたら消えるペンの書き込みは消す
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

  // ---- キャンバス描画 ----

  const indexRef = useRef(index);
  indexRef.current = index;
  const fadeRafRef = useRef(0);

  /** キャンバス全体を描き直す。フェード継続中なら true を返す */
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
    // 消えるペン: 書いている間・手が止まって 1.2 秒までは全部残し、
    // その後は全ストロークが一緒にふわっと消える
    if (fadeStrokesRef.current.length > 0) {
      const idle = performance.now() - fadeActivityRef.current;
      let alpha = 1;
      if (idle > FADE_IDLE_MS) {
        const t = idle - FADE_IDLE_MS;
        if (t >= FADE_DURATION_MS) {
          fadeStrokesRef.current = [];
          return false;
        }
        alpha = 1 - t / FADE_DURATION_MS;
      }
      for (const stroke of fadeStrokesRef.current) drawStroke(ctx, stroke, alpha);
      return true;
    }
    return false;
  }, []);

  /** 消えるペンの監視ループ（フェード対象がある間だけ回す） */
  const ensureFadeLoop = useCallback(() => {
    if (fadeRafRef.current) return;
    const loop = () => {
      const stillActive = redrawAll();
      fadeRafRef.current = stillActive ? requestAnimationFrame(loop) : 0;
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

  // ---- 万年筆の太さ計算 ----

  /** 速度（速いほど細い）と筆圧（ペン入力時）から、この地点の線の太さを求める */
  const computeInkWidth = (sample: InkSample, prev: InkPoint | null): number => {
    const state = inkStateRef.current;
    let target: number;
    if (sample.pointerType === "pen" && sample.pressure > 0) {
      // Apple Pencil 等は筆圧をそのまま太さに反映する
      target = penWidth * (0.35 + sample.pressure * 1.4);
    } else if (prev) {
      const dt = Math.max(1, sample.t - state.lastT);
      const speed = Math.hypot(sample.x - prev.x, sample.y - prev.y) / dt; // px/ms
      // ゆっくり書くと太く、走らせると細く（万年筆のインクだまり感）
      target = penWidth * Math.min(1.5, Math.max(0.28, 1.5 - speed * 0.55));
    } else {
      target = penWidth * 0.6; // 書き出しはやや細く
    }
    // 急激な変化を抑えてなめらかに
    const w = state.lastW > 0 ? state.lastW * 0.6 + target * 0.4 : target;
    state.lastW = w;
    state.lastT = sample.t;
    return w;
  };

  /** 1サンプルをストロークに追加し、追いつき描画をする */
  const addSample = (stroke: Stroke, sample: InkSample, ctx: CanvasRenderingContext2D | null) => {
    const pts = stroke.points;
    const prev = pts[pts.length - 1] ?? null;
    // 近すぎる点はノイズになるので捨てる（手ブレ抑制）
    if (prev && Math.hypot(sample.x - prev.x, sample.y - prev.y) < 1.2) return;
    pts.push({ x: sample.x, y: sample.y, w: computeInkWidth(sample, prev) });
    if (!ctx) return;
    // rAF を待たずにその場で「1点遅れ」の滑らかな曲線を描く
    const n = pts.length;
    if (n === 2) {
      drawInkSegment(ctx, pts[0], midOf(pts[0], pts[1]));
    } else if (n >= 3) {
      const from = n === 3 ? pts[0] : midOf(pts[n - 4], pts[n - 3]);
      drawInkCurve(ctx, from, pts[n - 3], midOf(pts[n - 3], pts[n - 2]));
    }
  };

  const toSample = (ev: PointerEvent): InkSample => ({
    x: ev.clientX,
    y: ev.clientY,
    t: ev.timeStamp,
    pressure: ev.pressure,
    pointerType: ev.pointerType,
  });

  // ---- 描画イベント ----

  const handleDrawStart = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!penActive) return;
    ev.preventDefault();
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // 合成イベント等で pointerId が無効な場合は無視
    }
    inkStateRef.current = { lastT: ev.timeStamp, lastW: 0 };
    const stroke: Stroke = { color: penColor, points: [] };
    drawingRef.current = stroke;
    if (tool === "pen") {
      const list = permStrokesRef.current.get(index) ?? [];
      list.push(stroke);
      permStrokesRef.current.set(index, list);
    } else {
      fadeStrokesRef.current.push(stroke);
      fadeActivityRef.current = performance.now();
      ensureFadeLoop(); // 手が止まったことを検知するための監視を開始
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupInk(ctx, stroke.color, 1);
    }
    addSample(stroke, toSample(ev.nativeEvent), null);
  };

  const handleDrawMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    ev.preventDefault();
    if (tool === "fade") fadeActivityRef.current = performance.now();
    const ctx = canvasRef.current?.getContext("2d") ?? null;
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupInk(ctx, stroke.color, 1);
    }
    // coalesced イベントで高解像度サンプリング（iPad の Apple Pencil は特に効く）
    const native = ev.nativeEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    if (events.length > 0) {
      for (const e of events) addSample(stroke, toSample(e), ctx);
    } else {
      addSample(stroke, toSample(native), ctx);
    }
  };

  const handleDrawEnd = () => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    drawingRef.current = null;
    const pts = stroke.points;
    // 「シュッ」とした払い: 速い抜きなら進行方向に尻尾を伸ばす
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen > 5) {
        const tailLen = Math.min(28, segLen * 1.8);
        pts.push({
          x: b.x + ((b.x - a.x) / segLen) * tailLen,
          y: b.y + ((b.y - a.y) / segLen) * tailLen,
          w: Math.max(0.5, b.w * 0.1),
        });
      }
    }
    // 書き終わりを先細りに（末尾ほど細く）
    const k = Math.min(6, pts.length);
    for (let i = 0; i < k; i++) {
      const p = pts[pts.length - 1 - i];
      p.w *= Math.pow((i + 1) / (k + 1), 0.8);
    }
    if (tool === "fade") {
      fadeActivityRef.current = performance.now();
      ensureFadeLoop();
    }
    redrawAll(); // 先細りと払いを反映して描き直す
    setStrokeVersion((v) => v + 1);
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
      onContextMenu={(e) => e.preventDefault()}
      onClick={(ev) => {
        if (tool !== "none") return; // ツール使用中はタップで移動しない
        // 右半分タップで次へ、左半分タップで前へ
        if (ev.clientX >= winSize.w / 2) setIndex((i) => Math.min(total - 1, i + 1));
        else setIndex((i) => Math.max(0, i - 1));
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
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* レーザーポインターの光点 */}
      {tool === "pointer" && <div ref={pointerDotRef} className="present-pointer-dot" />}

      {/* 上部中央ツールバー: ✕ / ポインター / ペン / 消えるペン */}
      <div className="present-tools" onClick={(e) => e.stopPropagation()}>
        <button className="present-tool" title="プレゼンを終了（Esc）" onClick={onClose}>
          ✕
        </button>
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
          title="自動で消えるペン（手を止めると1.2秒後にふわっと消えます）"
          onClick={() => toggleTool("fade")}
        >
          <ToolIcon d="M3 21l1-4L16 5l3 3L7 20l-4 1zM19 14v0.01M21 11v0.01M22 7v0.01" />
        </button>
        {hasStrokes && (
          <button
            className="present-tool"
            title="このスライドの書き込みを消す"
            onClick={clearCurrentSlide}
          >
            <ToolIcon d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
          </button>
        )}

        {/* ペン選択時だけ、バーの下にパレットと太さスライダーを出す */}
        {penActive && (
          <div className="present-palette" onClick={(e) => e.stopPropagation()}>
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`present-color ${penColor === c ? "on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => setPenColor(c)}
              />
            ))}
            <span className="present-width-sep" />
            <input
              type="range"
              className="present-width-slider"
              min={PEN_WIDTH_MIN}
              max={PEN_WIDTH_MAX}
              step={0.5}
              value={penWidth}
              title="ペンの太さ"
              style={{ accentColor: penColor }}
              onChange={(e) => setPenWidth(parseFloat(e.target.value))}
            />
            <span
              className="present-width-preview"
              title={`太さ: ${penWidth}px`}
              style={{ width: penWidth + 3, height: penWidth + 3, background: penColor }}
            />
          </div>
        )}
      </div>

      <div className="present-controls" onClick={(e) => e.stopPropagation()}>
        <button
          className="present-arrow"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          title="前のスライド（←／左半分をタップ）"
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
          title="次のスライド（→／右半分をタップ）"
        >
          →
        </button>
      </div>
    </div>
  );
}
