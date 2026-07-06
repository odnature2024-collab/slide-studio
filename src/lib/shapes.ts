// 図形挿入のカタログ（Canva 風）。viewBox 0 0 100 100 の SVG として定義し、
// preserveAspectRatio="none" で挿入するため、リサイズで自由に伸縮できる。

export interface ShapeDef {
  id: string;
  label: string;
  /** viewBox 0 0 100 100 内の SVG マークアップ。__FILL__ が色に置換される */
  inner: string;
  /** 線ベースの図形（fill ではなく stroke に色を適用） */
  strokeBased?: boolean;
  /** 挿入時の縦横比（幅に対する高さ。省略時は 1:1） */
  aspect?: number;
}

const STAR_POINTS = "50,2 61.8,35.5 97.6,35.5 68.7,57.6 79.4,91.5 50,71 20.6,91.5 31.3,57.6 2.4,35.5 38.2,35.5";

export const SHAPES: ShapeDef[] = [
  { id: "rect", label: "四角形", inner: `<rect x="0" y="0" width="100" height="100" fill="__FILL__"/>` },
  {
    id: "rounded",
    label: "角丸四角形",
    inner: `<rect x="0" y="0" width="100" height="100" rx="14" ry="14" fill="__FILL__"/>`,
  },
  { id: "circle", label: "円", inner: `<ellipse cx="50" cy="50" rx="50" ry="50" fill="__FILL__"/>` },
  {
    id: "ellipse",
    label: "楕円",
    inner: `<ellipse cx="50" cy="50" rx="50" ry="50" fill="__FILL__"/>`,
    aspect: 0.62,
  },
  { id: "triangle", label: "三角形", inner: `<polygon points="50,0 100,100 0,100" fill="__FILL__"/>` },
  {
    id: "right-triangle",
    label: "直角三角形",
    inner: `<polygon points="0,0 0,100 100,100" fill="__FILL__"/>`,
  },
  { id: "diamond", label: "ひし形", inner: `<polygon points="50,0 100,50 50,100 0,50" fill="__FILL__"/>` },
  {
    id: "pentagon",
    label: "五角形",
    inner: `<polygon points="50,0 100,38 81,100 19,100 0,38" fill="__FILL__"/>`,
  },
  {
    id: "hexagon",
    label: "六角形",
    inner: `<polygon points="25,0 75,0 100,50 75,100 25,100 0,50" fill="__FILL__"/>`,
  },
  { id: "star", label: "星", inner: `<polygon points="${STAR_POINTS}" fill="__FILL__"/>` },
  {
    id: "arrow",
    label: "矢印",
    inner: `<polygon points="0,32 62,32 62,10 100,50 62,90 62,68 0,68" fill="__FILL__"/>`,
    aspect: 0.55,
  },
  {
    id: "double-arrow",
    label: "両方向矢印",
    inner: `<polygon points="0,50 28,16 28,36 72,36 72,16 100,50 72,84 72,64 28,64 28,84" fill="__FILL__"/>`,
    aspect: 0.45,
  },
  {
    id: "line",
    label: "直線",
    inner: `<line x1="0" y1="50" x2="100" y2="50" stroke="__FILL__" stroke-width="5" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
    strokeBased: true,
    aspect: 0.08,
  },
  {
    id: "speech",
    label: "吹き出し",
    inner: `<path d="M10 4 H90 Q98 4 98 12 V58 Q98 66 90 66 H46 L30 88 V66 H10 Q2 66 2 58 V12 Q2 4 10 4 Z" fill="__FILL__"/>`,
    aspect: 0.82,
  },
  {
    id: "heart",
    label: "ハート",
    inner: `<path d="M50 90 C18 66 2 46 2 27 C2 12 14 3 27 3 C37 3 46 9 50 18 C54 9 63 3 73 3 C86 3 98 12 98 27 C98 46 82 66 50 90 Z" fill="__FILL__"/>`,
    aspect: 0.9,
  },
  {
    id: "check",
    label: "チェック",
    inner: `<path d="M8 55 L38 85 L92 18" fill="none" stroke="__FILL__" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`,
    strokeBased: true,
  },
];

/** __FILL__ を実際の色に置き換えた SVG マークアップを返す */
export function shapeMarkup(def: ShapeDef, color: string): string {
  return def.inner.split("__FILL__").join(color);
}
