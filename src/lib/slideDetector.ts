// 読み込んだ HTML からスライド要素群を検出するヒューリスティック

export interface SlideDetection {
  slides: HTMLElement[];
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

export function detectSlides(doc: Document): SlideDetection {
  const body = doc.body;
  if (!body) return { slides: [], method: "body なし", confident: false };

  // 1. `.slide` クラス（AI 生成スライドの定番）
  const byClass = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>(".slide")).filter(isElement)
  );
  if (byClass.length >= 1) {
    return { slides: byClass, method: ".slide クラス", confident: true };
  }

  // 2. トップレベルの <section> が 2 つ以上（reveal.js 等）
  const sections = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>("section")).filter(isElement)
  );
  if (sections.length >= 2) {
    return { slides: sections, method: "<section> 要素", confident: true };
  }

  // 3. クラス名に slide / page を含む要素
  const byName = topLevelOnly(
    Array.from(doc.querySelectorAll<HTMLElement>("[class]")).filter(
      (el) => isElement(el) && /(^|[\s_-])(slide|page)($|[\s_-])|slide|page/i.test(el.className)
    )
  );
  if (byName.length >= 2) {
    return { slides: byName, method: "クラス名（slide / page）", confident: true };
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
    return { slides: best, method: "同じ構造の兄弟要素", confident: false };
  }

  // 5. フォールバック: body 直下の要素、それも無ければ body 全体を 1 枚のスライドとして扱う
  const bodyChildren = elementChildren(body).filter((el) => {
    // 表示に寄与しない小さな要素は除外しない（面積は測れない環境もあるため構造のみで判断）
    return true;
  });
  if (bodyChildren.length >= 1) {
    return { slides: bodyChildren, method: "body 直下の要素", confident: bodyChildren.length === 1 };
  }
  return { slides: [body as HTMLElement], method: "body 全体", confident: false };
}
