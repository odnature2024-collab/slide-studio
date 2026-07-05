// 色トークンの検出・正規化・置換ユーティリティ（DOM に依存しない純粋関数のみ）

export interface ColorToken {
  /** 元の表記（例: "#1C4E80", "rgba(0,0,0,.5)", "white"） */
  raw: string;
  /** 値文字列内での開始位置 */
  start: number;
  /** 値文字列内での終了位置（排他的） */
  end: number;
  /** 正規化した #rrggbb（小文字） */
  hex: string;
  /** アルファ値 0〜1 */
  alpha: number;
}

// よく使われる CSS 名前付きカラー（実用的なサブセット）
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  gold: "#ffd700",
  navy: "#000080",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  lime: "#00ff00",
  maroon: "#800000",
  olive: "#808000",
  brown: "#a52a2a",
  coral: "#ff7f50",
  crimson: "#dc143c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  salmon: "#fa8072",
  sienna: "#a0522d",
  skyblue: "#87ceeb",
  slategray: "#708090",
  snow: "#fffafa",
  tan: "#d2b48c",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  whitesmoke: "#f5f5f5",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  dimgray: "#696969",
  gainsboro: "#dcdcdc",
  royalblue: "#4169e1",
  steelblue: "#4682b4",
  dodgerblue: "#1e90ff",
  midnightblue: "#191970",
  cornflowerblue: "#6495ed",
  lightblue: "#add8e6",
  darkblue: "#00008b",
  seagreen: "#2e8b57",
  forestgreen: "#228b22",
  darkgreen: "#006400",
  lightgreen: "#90ee90",
  goldenrod: "#daa520",
  darkorange: "#ff8c00",
  orangered: "#ff4500",
  firebrick: "#b22222",
  darkred: "#8b0000",
  hotpink: "#ff69b4",
  deeppink: "#ff1493",
  plum: "#dda0dd",
  orchid: "#da70d6",
  slateblue: "#6a5acd",
  mediumpurple: "#9370db",
  rebeccapurple: "#663399",
  beige: "#f5f5dc",
  linen: "#faf0e6",
  mintcream: "#f5fffa",
  aliceblue: "#f0f8ff",
  ghostwhite: "#f8f8ff",
  honeydew: "#f0fff0",
  seashell: "#fff5ee",
  floralwhite: "#fffaf0",
  antiquewhite: "#faebd7",
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toHexByte(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** 単一の色表記を正規化。色として解釈できなければ null */
export function normalizeColor(raw: string): { hex: string; alpha: number } | null {
  const s = raw.trim().toLowerCase();

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { hex: rgbToHex(r, g, b), alpha: a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { hex: rgbToHex(r, g, b), alpha: a };
    }
    return null;
  }

  // rgb() / rgba()
  const rgbMatch = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (rgbMatch) {
    const parse = (v: string) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const r = parse(rgbMatch[1]);
    const g = parse(rgbMatch[2]);
    const b = parse(rgbMatch[3]);
    let a = 1;
    if (rgbMatch[4] != null) {
      a = rgbMatch[4].endsWith("%") ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
    }
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { hex: rgbToHex(r, g, b), alpha: clamp(a, 0, 1) };
  }

  // hsl() / hsla()
  const hslMatch = /^hsla?\(\s*([\d.-]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (hslMatch) {
    const { r, g, b } = hslToRgb(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]) / 100, parseFloat(hslMatch[3]) / 100);
    let a = 1;
    if (hslMatch[4] != null) {
      a = hslMatch[4].endsWith("%") ? parseFloat(hslMatch[4]) / 100 : parseFloat(hslMatch[4]);
    }
    return { hex: rgbToHex(r, g, b), alpha: clamp(a, 0, 1) };
  }

  // 名前付きカラー
  if (s === "transparent") return { hex: "#000000", alpha: 0 };
  if (NAMED_COLORS[s]) return { hex: NAMED_COLORS[s], alpha: 1 };

  return null;
}

// 値文字列から色トークンを探す正規表現
const TOKEN_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|(?<![\w-])[a-zA-Z]{3,20}(?![\w-])/g;

/** CSS 値文字列（グラデーション等の複合値も可）から色トークンを列挙する */
export function parseColorTokens(value: string): ColorToken[] {
  const tokens: ColorToken[] = [];
  // url(...) の中身は対象外にする
  const masked = value.replace(/url\([^)]*\)/gi, (m) => " ".repeat(m.length));
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(masked)) !== null) {
    const raw = m[0];
    // 単語トークンは名前付きカラーのみ許可（identifier の誤検出を防ぐ）
    if (/^[a-zA-Z]+$/.test(raw) && !NAMED_COLORS[raw.toLowerCase()] && raw.toLowerCase() !== "transparent") {
      continue;
    }
    const norm = normalizeColor(raw);
    if (!norm) continue;
    tokens.push({ raw, start: m.index, end: m.index + raw.length, hex: norm.hex, alpha: norm.alpha });
  }
  return tokens;
}

/**
 * 値文字列の中で targetHex（アルファ無視で比較）に一致する色トークンを newHex に置き換える。
 * 元のトークンが半透明なら、そのアルファ値を保った rgba() として出力する。
 * 置換が起きなければ null を返す。
 */
export function replaceColorInValue(value: string, targetHex: string, newHex: string): string | null {
  const tokens = parseColorTokens(value);
  const hits = tokens.filter((t) => t.hex === targetHex.toLowerCase() && t.alpha > 0);
  if (hits.length === 0) return null;
  let result = "";
  let cursor = 0;
  for (const t of hits) {
    result += value.slice(cursor, t.start);
    if (t.alpha < 1) {
      const { r, g, b } = hexToRgb(newHex);
      const a = Math.round(t.alpha * 1000) / 1000;
      result += `rgba(${r}, ${g}, ${b}, ${a})`;
    } else {
      result += newHex;
    }
    cursor = t.end;
  }
  result += value.slice(cursor);
  return result;
}

/** RGB 空間のユークリッド距離（0〜441） */
export function colorDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** 彩度（0〜1）。役割推定に使う */
export function saturationOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

/** 相対輝度（0〜1）。役割推定に使う */
export function luminanceOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
