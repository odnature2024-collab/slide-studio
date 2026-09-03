import { describe, expect, it } from "vitest";
import { detectSlides } from "./slideDetector";

function buildDoc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("detectSlides — ページルートの正規化", () => {
  it("直下の .slide はそのままページルートにする", () => {
    const doc = buildDoc(`<main><section class="slide">1</section><section class="slide">2</section></main>`);
    const result = detectSlides(doc);
    expect(result.slides.map((el) => el.tagName)).toEqual(["SECTION", "SECTION"]);
    expect(result.slides).toEqual(result.stateTargets);
    expect(result.method).toBe(".slide クラス");
  });

  it(".slide-wrap > .slide は外側ラッパーをページルートにする", () => {
    const doc = buildDoc(`<main class="deck">
      <div class="slide-wrap" id="slide-1"><section class="slide">1</section></div>
      <div class="slide-wrap" id="slide-2"><section class="slide">2</section></div>
      <div class="slide-wrap" id="slide-3"><section class="slide">3</section></div>
    </main>`);
    const result = detectSlides(doc);
    expect(result.slides.map((el) => el.id)).toEqual(["slide-1", "slide-2", "slide-3"]);
    expect(result.stateTargets.map((el) => el.textContent)).toEqual(["1", "2", "3"]);
    expect(result.method).toContain("外側 .slide-wrap");
  });

  it("名前のない一対一の薄いラッパーも昇格する", () => {
    const doc = buildDoc(`<main>
      <div><section class="slide">1</section></div>
      <div><section class="slide">2</section></div>
    </main>`);
    const result = detectSlides(doc);
    expect(result.slides.every((el) => el.tagName === "DIV")).toBe(true);
    expect(result.stateTargets.every((el) => el.tagName === "SECTION")).toBe(true);
  });

  it("補助要素を含む名前のない親はページルートへ昇格しない", () => {
    const doc = buildDoc(`<main>
      <div><section class="slide">1</section><aside>note</aside></div>
      <div><section class="slide">2</section><aside>note</aside></div>
    </main>`);
    const result = detectSlides(doc);
    expect(result.slides.every((el) => el.tagName === "SECTION")).toBe(true);
  });

  it("section と page の既存検出を維持する", () => {
    const sections = detectSlides(buildDoc(`<main><section>1</section><section>2</section></main>`));
    expect(sections.slides).toHaveLength(2);
    expect(sections.method).toContain("<section>");

    const pages = detectSlides(buildDoc(`<main><article class="page">1</article><article class="page">2</article></main>`));
    expect(pages.slides).toHaveLength(2);
    expect(pages.method).toContain("slide / page");
  });
});
