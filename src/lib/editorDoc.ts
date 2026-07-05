// 編集用に iframe 内ドキュメントへ注入する属性・スタイルの管理と、保存用シリアライズ

export const EDITOR_STYLE_ID = "hse-editor-style";
export const SLIDE_ATTR = "data-hse-slide";
export const HIDDEN_ATTR = "data-hse-hidden";
export const SELECTED_ATTR = "data-hse-selected";
/** スライド外の固定 UI（デッキ自身のページ送りボタン等）を編集・プレビューで隠すマーク */
export const CHROME_ATTR = "data-hse-chrome";

/**
 * アニメーションを「最終状態まで一瞬で完了」させる CSS。
 * `animation: none` にすると entrance アニメーション（opacity:0 → 表示）を使う
 * スライドの要素が透明のまま残るため、代わりに即時完了させて fill 状態を活かす。
 */
export const INSTANT_ANIMATION_CSS = `
*, *::before, *::after {
  transition: none !important;
  animation-duration: 0.001s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
}
`;

/** 編集専用スタイルを iframe 内に注入する（保存時に除去される） */
export function injectEditorStyle(doc: Document): void {
  if (doc.getElementById(EDITOR_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = EDITOR_STYLE_ID;
  style.textContent = `
[${HIDDEN_ATTR}] { display: none !important; }
[${CHROME_ATTR}] { display: none !important; }
[${SLIDE_ATTR}]:not([${HIDDEN_ATTR}]) { opacity: 1 !important; visibility: visible !important; }
html, body { overflow: hidden !important; margin: 0 !important; }
${INSTANT_ANIMATION_CSS}
body { cursor: default; }
[${SELECTED_ATTR}] { cursor: move; }
[contenteditable="true"] {
  outline: 2px dashed rgba(77, 159, 255, 0.9) !important;
  outline-offset: 2px;
  cursor: text;
}
::selection { background: rgba(77, 159, 255, 0.35); }
`;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** スライド要素に連番マークを付ける */
export function markSlides(doc: Document, slides: HTMLElement[]): void {
  for (const el of Array.from(doc.querySelectorAll(`[${SLIDE_ATTR}]`))) {
    el.removeAttribute(SLIDE_ATTR);
  }
  slides.forEach((el, i) => el.setAttribute(SLIDE_ATTR, String(i)));
}

/** JS 制御のプレゼンでよく使われる「表示中」を表すクラス名の候補 */
const STATE_CLASS_CANDIDATES = ["active", "current", "present", "show", "visible"];

export interface SlideStateClass {
  /** 検出したクラス名（例: "active"） */
  className: string;
  /** 読み込み時点でこのクラスを持っていたスライドのインデックス（保存時に復元する） */
  originalHolders: number[];
}

/**
 * ドキュメント内のすべての CSS アニメーションを完了状態まで進める。
 * タブが非表示などでタイムラインが進まない環境でも、entrance アニメーション
 * （opacity:0 → 表示）で隠れた要素を確実に最終状態にするために呼ぶ。
 */
export function finishAllAnimations(doc: Document): void {
  try {
    for (const anim of doc.getAnimations()) {
      try {
        anim.finish();
      } catch {
        // 無限リピートのアニメーション等は finish できないので無視
      }
    }
  } catch {
    // getAnimations 非対応環境では何もしない
  }
}

/**
 * スライドの外にある固定 UI（デッキ自身のナビゲーションボタン・進捗バー等）をマークする。
 * マークされた要素は編集画面・サムネイル・プレゼンで非表示になる（保存時には残る）。
 */
export function markChromeElements(doc: Document, slides: HTMLElement[]): void {
  for (const el of Array.from(doc.querySelectorAll(`[${CHROME_ATTR}]`))) {
    el.removeAttribute(CHROME_ATTR);
  }
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    // スライド自身・スライドの中・スライドを含む要素は対象外
    if (slides.some((s) => s === el || s.contains(el) || el.contains(s))) continue;
    // すでにマーク済みの祖先があればスキップ
    if (el.closest(`[${CHROME_ATTR}]`)) continue;
    const position = win.getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      el.setAttribute(CHROME_ATTR, "");
    }
  }
}

/**
 * スライドの表示切替に使われる状態クラスを検出する。
 * `.slide { opacity:0 } .slide.active { opacity:1 }` のような JS 制御デッキでは、
 * このクラスを付け替えないと内容が表示されない。
 */
export function detectStateClass(doc: Document, slides: HTMLElement[]): SlideStateClass | null {
  if (slides.length < 2) return null;

  // 1. 一部のスライドだけが候補クラスを持っている場合（最初のスライドに active 等）
  for (const cls of STATE_CLASS_CANDIDATES) {
    const holders = slides
      .map((el, i) => (el.classList.contains(cls) ? i : -1))
      .filter((i) => i >= 0);
    if (holders.length > 0 && holders.length < slides.length) {
      return { className: cls, originalHolders: holders };
    }
  }

  // 2. CSS に「共通クラス.候補クラス」のセレクタがある場合（初期状態では誰も持っていない）
  const common = Array.from(slides[0].classList).filter((c) =>
    slides.every((el) => el.classList.contains(c))
  );
  const cssText = Array.from(doc.querySelectorAll("style"))
    .filter((s) => s.id !== EDITOR_STYLE_ID)
    .map((s) => s.textContent ?? "")
    .join("\n");
  for (const base of common) {
    for (const cls of STATE_CLASS_CANDIDATES) {
      if (cssText.includes(`.${base}.${cls}`)) {
        return { className: cls, originalHolders: [] };
      }
    }
  }
  return null;
}

/** 指定インデックスのスライドだけを表示する（状態クラスも付け替える） */
export function setActiveSlide(
  slides: HTMLElement[],
  index: number,
  stateClass: SlideStateClass | null = null
): void {
  slides.forEach((el, i) => {
    if (i === index) el.removeAttribute(HIDDEN_ATTR);
    else el.setAttribute(HIDDEN_ATTR, "");
    if (stateClass) el.classList.toggle(stateClass.className, i === index);
  });
}

export interface SerializeOptions {
  /** サムネイル・プレビュー用にスライド連番マークを残す */
  keepSlideMarks?: boolean;
  /** スライドの状態クラス（active 等）の扱い */
  stateClass?: SlideStateClass;
  /**
   * "original": 読み込み時のスライドに付け直す（保存用）
   * "all": 全スライドに付ける（サムネイル・プレビュー用。1枚ずつ表示するため）
   */
  stateMode?: "original" | "all";
}

/**
 * ドキュメントを HTML 文字列にシリアライズする。
 * エディタが注入したスタイル・属性・contenteditable はすべて取り除く。
 */
export function serializeDocument(doc: Document, options: SerializeOptions = {}): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelector(`#${EDITOR_STYLE_ID}`)?.remove();
  for (const el of Array.from(root.querySelectorAll("[contenteditable]"))) {
    el.removeAttribute("contenteditable");
  }
  // 状態クラスを編集中の状態から本来あるべき状態へ戻す
  if (options.stateClass) {
    const { className, originalHolders } = options.stateClass;
    const slideEls = Array.from(root.querySelectorAll(`[${SLIDE_ATTR}]`));
    slideEls.forEach((el, i) => {
      if (options.stateMode === "all") el.classList.add(className);
      else el.classList.toggle(className, originalHolders.includes(i));
    });
  }
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith("data-hse-")) continue;
      // サムネイル・プレビュー用には連番マークとチロームマークを残す
      if (options.keepSlideMarks && (attr.name === SLIDE_ATTR || attr.name === CHROME_ATTR)) {
        continue;
      }
      el.removeAttribute(attr.name);
    }
  }
  return `<!DOCTYPE html>\n${root.outerHTML}`;
}

/** シリアライズ済み HTML の </head> 直前にスタイルを差し込む（サムネイル・プレビュー用） */
export function injectStyleIntoHtml(html: string, css: string, id?: string): string {
  const tag = id ? `<style id="${id}">${css}</style>` : `<style>${css}</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${tag}</head>`);
  return tag + html;
}

/** i 番目のスライドだけを表示する CSS（元の display 値には触れない） */
export function onlySlideCss(index: number, options: { instantAnimation?: boolean } = {}): string {
  return `
[${SLIDE_ATTR}]:not([${SLIDE_ATTR}="${index}"]) { display: none !important; }
[${SLIDE_ATTR}="${index}"] { opacity: 1 !important; visibility: visible !important; }
[${CHROME_ATTR}] { display: none !important; }
html, body { overflow: hidden !important; margin: 0 !important; background: transparent; }
${options.instantAnimation === false ? "" : INSTANT_ANIMATION_CSS}
`;
}
