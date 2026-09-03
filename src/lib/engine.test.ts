import { describe, expect, it } from "vitest";
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
