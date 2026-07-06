import { describe, it, expect } from "vitest";
import {
  detectStateClass,
  setActiveSlide,
  serializeDocument,
  markSlides,
  syncCounterAttributes,
  SLIDE_ATTR,
} from "./editorDoc";

function buildDoc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function slidesOf(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(".slide"));
}

const JS_DECK = `<!DOCTYPE html><html><head><style>
.slide{opacity:0;visibility:hidden}
.slide.active{opacity:1;visibility:visible}
</style></head><body>
<div class="slide cover active">1</div>
<div class="slide">2</div>
<div class="slide">3</div>
</body></html>`;

describe("detectStateClass", () => {
  it("一部のスライドだけが持つ active クラスを検出する", () => {
    const doc = buildDoc(JS_DECK);
    const state = detectStateClass(doc, slidesOf(doc));
    expect(state).toEqual({ className: "active", originalHolders: [0] });
  });

  it("どのスライドも持っていなくても CSS から検出する", () => {
    const doc = buildDoc(`<!DOCTYPE html><html><head><style>
      .slide{display:none} .slide.current{display:flex}
    </style></head><body>
      <div class="slide">1</div><div class="slide">2</div>
    </body></html>`);
    const state = detectStateClass(doc, slidesOf(doc));
    expect(state).toEqual({ className: "current", originalHolders: [] });
  });

  it("状態クラスを使わないデッキでは null", () => {
    const doc = buildDoc(`<!DOCTYPE html><html><body>
      <div class="slide">1</div><div class="slide">2</div>
    </body></html>`);
    expect(detectStateClass(doc, slidesOf(doc))).toBeNull();
  });
});

describe("setActiveSlide + serializeDocument の状態クラス処理", () => {
  it("編集中は表示スライドにだけ状態クラスが付く", () => {
    const doc = buildDoc(JS_DECK);
    const slides = slidesOf(doc);
    const state = detectStateClass(doc, slides)!;
    markSlides(doc, slides);
    setActiveSlide(slides, 2, state);
    expect(slides.map((s) => s.classList.contains("active"))).toEqual([false, false, true]);
  });

  it("保存時（stateMode: original）は読み込み時のスライドへ復元される", () => {
    const doc = buildDoc(JS_DECK);
    const slides = slidesOf(doc);
    const state = detectStateClass(doc, slides)!;
    markSlides(doc, slides);
    setActiveSlide(slides, 2, state);
    const html = serializeDocument(doc, { stateClass: state, stateMode: "original" });
    expect(html).not.toContain("data-hse-");
    const saved = buildDoc(html);
    expect(slidesOf(saved).map((s) => s.classList.contains("active"))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("プレビュー用（stateMode: all）は全スライドに状態クラスが付き、連番マークが残る", () => {
    const doc = buildDoc(JS_DECK);
    const slides = slidesOf(doc);
    const state = detectStateClass(doc, slides)!;
    markSlides(doc, slides);
    setActiveSlide(slides, 1, state);
    const html = serializeDocument(doc, {
      keepSlideMarks: true,
      stateClass: state,
      stateMode: "all",
    });
    const preview = buildDoc(html);
    const previewSlides = slidesOf(preview);
    expect(previewSlides.every((s) => s.classList.contains("active"))).toBe(true);
    expect(previewSlides.every((s) => s.hasAttribute(SLIDE_ATTR))).toBe(true);
  });
});

describe("syncCounterAttributes", () => {
  it("編集した要素自身の data-target をテキストの数値に同期する", () => {
    const doc = buildDoc(`<div class="slide"><span data-target="500">1,842</span></div>`);
    const span = doc.querySelector("span")!;
    syncCounterAttributes(span, doc.querySelector(".slide"));
    expect(span.getAttribute("data-target")).toBe("1842");
  });

  it("子孫のカウンター属性も同期する（%やカンマ付きテキスト）", () => {
    const doc = buildDoc(
      `<div class="slide"><div class="stat"><span class="n" data-count="80">96</span>%</div></div>`
    );
    const stat = doc.querySelector<HTMLElement>(".stat")!;
    syncCounterAttributes(stat, doc.querySelector(".slide"));
    expect(doc.querySelector(".n")!.getAttribute("data-count")).toBe("96");
  });

  it("親（スライドまで）のカウンター属性も同期する", () => {
    const doc = buildDoc(
      `<div class="slide"><div class="stat" data-value="10">実績 <span class="n">42</span> 件</div></div>`
    );
    const span = doc.querySelector<HTMLElement>(".n")!;
    syncCounterAttributes(span, doc.querySelector(".slide"));
    expect(doc.querySelector(".stat")!.getAttribute("data-value")).toBe("42");
  });

  it("数値でない data 属性やスライド自身の属性は変更しない", () => {
    const doc = buildDoc(
      `<div class="slide" data-target="99"><span data-value="hello" data-duration="2000">42</span></div>`
    );
    const span = doc.querySelector("span")!;
    syncCounterAttributes(span, doc.querySelector(".slide"));
    expect(span.getAttribute("data-value")).toBe("hello");
    expect(span.getAttribute("data-duration")).toBe("2000");
    expect(doc.querySelector(".slide")!.getAttribute("data-target")).toBe("99");
  });
});
