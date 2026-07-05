// パレット色の一括置換。<style> のテキスト・インライン style・色属性のすべてを書き換える。
//
// 重要: <style> は CSSOM から再生成せず、テキストを直接置換する。
// CSSOM の再シリアライズは `animation: rise .75s var(--ease) both` のような
// var() を含むショートハンドを脱落させることがあり、文書を壊してしまうため。

import { replaceColorInValue, normalizeColor } from "./color";
import { COLOR_ATTRIBUTES } from "./colorExtractor";
import { EDITOR_STYLE_ID, finishAllAnimations } from "./editorDoc";

/** 値テキストに対して targets → newHex の置換を順に適用する。変化がなければ null */
function replaceTargets(text: string, targets: string[], newHex: string): string | null {
  let current = text;
  let changed = false;
  for (const target of targets) {
    const replaced = replaceColorInValue(current, target, newHex);
    if (replaced != null) {
      current = replaced;
      changed = true;
    }
  }
  return changed ? current : null;
}

/**
 * CSS テキスト内の「宣言ブロック（最内の { ... }）」の中だけ色を置換する。
 * セレクタや @keyframes 名など、ブロック外のテキストには触れない。
 */
export function replaceColorsInCssText(
  css: string,
  targets: string[],
  newHex: string
): { text: string; changed: number } {
  let changed = 0;
  // [^{}] のみのブロック＝最内ブロック（宣言の並び）だけがマッチする
  const text = css.replace(/\{[^{}]*\}/g, (block) => {
    const inner = block.slice(1, -1);
    const replaced = replaceTargets(inner, targets, newHex);
    if (replaced == null) return block;
    changed++;
    return `{${replaced}}`;
  });
  return { text, changed };
}

/**
 * ドキュメント全体で targets のいずれかの色（アルファ無視で一致）を newHex に置き換える。
 * 変更した箇所の数を返す。
 */
export function replaceColorEverywhere(doc: Document, targets: string[], newHex: string): number {
  const normalizedTargets = targets.map((t) => t.toLowerCase());
  let changed = 0;

  // 1. <style> のテキストを直接置換（CSSOM 再生成はしない）
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    if (styleEl.id === EDITOR_STYLE_ID) continue;
    const css = styleEl.textContent ?? "";
    if (!css) continue;
    const result = replaceColorsInCssText(css, normalizedTargets, newHex);
    if (result.changed > 0) {
      styleEl.textContent = result.text;
      changed += result.changed;
    }
  }

  // 2. インライン style（属性テキストを直接置換）
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const attr = el.getAttribute("style") ?? "";
    const replaced = replaceTargets(attr, normalizedTargets, newHex);
    if (replaced != null) {
      el.setAttribute("style", replaced);
      changed++;
    }
  }

  // 3. 色属性（SVG fill / stroke など）
  for (const attrName of COLOR_ATTRIBUTES) {
    for (const el of Array.from(doc.querySelectorAll(`[${attrName}]`))) {
      const raw = el.getAttribute(attrName) ?? "";
      const norm = normalizeColor(raw);
      if (norm && normalizedTargets.includes(norm.hex)) {
        el.setAttribute(attrName, newHex);
        changed++;
      }
    }
  }

  // <style> の差し替えで再始動したアニメーションを完了状態へ進める
  if (changed > 0) finishAllAnimations(doc);

  return changed;
}
