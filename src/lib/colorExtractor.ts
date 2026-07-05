// ドキュメント全体から使用色を抽出し、パレット（役割付き）として返す

import {
  parseColorTokens,
  normalizeColor,
  colorDistance,
  saturationOf,
  luminanceOf,
} from "./color";
import { EDITOR_STYLE_ID } from "./editorDoc";

export type ColorRole = "main" | "sub" | "accent" | "background" | "text" | "other";

export const ROLE_LABELS: Record<ColorRole, string> = {
  main: "メイン",
  sub: "サブ",
  accent: "アクセント",
  background: "背景",
  text: "テキスト",
  other: "その他",
};

export interface PaletteEntry {
  /** 代表色（#rrggbb） */
  hex: string;
  /** 出現回数（近似グループの合計） */
  count: number;
  /** このグループに属する色（代表色を含む） */
  members: string[];
  role: ColorRole;
}

interface ColorStat {
  count: number;
  textCount: number;
  bgCount: number;
}

/** 色を編集対象にできる属性 */
export const COLOR_ATTRIBUTES = ["fill", "stroke", "stop-color", "bgcolor", "color"];

interface Declaration {
  prop: string;
  value: string;
}

function collectRuleDeclarations(rules: CSSRuleList, out: Declaration[]): void {
  for (const rule of Array.from(rules)) {
    const styled = rule as CSSStyleRule;
    if (styled.style) {
      for (let i = 0; i < styled.style.length; i++) {
        const prop = styled.style.item(i);
        out.push({ prop, value: styled.style.getPropertyValue(prop) });
      }
    }
    const grouped = rule as CSSGroupingRule;
    if (grouped.cssRules) collectRuleDeclarations(grouped.cssRules, out);
  }
}

/** ドキュメント内の全宣言（<style> ＋ インライン style）を集める */
function collectDeclarations(doc: Document): Declaration[] {
  const decls: Declaration[] = [];
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    if (styleEl.id === EDITOR_STYLE_ID) continue;
    const sheet = styleEl.sheet;
    if (!sheet) continue;
    try {
      collectRuleDeclarations(sheet.cssRules, decls);
    } catch {
      // アクセス不能なシートはスキップ
    }
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement | SVGElement>("[style]"))) {
    const style = el.style;
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      decls.push({ prop, value: style.getPropertyValue(prop) });
    }
  }
  return decls;
}

export function extractPalette(doc: Document, mergeTolerance = 0): PaletteEntry[] {
  const stats = new Map<string, ColorStat>();
  const varColors = new Map<string, string>();

  const bump = (hex: string, prop: string, weight = 1) => {
    const stat = stats.get(hex) ?? { count: 0, textCount: 0, bgCount: 0 };
    stat.count += weight;
    if (prop === "color" || prop === "-webkit-text-fill-color") stat.textCount += weight;
    if (prop.includes("background")) stat.bgCount += weight;
    stats.set(hex, stat);
  };

  const decls = collectDeclarations(doc);

  // CSS 変数に入っている色を記録（var() 参照のカウントに使う）
  for (const { prop, value } of decls) {
    if (!prop.startsWith("--")) continue;
    const tokens = parseColorTokens(value);
    if (tokens.length === 1 && tokens[0].alpha > 0) varColors.set(prop, tokens[0].hex);
  }

  for (const { prop, value } of decls) {
    for (const token of parseColorTokens(value)) {
      if (token.alpha === 0) continue;
      bump(token.hex, prop);
    }
    // var(--x) 参照は、変数に入っている色の使用としてカウント
    const varRefs = value.matchAll(/var\(\s*(--[\w-]+)/g);
    for (const m of varRefs) {
      const hex = varColors.get(m[1]);
      if (hex) bump(hex, prop);
    }
  }

  // 色付き属性（SVG の fill 等）
  for (const attrName of COLOR_ATTRIBUTES) {
    for (const el of Array.from(doc.querySelectorAll(`[${attrName}]`))) {
      const norm = normalizeColor(el.getAttribute(attrName) ?? "");
      if (norm && norm.alpha > 0) bump(norm.hex, attrName === "bgcolor" ? "background" : attrName);
    }
  }

  // 近似色のグルーピング（出現回数の多い色を代表にする）
  const sorted = Array.from(stats.entries()).sort((a, b) => b[1].count - a[1].count);
  interface Group {
    hex: string;
    members: string[];
    stat: ColorStat;
  }
  const groups: Group[] = [];
  for (const [hex, stat] of sorted) {
    const near =
      mergeTolerance > 0
        ? groups.find((g) => colorDistance(g.hex, hex) <= mergeTolerance)
        : undefined;
    if (near) {
      near.members.push(hex);
      near.stat.count += stat.count;
      near.stat.textCount += stat.textCount;
      near.stat.bgCount += stat.bgCount;
    } else {
      groups.push({ hex, members: [hex], stat: { ...stat } });
    }
  }
  groups.sort((a, b) => b.stat.count - a.stat.count);

  // 役割の推定
  const roles = new Map<string, ColorRole>();
  const unassigned = () => groups.filter((g) => !roles.has(g.hex));

  // 背景: background 系での使用が最も多く、彩度が低い or 明暗が極端な色（先に確定させる）
  const bgCandidates = [...groups]
    .filter((g) => g.stat.bgCount > 0)
    .sort((a, b) => b.stat.bgCount - a.stat.bgCount);
  const bgGroup = bgCandidates.find(
    (g) => saturationOf(g.hex) < 0.25 || luminanceOf(g.hex) > 0.85 || luminanceOf(g.hex) < 0.1
  );
  if (bgGroup) roles.set(bgGroup.hex, "background");

  // テキスト: color プロパティでの使用が多く、かつ「文字色らしい」色
  // （低彩度、またはほぼ黒・ほぼ白）。鮮やかな色はメイン等に回す
  const looksLikeText = (hex: string) =>
    saturationOf(hex) < 0.35 || luminanceOf(hex) < 0.15 || luminanceOf(hex) > 0.9;
  const byTextCount = unassigned().sort((a, b) => b.stat.textCount - a.stat.textCount);
  const textGroup = byTextCount.find((g) => g.stat.textCount > 0 && looksLikeText(g.hex));
  if (textGroup) roles.set(textGroup.hex, "text");

  // メイン: 残りの彩度のある色のうち最も使われている色
  const colorful = unassigned().filter((g) => saturationOf(g.hex) >= 0.15);
  if (colorful[0]) roles.set(colorful[0].hex, "main");
  // アクセント: 残りのうち最も鮮やかな色、サブ: その次に使われている色
  const rest = colorful.slice(1);
  const accent = [...rest].sort((a, b) => saturationOf(b.hex) - saturationOf(a.hex))[0];
  if (accent) roles.set(accent.hex, "accent");
  const sub = rest.find((g) => g !== accent);
  if (sub) roles.set(sub.hex, "sub");

  return groups.map((g) => ({
    hex: g.hex,
    count: g.stat.count,
    members: g.members,
    role: roles.get(g.hex) ?? "other",
  }));
}
