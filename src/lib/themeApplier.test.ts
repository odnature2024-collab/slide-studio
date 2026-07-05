import { describe, it, expect } from "vitest";
import { replaceColorsInCssText } from "./themeApplier";

describe("replaceColorsInCssText", () => {
  it("宣言ブロック内の色だけを置換する", () => {
    const css = `.card { color: #1c4e80; border: 1px solid #1c4e80; } .other { color: #fff; }`;
    const result = replaceColorsInCssText(css, ["#1c4e80"], "#e63946");
    expect(result.text).toBe(
      `.card { color: #e63946; border: 1px solid #e63946; } .other { color: #fff; }`
    );
    expect(result.changed).toBe(1);
  });

  it("var() を含むショートハンドをそのまま保持する（CSSOM 再生成の退行防止）", () => {
    const css = `.slide.active .a{animation:rise .75s var(--ease) both;animation-delay:calc(140ms + var(--i,0)*95ms)}
.kick{color:#0b57d0}`;
    const result = replaceColorsInCssText(css, ["#0b57d0"], "#14532d");
    expect(result.text).toContain("animation:rise .75s var(--ease) both");
    expect(result.text).toContain("animation-delay:calc(140ms + var(--i,0)*95ms)");
    expect(result.text).toContain("color:#14532d");
  });

  it("色名と同じクラス名のセレクタには触れない", () => {
    const css = `.white { background: white; } .box { color: white; }`;
    const result = replaceColorsInCssText(css, ["#ffffff"], "#111111");
    expect(result.text).toBe(`.white { background: #111111; } .box { color: #111111; }`);
  });

  it("@media や @keyframes の中も置換できる", () => {
    const css = `@media (min-width: 600px) { .a { color: #1c4e80; } }
@keyframes glow { from { background: #1c4e80; } to { background: #fff; } }`;
    const result = replaceColorsInCssText(css, ["#1c4e80"], "#e63946");
    expect(result.text).toContain(".a { color: #e63946; }");
    expect(result.text).toContain("from { background: #e63946; }");
    expect(result.text).toContain("@keyframes glow");
  });

  it("一致しない場合はテキストを変えない", () => {
    const css = `.a { color: #123456; }`;
    const result = replaceColorsInCssText(css, ["#999999"], "#000000");
    expect(result.text).toBe(css);
    expect(result.changed).toBe(0);
  });
});
