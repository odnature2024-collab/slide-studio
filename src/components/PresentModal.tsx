// フルスクリーンのプレゼンプレビュー
// - 画面の右半分タップで次へ、左半分タップで前へ。矢印キーでも移動、Esc・✕ で終了
// - 上部中央のツールバー: ✕ / ポインター / ペン / 消えるペン
// - ペンは万年筆風（速度・筆圧で太さが変わり、抜きが「シュッ」と先細る）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorEngine } from "../lib/engine";
import { injectStyleIntoHtml, onlySlideCss } from "../lib/editorDoc";
import { recognizeShape } from "../lib/shapeRecognizer";

interface Props {
  engine: EditorEngine;
  onClose: () => void;
}

const STYLE_ID = "hse-present-style";

type Tool = "none" | "pointer" | "pen" | "fade" | "marker" | "fadeMarker";

/** 図形スナップ: ペンを止めたまま押し続けると図形に整形されるまでの時間と許容ブレ */
const SHAPE_HOLD_MS = 650;
const SHAPE_HOLD_RADIUS = 7;

const PEN_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff"];
const MARKER_COLORS = ["#ffeb3b", "#b2ff59", "#ff80ab", "#40c4ff", "#ffab40"];

/** 消えるペン: 手が止まってから待つ時間と、消えるのにかかる時間 */
const FADE_IDLE_MS = 1200;
const FADE_DURATION_MS = 700;
/** ペンの基本の太さ（スライダーで変更可能） */
const PEN_WIDTH_DEFAULT = 4;
const PEN_WIDTH_MIN = 1.5;
const PEN_WIDTH_MAX = 12;
/** 蛍光マーカーの太さ */
const MARKER_WIDTH_DEFAULT = 16;
const MARKER_WIDTH_MIN = 6;
const MARKER_WIDTH_MAX = 40;
/** 万年筆らしいインクの濃度（わずかに透ける） */
const INK_ALPHA = 0.92;
/** 蛍光マーカーの透け具合 */
const MARKER_ALPHA = 0.38;

interface InkPoint {
  x: number;
  y: number;
  /** その地点での線の太さ（速度・筆圧から算出） */
  w: number;
}

interface Stroke {
  color: string;
  points: InkPoint[];
  /** marker は太さ一定・半透明の蛍光マーカー */
  kind: "pen" | "marker";
  /** ホールドで図形にスナップ済み（以降の移動と払いを無効化） */
  snapped?: boolean;
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

function setupInk(ctx: CanvasRenderingContext2D, color: string, effectiveAlpha: number): void {
  ctx.globalAlpha = effectiveAlpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** 蛍光マーカー: 太さ一定の1本のパスとして描く（継ぎ目のムラを作らない） */
function drawMarkerStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  effectiveAlpha: number
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  setupInk(ctx, stroke.color, effectiveAlpha);
  ctx.lineWidth = Math.max(1, pts[0].w);
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, Math.max(1, pts[0].w) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const m = midOf(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** effectiveAlpha をそのまま使って描く（オフスクリーン合成用） */
function drawStrokeRaw(ctx: CanvasRenderingContext2D, stroke: Stroke, effectiveAlpha: number): void {
  if (stroke.kind === "marker") {
    drawMarkerStroke(ctx, stroke, effectiveAlpha);
    return;
  }
  const pts = stroke.points;
  if (pts.length === 0) return;
  setupInk(ctx, stroke.color, effectiveAlpha);
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

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, alpha: number): void {
  drawStrokeRaw(ctx, stroke, alpha * (stroke.kind === "marker" ? MARKER_ALPHA : INK_ALPHA));
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
  const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0]);
  const [markerWidth, setMarkerWidth] = useState(MARKER_WIDTH_DEFAULT);
  const [strokeVersion, setStrokeVersion] = useState(0); // クリアボタン表示の更新用
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDotRef = useRef<HTMLDivElement>(null);
  const permStrokesRef = useRef<Map<number, Stroke[]>>(new Map());
  const fadeStrokesRef = useRef<Stroke[]>([]);
  /** 消えるペンを最後に動かした時刻。ここから1.2秒止まるとフェード開始 */
  const fadeActivityRef = useRef(0);
  const drawingRef = useRef<Stroke | null>(null);
  /** 描画中のポインタ ID（パームや他の指のイベントを混ぜないため） */
  const drawingPointerIdRef = useRef<number | null>(null);
  /** Apple Pencil を一度でも使ったか。使った後は「指タップ＝ページ送り」に切り替える */
  const pencilSeenRef = useRef(false);
  /** ページ送り候補の指タップ（動いたら無効化） */
  const fingerTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  /** 図形スナップ用: ペンが止まっているかの監視 */
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
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

  /** 消えるペンのオフスクリーン合成用キャンバス（半透明時の継ぎ目ムラを防ぐ） */
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

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
      // 描画中（図形スナップのホールド中を含む）はフェードさせない
      const stillDrawingFade =
        drawingRef.current != null && fadeStrokesRef.current.includes(drawingRef.current);
      const idle = stillDrawingFade ? 0 : performance.now() - fadeActivityRef.current;
      let alpha = 1;
      if (idle > FADE_IDLE_MS) {
        const t = idle - FADE_IDLE_MS;
        if (t >= FADE_DURATION_MS) {
          fadeStrokesRef.current = [];
          return false;
        }
        alpha = 1 - t / FADE_DURATION_MS;
      }
      // いったん不透明でオフスクリーンに描いてから全体を1枚として合成する。
      // 線分の継ぎ目でアルファが重なって粒状に濃く見えるのを防ぐ。
      let off = offscreenRef.current;
      if (!off || off.width !== canvas.width || off.height !== canvas.height) {
        off = document.createElement("canvas");
        off.width = canvas.width;
        off.height = canvas.height;
        offscreenRef.current = off;
      }
      const offCtx = off.getContext("2d");
      if (offCtx) {
        offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        offCtx.clearRect(0, 0, off.width / dpr, off.height / dpr);
        for (const stroke of fadeStrokesRef.current) drawStrokeRaw(offCtx, stroke, 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = alpha * INK_ALPHA;
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
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

  // iPad: 素早い連続ストロークが OS のジェスチャ判定に取られないよう、
  // ペン使用中はタッチイベントの既定動作を確実に止める（passive: false が必須）
  const penActiveTouchRef = useRef(false);
  penActiveTouchRef.current =
    tool === "pen" || tool === "fade" || tool === "marker" || tool === "fadeMarker";
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prevent = (e: TouchEvent) => {
      if (penActiveTouchRef.current) e.preventDefault();
    };
    const opts: AddEventListenerOptions = { passive: false };
    canvas.addEventListener("touchstart", prevent, opts);
    canvas.addEventListener("touchmove", prevent, opts);
    canvas.addEventListener("touchend", prevent, opts);
    return () => {
      canvas.removeEventListener("touchstart", prevent);
      canvas.removeEventListener("touchmove", prevent);
      canvas.removeEventListener("touchend", prevent);
    };
  }, []);

  // キャンバスサイズの設定と、スライド切替時の描き直し
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(winSize.w * dpr);
    canvas.height = Math.round(winSize.h * dpr);
    redrawAll();
  }, [winSize, index, redrawAll]);

  const penActive =
    tool === "pen" || tool === "fade" || tool === "marker" || tool === "fadeMarker";

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
    const w = stroke.kind === "marker" ? markerWidth : computeInkWidth(sample, prev);
    pts.push({ x: sample.x, y: sample.y, w });
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

  // ---- 図形スナップ（GoodNotes 風: 書いたままペンを止めて待つと整形） ----

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const trySnapShape = () => {
    const stroke = drawingRef.current;
    if (!stroke || stroke.snapped || stroke.points.length < 8) return;
    const shape = recognizeShape(stroke.points);
    if (!shape) return;
    // 図形は均一な太さが美しいので、元ストロークの中央値の太さで引き直す
    let w: number;
    if (stroke.kind === "marker") {
      w = stroke.points[0]?.w ?? markerWidth;
    } else {
      const widths = stroke.points.map((p) => p.w).sort((a, b) => a - b);
      w = Math.max(1, widths[Math.floor(widths.length / 2)] ?? penWidth);
    }
    stroke.points = shape.map((p) => ({ x: p.x, y: p.y, w }));
    stroke.snapped = true;
    redrawAll();
  };

  /** ペン先が動いたらホールド計測をやり直す */
  const resetHold = (x: number, y: number) => {
    holdAnchorRef.current = { x, y };
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(trySnapShape, SHAPE_HOLD_MS);
  };

  useEffect(
    () => () => {
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
    },
    []
  );

  // ---- 描画イベント ----

  const handleDrawStart = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!penActive) return;
    if (ev.pointerType === "pen") pencilSeenRef.current = true;
    // Apple Pencil を使い始めた後は、指のタップはページ送りとして扱う
    if (ev.pointerType === "touch" && pencilSeenRef.current) {
      fingerTapRef.current = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      return;
    }
    if (drawingRef.current) return; // 別のポインタで描画中（パーム等）は無視
    ev.preventDefault();
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // 合成イベント等で pointerId が無効な場合は無視
    }
    drawingPointerIdRef.current = ev.pointerId;
    inkStateRef.current = { lastT: ev.timeStamp, lastW: 0 };
    const isMarker = tool === "marker" || tool === "fadeMarker";
    const isFade = tool === "fade" || tool === "fadeMarker";
    const stroke: Stroke = {
      color: isMarker ? markerColor : penColor,
      points: [],
      kind: isMarker ? "marker" : "pen",
    };
    drawingRef.current = stroke;
    if (isFade) {
      fadeStrokesRef.current.push(stroke);
      fadeActivityRef.current = performance.now();
      ensureFadeLoop(); // 描画と「手が止まった」検知はこのループが担当する
    } else {
      // 通常ペンと蛍光マーカーはスライドごとに保持
      const list = permStrokesRef.current.get(index) ?? [];
      list.push(stroke);
      permStrokesRef.current.set(index, list);
    }
    addSample(stroke, toSample(ev.nativeEvent), null);
    if (tool === "marker") redrawAll();
    resetHold(ev.clientX, ev.clientY);
  };

  const handleDrawMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    // ページ送り候補の指が動いた場合はタップ扱いをやめる（パームレスト等）
    if (fingerTapRef.current && ev.pointerType === "touch") {
      const ft = fingerTapRef.current;
      if (Math.hypot(ev.clientX - ft.x, ev.clientY - ft.y) > 12) fingerTapRef.current = null;
    }
    const stroke = drawingRef.current;
    if (!stroke) return;
    // 描画中のポインタ以外（パーム・他の指）は線に混ぜない
    if (drawingPointerIdRef.current != null && ev.pointerId !== drawingPointerIdRef.current) return;
    ev.preventDefault();
    if (stroke.snapped) return; // 図形スナップ後はペンを離すまで固定
    if (tool === "fade" || tool === "fadeMarker") fadeActivityRef.current = performance.now();
    // ペン先が一定以上動いたらホールド計測をやり直す
    const anchor = holdAnchorRef.current;
    if (!anchor || Math.hypot(ev.clientX - anchor.x, ev.clientY - anchor.y) > SHAPE_HOLD_RADIUS) {
      resetHold(ev.clientX, ev.clientY);
    }
    // 通常ペンはその場で追いつき描画。消えるペンは rAF ループが毎フレーム描き直す
    let ctx: CanvasRenderingContext2D | null = null;
    if (tool === "pen") {
      ctx = canvasRef.current?.getContext("2d") ?? null;
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        setupInk(ctx, stroke.color, INK_ALPHA);
      }
    }
    // coalesced イベントで高解像度サンプリング（iPad の Apple Pencil は特に効く）
    const native = ev.nativeEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    if (events.length > 0) {
      for (const e of events) addSample(stroke, toSample(e), ctx);
    } else {
      addSample(stroke, toSample(native), ctx);
    }
    // マーカーは太さ一定の1本パスなので、毎回全体を描き直す（継ぎ目ムラ防止）
    if (tool === "marker") redrawAll();
  };

  const handleDrawEnd = (ev?: React.PointerEvent<HTMLCanvasElement>) => {
    // Apple Pencil 使用後の指タップ: 右半分で次へ、左半分で前へ
    if (ev && ev.pointerType === "touch" && fingerTapRef.current) {
      const tap = fingerTapRef.current;
      fingerTapRef.current = null;
      if (performance.now() - tap.t < 350) {
        if (ev.clientX >= winSize.w / 2) setIndex((i) => Math.min(total - 1, i + 1));
        else setIndex((i) => Math.max(0, i - 1));
      }
      return;
    }
    // 描画中のポインタ以外の離脱は無視
    if (
      ev &&
      drawingPointerIdRef.current != null &&
      ev.pointerId !== drawingPointerIdRef.current
    ) {
      return;
    }
    drawingPointerIdRef.current = null;
    clearHoldTimer();
    holdAnchorRef.current = null;
    const stroke = drawingRef.current;
    if (!stroke) return;
    drawingRef.current = null;
    const pts = stroke.points;
    // 「シュッ」とした払い（マーカーとスナップ済み図形は対象外）
    if (stroke.kind === "pen" && !stroke.snapped && pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const fastLift = segLen > 4;
      if (fastLift) {
        // 進行方向に減速しながら伸びる細い尻尾を、複数点でなめらかに描く
        const ux = (b.x - a.x) / segLen;
        const uy = (b.y - a.y) / segLen;
        const tailLen = Math.min(34, 6 + segLen * 2.2);
        const steps = 5;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const ease = 1 - Math.pow(1 - t, 2);
          pts.push({
            x: b.x + ux * tailLen * ease,
            y: b.y + uy * tailLen * ease,
            w: Math.max(0.25, b.w * Math.pow(1 - t, 1.6)),
          });
        }
      }
      // 末尾の先細り。速い抜きは長めに、置くように離した時は短めに絞る
      const k = Math.min(fastLift ? 10 : 4, pts.length);
      for (let i = 0; i < k; i++) {
        const p = pts[pts.length - 1 - i];
        p.w *= Math.pow((i + 1) / (k + 1), 0.9);
      }
    }
    if (tool === "fade" || tool === "fadeMarker") {
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
        <button
          className={`present-tool ${tool === "marker" ? "on" : ""}`}
          title="蛍光マーカー"
          onClick={() => toggleTool("marker")}
        >
          <ToolIcon d="M5 21h14M8 17l7-11 4 3-7 11H8v-3zM15 6l2-2 4 3-2 2" />
        </button>
        <button
          className={`present-tool ${tool === "fadeMarker" ? "on" : ""}`}
          title="自動で消える蛍光マーカー（手を止めると1.2秒後にふわっと消えます）"
          onClick={() => toggleTool("fadeMarker")}
        >
          <ToolIcon d="M4 21h9M7 17l6-9 4 3-6 9H7v-3zM18 15v.01M20 12v.01M21 8v.01" />
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

        {/* ペン・マーカー選択時だけ、バーの下にパレットと太さスライダーを出す */}
        {penActive &&
          (() => {
            const isMarker = tool === "marker" || tool === "fadeMarker";
            const colors = isMarker ? MARKER_COLORS : PEN_COLORS;
            const color = isMarker ? markerColor : penColor;
            const setColor = isMarker ? setMarkerColor : setPenColor;
            const width = isMarker ? markerWidth : penWidth;
            const setWidth = isMarker ? setMarkerWidth : setPenWidth;
            const previewSize = Math.min(width + 3, 22);
            return (
              <div className="present-palette" onClick={(e) => e.stopPropagation()}>
                {colors.map((c) => (
                  <button
                    key={c}
                    className={`present-color ${color === c ? "on" : ""}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
                <span className="present-width-sep" />
                <input
                  type="range"
                  className="present-width-slider"
                  min={isMarker ? MARKER_WIDTH_MIN : PEN_WIDTH_MIN}
                  max={isMarker ? MARKER_WIDTH_MAX : PEN_WIDTH_MAX}
                  step={isMarker ? 1 : 0.5}
                  value={width}
                  title={isMarker ? "マーカーの太さ" : "ペンの太さ"}
                  style={{ accentColor: color }}
                  onChange={(e) => setWidth(parseFloat(e.target.value))}
                />
                <span
                  className="present-width-preview"
                  title={`太さ: ${width}px`}
                  style={{
                    width: previewSize,
                    height: previewSize,
                    background: color,
                    opacity: isMarker ? 0.55 : 1,
                  }}
                />
              </div>
            );
          })()}
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
