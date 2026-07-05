import { describe, it, expect } from "vitest";
import {
  detectStateClass,
  setActiveSlide,
  serializeDocument,
  markSlides,
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
