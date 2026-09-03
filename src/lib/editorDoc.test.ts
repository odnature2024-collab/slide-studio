import { describe, it, expect } from "vitest";
import {
  detectStateClass,
  inferSlideDisplays,
  injectSlideDisplayStyles,
  setActiveSlide,
  serializeDocument,
  markSlides,
  onlySlideCss,
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

describe("ページ表示の互換処理", () => {
  it("inline display:none のページは表示中ページの display から補完する", () => {
    const host = document.createElement("div");
    host.innerHTML = `<main>
      <div class="slide" style="display:flex">1</div>
      <div class="slide" style="display:none">2</div>
      <div class="slide" style="display:none">3</div>
    </main>`;
    document.body.appendChild(host);
    const slides = Array.from(host.querySelectorAll<HTMLElement>(".slide"));
    expect(inferSlideDisplays(document, slides)).toEqual(["flex", "flex", "flex"]);
    expect(onlySlideCss(1, { activeDisplay: "flex" })).toContain("display: flex !important");
    host.remove();
  });

  it("直接配置の非表示ページは状態対象の補正で再表示されない", () => {
    const host = document.createElement("div");
    host.innerHTML = `<main>
      <div class="slide" style="display:flex">1</div>
      <div class="slide" style="display:none">2</div>
    </main>`;
    document.body.appendChild(host);
    const slides = Array.from(host.querySelectorAll<HTMLElement>(".slide"));
    markSlides(document, slides, slides);
    const displays = inferSlideDisplays(document, slides);
    injectSlideDisplayStyles(document, displays, displays);
    setActiveSlide(slides, 0);
    expect(getComputedStyle(slides[0]).display).toBe("flex");
    expect(getComputedStyle(slides[1]).display).toBe("none");
    document.getElementById("hse-slide-display-style")?.remove();
    host.remove();
  });

  it("ラッパーと内側の状態クラス対象を別々に切り替える", () => {
    const doc = buildDoc(`<style>.slide{display:none}.slide.current{display:grid}</style><main>
      <div class="slide-wrap"><section class="slide current">1</section></div>
      <div class="slide-wrap"><section class="slide">2</section></div>
    </main>`);
    const roots = Array.from(doc.querySelectorAll<HTMLElement>(".slide-wrap"));
    const targets = slidesOf(doc);
    const state = detectStateClass(doc, targets)!;
    markSlides(doc, roots, targets);
    setActiveSlide(roots, 1, state, targets);
    expect(roots.map((el) => el.hasAttribute("data-hse-hidden"))).toEqual([true, false]);
    expect(targets.map((el) => el.classList.contains("current"))).toEqual([false, true]);
  });

  it("ラッパー内側の inline display:none も表示用CSSで補正する", () => {
    const host = document.createElement("div");
    host.innerHTML = `<main>
      <div class="slide-wrap"><section class="slide" style="display:grid">1</section></div>
      <div class="slide-wrap"><section class="slide" style="display:none">2</section></div>
    </main>`;
    document.body.appendChild(host);
    const roots = Array.from(host.querySelectorAll<HTMLElement>(".slide-wrap"));
    const targets = Array.from(host.querySelectorAll<HTMLElement>(".slide"));
    markSlides(document, roots, targets);
    const rootDisplays = inferSlideDisplays(document, roots, targets);
    const targetDisplays = inferSlideDisplays(document, targets);
    expect(targetDisplays).toEqual(["grid", "grid"]);
    expect(
      onlySlideCss(1, {
        activeDisplay: rootDisplays[1],
        activeTargetDisplay: targetDisplays[1],
      })
    ).toContain('[data-hse-state-target="1"] { display: grid !important');
    host.remove();
  });
});

describe("ページ別シリアライズ", () => {
  it("非対象ページの本文・Base64・スクリプトを除き、兄弟の殻を残す", () => {
    const doc = buildDoc(`<!DOCTYPE html><html><head><style>.slide-wrap{display:block}</style></head><body>
      <main class="deck">
        <div class="slide-wrap" id="slide-1"><section class="slide"><img src="data:image/png;base64,AAA">one</section></div>
        <div class="slide-wrap" id="slide-2"><section class="slide"><img src="data:image/png;base64,BBB">two</section></div>
        <div class="slide-wrap" id="slide-3"><section class="slide"><img src="data:image/png;base64,CCC">three</section></div>
      </main><script>window.largePayload = "SHOULD_NOT_RUN"</script>
    </body></html>`);
    const roots = Array.from(doc.querySelectorAll<HTMLElement>(".slide-wrap"));
    const targets = slidesOf(doc);
    markSlides(doc, roots, targets);

    const html = serializeDocument(doc, {
      keepSlideMarks: true,
      stateMode: "single",
      activeIndex: 1,
      pruneToSlide: 1,
    });
    const preview = buildDoc(html);
    const previewRoots = Array.from(preview.querySelectorAll<HTMLElement>(`[${SLIDE_ATTR}]`));
    expect(previewRoots).toHaveLength(3);
    expect(previewRoots[0].children).toHaveLength(0);
    expect(previewRoots[1].textContent).toContain("two");
    expect(previewRoots[2].children).toHaveLength(0);
    expect(html).not.toContain("base64,AAA");
    expect(html).toContain("base64,BBB");
    expect(html).not.toContain("base64,CCC");
    expect(html).not.toContain("SHOULD_NOT_RUN");
    expect(previewRoots.map((el) => el.id)).toEqual(["slide-1", "slide-2", "slide-3"]);
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
