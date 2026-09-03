import { describe, expect, it, vi } from "vitest";
import { EditorEngine } from "./engine";
import { inferSlideDisplays, markSlides } from "./editorDoc";
import { detectSlides } from "./slideDetector";

function buildEngine(): { engine: EditorEngine; doc: Document } {
  const doc = new DOMParser().parseFromString(
    `<main class="deck">
      <div class="slide-wrap" id="one"><section class="slide">one</section></div>
      <div class="slide-wrap" id="two"><section class="slide">two</section></div>
      <div class="slide-wrap" id="three"><section class="slide">three</section></div>
    </main>`,
    "text/html"
  );
  const detected = detectSlides(doc);
  const engine = new EditorEngine();
  engine.doc = doc;
  engine.loaded = true;
  engine.fileName = "test.html";
  engine.slides = detected.slides;
  engine.stateTargets = detected.stateTargets;
  engine.slideDisplays = inferSlideDisplays(doc, engine.slides, engine.stateTargets);
  engine.stateTargetDisplays = inferSlideDisplays(doc, engine.stateTargets);
  markSlides(doc, engine.slides, engine.stateTargets);
  engine.history.reset(engine.serialize());
  return { engine, doc };
}

describe("EditorEngine — ラッパー単位のスライド操作", () => {
  it("複製と削除で空ラッパーや入れ子を作らない", () => {
    const { engine, doc } = buildEngine();
    engine.duplicateSlide(0);
    expect(engine.slides).toHaveLength(4);
    expect(engine.stateTargets).toHaveLength(4);
    expect(doc.querySelectorAll(".slide-wrap")).toHaveLength(4);
    expect(
      Array.from(doc.querySelectorAll(".slide-wrap")).every(
        (wrapper) => wrapper.querySelectorAll(":scope > .slide").length === 1
      )
    ).toBe(true);

    engine.deleteSlide(1);
    expect(engine.slides).toHaveLength(3);
    expect(doc.querySelectorAll(".slide-wrap")).toHaveLength(3);
  });

  it("並べ替えは内容だけでなくページルート全体を移動する", () => {
    const { engine, doc } = buildEngine();
    engine.moveSlide(1, -1);
    const order = Array.from(doc.querySelectorAll<HTMLElement>(".slide-wrap")).map(
      (el) => el.id
    );
    expect(order).toEqual(["two", "one", "three"]);
    expect(engine.stateTargets.map((el) => el.textContent?.trim())).toEqual([
      "two",
      "one",
      "three",
    ]);
  });
});

function mockRect(
  el: Element,
  { left, top, width, height }: { left: number; top: number; width: number; height: number }
): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("EditorEngine — 複数要素の整列基準", () => {
  it.each([
    ["left", "-120px 0px"],
    ["hcenter", "-135px 0px"],
    ["right", "-150px 0px"],
    ["top", "0px -100px"],
    ["vcenter", "0px -105px"],
    ["bottom", "0px -110px"],
  ] as const)("%s は最初に選択した要素の位置へ揃える", (command, expected) => {
    const { engine, doc } = buildEngine();
    const slide = engine.activeSlide()!;
    const anchor = doc.createElement("div");
    const follower = doc.createElement("div");
    slide.append(anchor, follower);
    mockRect(anchor, { left: 100, top: 80, width: 50, height: 30 });
    mockRect(follower, { left: 220, top: 180, width: 80, height: 40 });

    engine.select(anchor);
    engine.toggleSelect(follower);
    engine.alignSelection(command);

    expect(anchor.style.translate).toBe("");
    expect(follower.style.translate).toBe(expected);
    expect(engine.selection).toEqual([anchor, follower]);
  });
});

describe("EditorEngine — 要素のコピー＆ペースト", () => {
  it("同じスライドでは少しずらし、別スライドでは同じ位置へ貼り付ける", () => {
    const { engine, doc } = buildEngine();
    const sourceSlide = engine.activeSlide()!;
    const source = doc.createElement("div");
    const sourceChild = doc.createElement("span");
    const style = doc.createElement("style");
    style.textContent = `
      .copied-card { color: rgb(12, 34, 56); background-color: rgb(240, 220, 80); font-size: 32px; }
      .copied-card > span { color: rgb(210, 20, 40); font-size: 18px; font-weight: 700; }
    `;
    doc.head.append(style);
    source.className = "copied-card";
    source.textContent = "copy me";
    sourceChild.textContent = "child";
    source.append(sourceChild);
    source.style.translate = "20px 10px";
    sourceSlide.append(source);
    const sourceComputed = doc.createElement("div").style;
    sourceComputed.color = "rgb(12, 34, 56)";
    sourceComputed.backgroundColor = "rgb(240, 220, 80)";
    sourceComputed.fontSize = "32px";
    sourceComputed.width = "80px";
    sourceComputed.height = "40px";
    sourceComputed.boxSizing = "border-box";
    const childComputed = doc.createElement("span").style;
    childComputed.color = "rgb(210, 20, 40)";
    childComputed.fontSize = "18px";
    childComputed.fontWeight = "700";
    vi.spyOn(engine, "getComputed").mockImplementation((el) => {
      if (el === source) return sourceComputed;
      if (el === sourceChild) return childComputed;
      return null;
    });
    mockRect(sourceSlide, { left: 20, top: 30, width: 1122, height: 793 });
    mockRect(source, { left: 120, top: 110, width: 80, height: 40 });
    engine.select(source);

    expect(engine.copySelection()).toBe(true);
    expect(engine.pasteClipboard()).toBe(true);
    const sameSlideCopy = engine.selected as HTMLElement;
    expect(sameSlideCopy).not.toBe(source);
    expect(sameSlideCopy.style.left).toBe("112px");
    expect(sameSlideCopy.style.top).toBe("92px");
    expect(sameSlideCopy.style.translate).toBe("");

    engine.setCurrent(1);
    const destinationSlide = engine.activeSlide()!;
    mockRect(destinationSlide, { left: 40, top: 50, width: 1122, height: 793 });
    expect(engine.pasteClipboard()).toBe(true);
    const crossSlideCopy = engine.selected as HTMLElement;
    expect(crossSlideCopy.firstChild?.textContent).toBe("copy me");
    expect(crossSlideCopy.style.left).toBe("100px");
    expect(crossSlideCopy.style.top).toBe("80px");
    expect(crossSlideCopy.style.width).toBe("80px");
    expect(crossSlideCopy.style.height).toBe("40px");
    expect(crossSlideCopy.style.color).toBe("rgb(12, 34, 56)");
    expect(crossSlideCopy.style.backgroundColor).toBe("rgb(240, 220, 80)");
    expect(crossSlideCopy.style.fontSize).toBe("32px");
    const copiedChild = crossSlideCopy.querySelector("span") as HTMLElement;
    expect(copiedChild.style.color).toBe("rgb(210, 20, 40)");
    expect(copiedChild.style.fontSize).toBe("18px");
    expect(copiedChild.style.fontWeight).toBe("700");
  });
});
