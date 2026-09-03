// 読み込んだ HTML からスライド要素群を検出するヒューリスティック

export interface SlideDetection {
  /** 表示・並べ替え・複製・削除の単位になる、最も外側のページルート */
  slides: HTMLElement[];
  /** 状態クラス（active/current 等）を付け替える元のスライド要素 */
  stateTargets: HTMLElement[];
  /** 検出方法の説明（UI 表示用） */
  method: string;
  /** 検出に自信があるか（低いときは UI で注意表示） */
  confident: boolean;
}

const IGNORED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "TEMPLATE",
  "NOSCRIPT",
  "BR",
]);

/** iframe など別 realm の要素にも安全な Element 判定 */
function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function elementChildren(parent: Element): HTMLElement[] {
  return Array.from(parent.children).filter(
    (el): el is HTMLElement => isElement(el) && !IGNORED_TAGS.has(el.tagName)
  );
}

/** ネストを除去（他の候補の内側にある候補を外す）し、文書順に並べる */
function topLevelOnly(els: HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
}

function classSignature(el: Element): string {
  return `${el.tagName}.${Array.from(el.classList).sort().join(".")}`;
}

/** class / id がページを包む要素らしいか */
function hasPageWrapperName(el: HTMLElement): boolean {
  const name = `${el.id} ${typeof el.className === "string" ? el.className : ""}`;
  return /(^|[\s_-])(slide|page)([\s_-]|$)|slide|page/i.test(name);
}

/**
 * `.slide-wrap > .slide` のように、検出したスライドが一対一の反復ラッパーに
 * 入っている場合は外側をページルートにする。
 *
 * 内側だけを非表示にすると、外側の高さ・余白が残って2枚目以降が iframe の
 * 表示領域外へ押し出される。全候補が別々の兄弟ラッパーに一対一で入っている
 * 場合だけ昇格するため、単なる共通コンテナまでは巻き込まない。
 */
function promotePageRoots(slides: HTMLElement[]): {
  roots: HTMLElement[];
  label: string | null;
} {
  if (slides.length < 2) return { roots: slides, label: null };

  let roots = slides.slice();
  let promoted: HTMLElement[] | null = null;

  while (true) {
    const parents = roots.map((el) => el.parentElement);
    if (parents.some((el) => !el || el.tagName === "BODY" || el.tagName === "HTML")) break;

    const wrappers = parents as HTMLElement[];
    if (new Set(wrappers).size !== slides.length) break;
    const commonParent = wrappers[0].parentElement;
    if (!commonParent || !wrappers.every((el) => el.parentElement === commonParent)) break;

    // 各ラッパーが元候補をちょうど1つだけ含むことが昇格の必須条件。
    if (!wrappers.every((wrapper) => slides.filter((slide) => wrapper.contains(slide)).length === 1)) {
      break;
    }

    // 明示的な slide/page 系ラッパー、または子要素が候補1つだけの薄いラッパーを許可。
    const wrapperLike = wrappers.every(
      (wrapper) => hasPageWrapperName(wrapper) || elementChildren(wrapper).length === 1
    );
    if (!wrapperLike) break;

    promoted = wrappers;
    roots = wrappers;
  }

  if (!promoted) return { roots: slides, label: null };
  const first = promoted[0];
  const cls = Array.from(first.classList).find((name) => /slide|page/i.test(name));
  const label = cls ? `.${cls}` : first.tagName.toLowerCase();
  return { roots: promoted, label };
}

function result(
  stateTargets: HTMLElement[],
  method: string,
  confident: boolean
): SlideDetection {
  const promoted = promotePageRoots(stateTargets);
  return {
    slides: promoted.roots,
    stateTargets,
    method: promoted.label ? `${method} → 外側 ${promoted.label}` : method,
    confident,
  };
}

export function detectSlides(doc: Document): SlideDetection {
  const body = doc.body;
  if (!body) {
    return { slides: [], stateTargets: [], method: "body なし", confident: false };
  }

  // 1. `.slide` クラス（AI 生成スライドの定番）
  const byClass = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>(".slide")).filter(isElement)
  );
  if (byClass.length >= 1) {
    return result(byClass, ".slide クラス", true);
  }

  // 2. トップレベルの <section> が 2 つ以上（reveal.js 等）
  const sections = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>("section")).filter(isElement)
  );
  if (sections.length >= 2) {
    return result(sections, "<section> 要素", true);
  }

  // 3. クラス名に slide / page を含む要素
  const byName = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>("[class]")).filter(
      (el) => isElement(el) && /(^|[\s_-])(slide|page)($|[\s_-])|slide|page/i.test(el.className)
    )
  );
  if (byName.length >= 2) {
    return result(byName, "クラス名（slide / page）", true);
  }

  // 4. 同じ構造の兄弟要素グループ（body から 3 階層まで探索）
  let best: HTMLElement[] = [];
  const queue: Array<{ el: Element; depth: number }> = [{ el: body, depth: 0 }];
  while (queue.length > 0) {
    const { el, depth } = queue.shift()!;
    const children = elementChildren(el);
    const groups = new Map<string, HTMLElement[]>();
    for (const child of children) {
      const sig = classSignature(child);
      const group = groups.get(sig) ?? [];
      group.push(child);
      groups.set(sig, group);
    }
    for (const group of groups.values()) {
      if (group.length >= 2 && group.length > best.length) best = group;
    }
    if (depth < 3) {
      for (const child of children) queue.push({ el: child, depth: depth + 1 });
    }
  }
  if (best.length >= 2) {
    return result(best, "同じ構造の兄弟要素", false);
  }

  // 5. フォールバック: body 直下の要素、それも無ければ body 全体を 1 枚のスライドとして扱う
  const bodyChildren = elementChildren(body).filter((el) => {
    // 表示に寄与しない小さな要素は除外しない（面積は測れない環境もあるため構造のみで判断）
    return true;
  });
  if (bodyChildren.length >= 1) {
    return result(bodyChildren, "body 直下の要素", bodyChildren.length === 1);
  }
  return result([body as HTMLElement], "body 全体", false);
}
