// 手描きストロークの図形認識（GoodNotes 風のホールドスナップ用）
// 直線・折れ線・三角形・四角形・円/楕円を検出し、整形済みの輪郭点列を返す

export interface Pt {
  x: number;
  y: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/** 点 p から線分 ab への垂直距離 */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker 法でポリラインを単純化する */
export function simplify(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplify(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplify(pts.slice(maxIdx), epsilon);
  return [...left.slice(0, -1), ...right];
}

function bboxOf(pts: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** 角の列を等間隔の点列に展開する（closed なら始点へ戻って閉じる） */
function outlinePolygon(corners: Pt[], closed: boolean, step = 6): Pt[] {
  const nodes = closed ? [...corners, corners[0]] : corners;
  const out: Pt[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

function outlineEllipse(cx: number, cy: number, rx: number, ry: number, n = 72): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
}

/** 45° の倍数に近い直線は角度をスナップする */
function snapLineEnd(a: Pt, b: Pt): Pt {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  const deg = Math.abs(angle - snapped) * (180 / Math.PI);
  if (deg > 6) return b;
  const len = dist(a, b);
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

/** 楕円（bbox 基準）からの平均偏差。0 に近いほど円/楕円らしい */
function ellipseDeviation(pts: Pt[], cx: number, cy: number, rx: number, ry: number): number {
  let dev = 0;
  for (const p of pts) {
    const v = Math.sqrt(((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2);
    dev += Math.abs(v - 1);
  }
  return dev / pts.length;
}

/** 4隅がほぼ軸平行の四角形なら bbox にスナップした長方形を返す */
function trySnapRect(corners: Pt[]): Pt[] | null {
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const angle = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) % (Math.PI / 2);
    const offAxis = Math.min(angle, Math.PI / 2 - angle) * (180 / Math.PI);
    if (offAxis > 12) return null;
  }
  const bb = bboxOf(corners);
  return [
    { x: bb.minX, y: bb.minY },
    { x: bb.maxX, y: bb.minY },
    { x: bb.maxX, y: bb.maxY },
    { x: bb.minX, y: bb.maxY },
  ];
}

/**
 * ストロークを図形として認識し、整形済みの点列を返す。
 * 認識できなければ null（元のストロークをそのまま残す）。
 */
export function recognizeShape(raw: Pt[]): Pt[] | null {
  if (raw.length < 8) return null;
  const len = pathLength(raw);
  if (len < 40) return null;

  const bb = bboxOf(raw);
  const diag = Math.hypot(bb.w, bb.h);
  const epsilon = Math.max(6, diag * 0.05);
  const simplified = simplify(raw, epsilon);
  const closed = dist(raw[0], raw[raw.length - 1]) < Math.max(24, len * 0.15);

  if (!closed) {
    if (simplified.length === 2) {
      // 直線（水平・垂直・45°に近ければスナップ）
      const end = snapLineEnd(simplified[0], simplified[1]);
      return outlinePolygon([simplified[0], end], false);
    }
    if (simplified.length <= 5) {
      // 折れ線: 各区間をまっすぐに
      return outlinePolygon(simplified, false);
    }
    return null;
  }

  // ---- 閉じた図形 ----
  const corners = simplified.slice();
  if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < epsilon * 1.5) {
    corners.pop();
  }

  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const rx = bb.w / 2;
  const ry = bb.h / 2;
  const canBeEllipse = rx > 8 && ry > 8;
  const dev = canBeEllipse ? ellipseDeviation(raw, cx, cy, rx, ry) : 1;

  // 非常に円らしい場合は角数に関わらず円/楕円
  if (dev < 0.09) return outlineEllipse(cx, cy, rx, ry);

  if (corners.length === 3) return outlinePolygon(corners, true); // 三角形
  if (corners.length === 4) {
    return outlinePolygon(trySnapRect(corners) ?? corners, true); // 四角形
  }
  if (dev < 0.2) return outlineEllipse(cx, cy, rx, ry); // ややラフな円
  if (corners.length >= 5 && corners.length <= 8) return outlinePolygon(corners, true); // 多角形

  return null;
}
