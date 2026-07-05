// フォントカタログ（無料で使える Google Fonts ＋ OS 標準フォント）と、
// ドキュメント内で使用中のフォントの抽出

import { EDITOR_STYLE_ID } from "./editorDoc";

export type FontGroup =
  | "japanese-gothic"
  | "japanese-mincho"
  | "japanese-design"
  | "latin"
  | "mono"
  | "system";

export const FONT_GROUP_LABELS: Record<FontGroup, string> = {
  "japanese-gothic": "日本語 — ゴシック体",
  "japanese-mincho": "日本語 — 明朝体",
  "japanese-design": "日本語 — 丸ゴ・デザイン",
  latin: "欧文",
  mono: "等幅",
  system: "OS 標準フォント",
};

export interface FontOption {
  label: string;
  family: string;
  url?: string;
  group: FontGroup;
}

/** Google Fonts の読み込み URL を組み立てる */
function gf(name: string, weights?: string): string {
  const family = name.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}${
    weights ? `:wght@${weights}` : ""
  }&display=swap`;
}

function g(
  group: FontGroup,
  label: string,
  cssName: string,
  fallback: string,
  weights?: string
): FontOption {
  return { group, label, family: `'${cssName}', ${fallback}`, url: gf(cssName, weights) };
}

export const FONT_CATALOG: FontOption[] = [
  // --- 日本語 ゴシック ---
  g("japanese-gothic", "Noto Sans JP", "Noto Sans JP", "sans-serif", "400;500;700;900"),
  g("japanese-gothic", "M PLUS 1p", "M PLUS 1p", "sans-serif", "400;700"),
  g("japanese-gothic", "M PLUS 2", "M PLUS 2", "sans-serif", "400;700"),
  g("japanese-gothic", "Zen Kaku Gothic New", "Zen Kaku Gothic New", "sans-serif", "400;700"),
  g("japanese-gothic", "BIZ UDPゴシック", "BIZ UDPGothic", "sans-serif", "400;700"),
  g("japanese-gothic", "Kosugi（小杉）", "Kosugi", "sans-serif"),
  g("japanese-gothic", "Sawarabi Gothic", "Sawarabi Gothic", "sans-serif"),
  g("japanese-gothic", "Murecho", "Murecho", "sans-serif", "400;700"),
  g("japanese-gothic", "Shippori Antique", "Shippori Antique", "sans-serif"),

  // --- 日本語 明朝 ---
  g("japanese-mincho", "Noto Serif JP", "Noto Serif JP", "serif", "400;600;900"),
  g("japanese-mincho", "Shippori Mincho", "Shippori Mincho", "serif", "400;700"),
  g("japanese-mincho", "Zen Old Mincho", "Zen Old Mincho", "serif", "400;700;900"),
  g("japanese-mincho", "BIZ UDP明朝", "BIZ UDPMincho", "serif"),
  g("japanese-mincho", "Sawarabi Mincho", "Sawarabi Mincho", "serif"),
  g("japanese-mincho", "Hina Mincho（雛明朝）", "Hina Mincho", "serif"),
  g("japanese-mincho", "Kaisei Tokumin（解星 特ミン）", "Kaisei Tokumin", "serif", "400;700"),
  g("japanese-mincho", "Kaisei Opti（解星 オプティ）", "Kaisei Opti", "serif", "400;700"),
  g("japanese-mincho", "New Tegomin（ニューテゴミン）", "New Tegomin", "serif"),

  // --- 日本語 丸ゴ・デザイン ---
  g("japanese-design", "M PLUS Rounded 1c（丸ゴ）", "M PLUS Rounded 1c", "sans-serif", "400;700"),
  g("japanese-design", "Zen Maru Gothic（丸ゴ）", "Zen Maru Gothic", "sans-serif", "400;700"),
  g("japanese-design", "Kosugi Maru（小杉丸）", "Kosugi Maru", "sans-serif"),
  g("japanese-design", "Kiwi Maru", "Kiwi Maru", "serif", "400;500"),
  g("japanese-design", "Klee One（クレー）", "Klee One", "cursive", "400;600"),
  g("japanese-design", "Yusei Magic（ユセイマジック）", "Yusei Magic", "sans-serif"),
  g("japanese-design", "Zen Kurenaido（ゼン紅道）", "Zen Kurenaido", "sans-serif"),
  g("japanese-design", "Dela Gothic One（極太）", "Dela Gothic One", "cursive"),
  g("japanese-design", "RocknRoll One", "RocknRoll One", "sans-serif"),
  g("japanese-design", "Mochiy Pop One", "Mochiy Pop One", "sans-serif"),
  g("japanese-design", "Potta One", "Potta One", "cursive"),
  g("japanese-design", "Hachi Maru Pop（手書き風）", "Hachi Maru Pop", "cursive"),
  g("japanese-design", "Yuji Syuku（佑字 肅）", "Yuji Syuku", "serif"),
  g("japanese-design", "DotGothic16（ドット絵風）", "DotGothic16", "sans-serif"),
  g("japanese-design", "Rampart One（立体枠）", "Rampart One", "cursive"),
  g("japanese-design", "Reggae One", "Reggae One", "cursive"),
  g("japanese-design", "Train One", "Train One", "cursive"),
  g("japanese-design", "Stick（ステッキ）", "Stick", "sans-serif"),
  g("japanese-design", "Kaisei Decol（解星 デコール）", "Kaisei Decol", "serif", "400;700"),

  // --- 欧文 ---
  g("latin", "DM Sans", "DM Sans", "sans-serif", "400;500;700"),
  g("latin", "Inter", "Inter", "sans-serif", "400;600;700"),
  g("latin", "Roboto", "Roboto", "sans-serif", "400;500;700"),
  g("latin", "Montserrat", "Montserrat", "sans-serif", "400;600;700"),
  g("latin", "Poppins", "Poppins", "sans-serif", "400;600;700"),
  g("latin", "Raleway", "Raleway", "sans-serif", "400;600;700"),
  g("latin", "Oswald", "Oswald", "sans-serif", "400;600"),
  g("latin", "Bebas Neue（コンデンス）", "Bebas Neue", "sans-serif"),
  g("latin", "Playfair Display（セリフ）", "Playfair Display", "serif", "400;700"),
  g("latin", "Lora（セリフ）", "Lora", "serif", "400;700"),
  g("latin", "Merriweather（セリフ）", "Merriweather", "serif", "400;700"),
  g("latin", "Abril Fatface（ディスプレイ）", "Abril Fatface", "serif"),
  g("latin", "Pacifico（スクリプト）", "Pacifico", "cursive"),
  g("latin", "Caveat（手書き風）", "Caveat", "cursive", "400;700"),

  // --- 等幅 ---
  g("mono", "JetBrains Mono", "JetBrains Mono", "monospace", "400;700"),
  g("mono", "Source Code Pro", "Source Code Pro", "monospace", "400;700"),
  g("mono", "IBM Plex Mono", "IBM Plex Mono", "monospace", "400;500"),
  g("mono", "Roboto Mono", "Roboto Mono", "monospace", "400;700"),

  // --- OS 標準 ---
  { group: "system", label: "游ゴシック", family: "'Yu Gothic', 'YuGothic', sans-serif" },
  { group: "system", label: "游明朝", family: "'Yu Mincho', 'YuMincho', serif" },
  { group: "system", label: "ヒラギノ角ゴ", family: "'Hiragino Kaku Gothic ProN', sans-serif" },
  { group: "system", label: "ヒラギノ明朝", family: "'Hiragino Mincho ProN', serif" },
  { group: "system", label: "ヒラギノ丸ゴ", family: "'Hiragino Maru Gothic ProN', sans-serif" },
  { group: "system", label: "メイリオ", family: "'Meiryo', sans-serif" },
  { group: "system", label: "ゴシック体（汎用）", family: "sans-serif" },
  { group: "system", label: "明朝体（汎用）", family: "serif" },
  { group: "system", label: "等幅（汎用）", family: "monospace" },
];

export const FONT_GROUP_ORDER: FontGroup[] = [
  "japanese-gothic",
  "japanese-mincho",
  "japanese-design",
  "latin",
  "mono",
  "system",
];

export interface UsedFont {
  /** CSS に書かれている font-family 値そのまま（適用に使う） */
  family: string;
  /** 表示用（先頭のフォント名） */
  label: string;
}

/** ドキュメント内の font-family 宣言をすべて集める（使用中フォント一覧用） */
export function extractUsedFonts(doc: Document): UsedFont[] {
  const values = new Set<string>();

  const collectFromRules = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const styled = rule as CSSStyleRule;
      if (styled.style) {
        const v = styled.style.getPropertyValue("font-family");
        if (v) values.add(v.trim());
      }
      const grouped = rule as CSSGroupingRule;
      if (grouped.cssRules) collectFromRules(grouped.cssRules);
    }
  };

  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    if (styleEl.id === EDITOR_STYLE_ID) continue;
    try {
      if (styleEl.sheet) collectFromRules(styleEl.sheet.cssRules);
    } catch {
      // アクセス不能なシートはスキップ
    }
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement | SVGElement>("[style]"))) {
    const v = el.style.getPropertyValue("font-family");
    if (v) values.add(v.trim());
  }

  const seen = new Set<string>();
  const fonts: UsedFont[] = [];
  for (const family of values) {
    const first = family.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    if (!first || first === "inherit" || first === "initial") continue;
    const key = first.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fonts.push({ family, label: first });
  }
  return fonts.sort((a, b) => a.label.localeCompare(b.label, "ja"));
}
