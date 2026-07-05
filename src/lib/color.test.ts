import { describe, it, expect } from "vitest";
import {
  normalizeColor,
  parseColorTokens,
  replaceColorInValue,
  colorDistance,
} from "./color";

describe("normalizeColor", () => {
  it("各種 hex 表記を正規化する", () => {
    expect(normalizeColor("#FFF")).toEqual({ hex: "#ffffff", alpha: 1 });
    expect(normalizeColor("#1C4E80")).toEqual({ hex: "#1c4e80", alpha: 1 });
    expect(normalizeColor("#00000080")?.alpha).toBeCloseTo(0.5, 1);
  });

  it("rgb / rgba を正規化する", () => {
    expect(normalizeColor("rgb(255, 0, 0)")).toEqual({ hex: "#ff0000", alpha: 1 });
    expect(normalizeColor("rgba(28, 78, 128, 0.5)")).toEqual({ hex: "#1c4e80", alpha: 0.5 });
    expect(normalizeColor("rgb(255 0 0 / 0.3)")?.alpha).toBeCloseTo(0.3);
  });

  it("hsl を正規化する", () => {
    expect(normalizeColor("hsl(0, 100%, 50%)")).toEqual({ hex: "#ff0000", alpha: 1 });
    expect(normalizeColor("hsl(120, 100%, 25%)")?.hex).toBe("#008000");
  });

  it("名前付きカラーと transparent を扱う", () => {
    expect(normalizeColor("white")).toEqual({ hex: "#ffffff", alpha: 1 });
    expect(normalizeColor("transparent")?.alpha).toBe(0);
  });

  it("色でない文字列は null", () => {
    expect(normalizeColor("bold")).toBeNull();
    expect(normalizeColor("12px")).toBeNull();
  });
});

describe("parseColorTokens", () => {
  it("グラデーション内の複数色を検出する", () => {
    const tokens = parseColorTokens("linear-gradient(135deg, #1C4E80 0%, rgba(255,92,56,.8) 100%)");
    expect(tokens.map((t) => t.hex)).toEqual(["#1c4e80", "#ff5c38"]);
    expect(tokens[1].alpha).toBeCloseTo(0.8);
  });

  it("url() の中身は無視する", () => {
    const tokens = parseColorTokens("url(https://example.com/red.png) #fff");
    expect(tokens.map((t) => t.hex)).toEqual(["#ffffff"]);
  });

  it("色でない単語は拾わない", () => {
    expect(parseColorTokens("1px solid #333")).toHaveLength(1);
    expect(parseColorTokens("bold 14px sans-serif")).toHaveLength(0);
  });
});

describe("replaceColorInValue", () => {
  it("一致する色だけを置換する", () => {
    expect(replaceColorInValue("1px solid #1c4e80", "#1c4e80", "#e63946")).toBe("1px solid #e63946");
    expect(replaceColorInValue("1px solid #1c4e80", "#ffffff", "#e63946")).toBeNull();
  });

  it("表記ゆれ（rgb / 大文字 hex）も同一色として置換する", () => {
    expect(replaceColorInValue("rgb(28, 78, 128)", "#1c4e80", "#e63946")).toBe("#e63946");
    expect(replaceColorInValue("#1C4E80", "#1c4e80", "#e63946")).toBe("#e63946");
  });

  it("半透明トークンはアルファを保って置換する", () => {
    expect(replaceColorInValue("rgba(28, 78, 128, 0.5)", "#1c4e80", "#e63946")).toBe(
      "rgba(230, 57, 70, 0.5)"
    );
  });

  it("グラデーション内の対象色のみ置換する", () => {
    const v = "linear-gradient(90deg, #1c4e80, #ffffff)";
    expect(replaceColorInValue(v, "#1c4e80", "#e63946")).toBe(
      "linear-gradient(90deg, #e63946, #ffffff)"
    );
  });
});

describe("colorDistance", () => {
  it("同一色は距離 0、白黒は最大距離", () => {
    expect(colorDistance("#123456", "#123456")).toBe(0);
    expect(colorDistance("#000000", "#ffffff")).toBeCloseTo(441.67, 1);
  });
});
