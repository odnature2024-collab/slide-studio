// 右パネル：選択中の要素の個別編集（色・フォント・配置・画像）

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignCommand, EditorEngine } from "../lib/engine";
import { normalizeColor } from "../lib/color";
import {
  FONT_CATALOG,
  FONT_GROUP_LABELS,
  FONT_GROUP_ORDER,
  extractUsedFonts,
} from "../lib/fonts";
import ColorField from "./ColorField";
import SmoothSlider from "./SmoothSlider";

interface Props {
  engine: EditorEngine;
  version: number;
  palette: string[];
}

/** computed の色文字列を #rrggbb に。透明なら null */
function toHex(cssColor: string | undefined): string | null {
  if (!cssColor) return null;
  const norm = normalizeColor(cssColor);
  if (!norm || norm.alpha === 0) return null;
  return norm.hex;
}

/** 整列ボタンの定義（基準線＋2つのボックスを描いたアイコン） */
const ALIGN_BUTTONS: Array<{ cmd: AlignCommand; title: string; d: string }> = [
  { cmd: "left", title: "左揃え", d: "M4 3v18M8 6h11v4H8zM8 14h7v4H8z" },
  { cmd: "hcenter", title: "左右中央揃え", d: "M12 3v18M6 6h12v4H6zM8 14h8v4H8z" },
  { cmd: "right", title: "右揃え", d: "M20 3v18M5 6h11v4H5zM9 14h7v4H9z" },
  { cmd: "top", title: "上揃え", d: "M3 4h18M6 8h4v11H6zM14 8h4v7h-4z" },
  { cmd: "vcenter", title: "上下中央揃え", d: "M3 12h18M6 6h4v12H6zM14 8h4v8h-4z" },
  { cmd: "bottom", title: "下揃え", d: "M3 20h18M6 5h4v11H6zM14 9h4v7h-4z" },
];

function AlignButtons({
  onAlign,
  titleSuffix,
}: {
  onAlign: (cmd: AlignCommand) => void;
  titleSuffix: string;
}) {
  return (
    <>
      {ALIGN_BUTTONS.map(({ cmd, title, d }) => (
        <button
          key={cmd}
          className="icon-toggle"
          title={`${title}${titleSuffix}`}
          onClick={() => onAlign(cmd)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d={d} />
          </svg>
        </button>
      ))}
    </>
  );
}

export default function PropertyPanel({ engine, version, palette }: Props) {
  const el = engine.selected;
  const isShape = el?.tagName.toLowerCase() === "svg";
  // 図形（SVG）の塗り・線の対象要素（fill/stroke 属性を持つ子）
  const shapeFillEls = isShape
    ? Array.from(el!.querySelectorAll("[fill]")).filter((n) => n.getAttribute("fill") !== "none")
    : [];
  const shapeStrokeEls = isShape
    ? Array.from(el!.querySelectorAll("[stroke]")).filter(
        (n) => n.getAttribute("stroke") !== "none"
      )
    : [];
  const shapeRect = isShape ? el!.querySelector("rect") : null;
  const shapeHasRect = shapeRect != null;
  const shapeRectRadius = shapeRect ? Math.round(parseFloat(shapeRect.getAttribute("rx") || "0")) : 0;
  const computed = el ? engine.getComputed(el) : null;
  const isSlide = el === engine.activeSlide();
  const isImage = el?.tagName === "IMG";
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // 使用中フォントの一覧（選択が変わったときに再抽出すれば十分）
  const usedFonts = useMemo(() => {
    void version;
    return engine.doc ? extractUsedFonts(engine.doc) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, el]);

  const [fontSize, setFontSize] = useState(16);
  useEffect(() => {
    if (computed) setFontSize(Math.round(parseFloat(computed.fontSize) || 16));
    // 選択の変更時と、確定編集（リサイズによる文字スケール等）の後に同期する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, version]);

  if (!el || !computed) {
    return (
      <div className="placeholder">
        スライド上の要素をクリックすると
        <br />
        ここで細かく編集できます。
        <br />
        <br />
        ダブルクリックで文字を直接編集、
        <br />
        ドラッグで移動できます。
      </div>
    );
  }

  // 複数選択中は整列・削除に絞った専用パネルを表示する
  if (engine.selection.length >= 2) {
    return (
      <div>
        <div className="section">
          <div className="row">
            <span className="tag-badge">{engine.selection.length}個の要素を選択中</span>
            <span style={{ flex: 1 }} />
            <button className="small-btn danger" onClick={() => engine.deleteSelection()}>
              削除
            </button>
          </div>
        </div>
        <div className="section">
          <div className="section-title">選択した要素をそろえる</div>
          <div className="row">
            <AlignButtons onAlign={(cmd) => engine.alignSelection(cmd)} titleSuffix="（要素同士）" />
          </div>
        </div>
        <div className="section">
          <div className="section-title">スライドに対して整列</div>
          <div className="row">
            <AlignButtons onAlign={(cmd) => engine.alignToSlide(cmd)} titleSuffix="（スライド基準）" />
          </div>
        </div>
        <div className="placeholder" style={{ padding: "6px 0", textAlign: "left" }}>
          Shift+クリックまたは複数選択モードで選択を追加・解除できます。
          選択の内側をドラッグするとまとめて移動します。
        </div>
      </div>
    );
  }

  const textColor = toHex(computed.color);
  const bgColor = toHex(computed.backgroundColor);
  const borderColor = toHex(computed.borderTopColor);
  const borderWidth = Math.round(parseFloat(computed.borderTopWidth) || 0);
  const radius = Math.round(parseFloat(computed.borderTopLeftRadius) || 0);
  const opacity = parseFloat(computed.opacity);
  const currentFontLabel = `フォントを選択…（現在: ${computed.fontFamily
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "")}）`;
  const bold = parseInt(computed.fontWeight, 10) >= 600;
  const italic = computed.fontStyle === "italic";
  const underline = computed.textDecorationLine.includes("underline");
  const align = computed.textAlign;
  const hasShadow = computed.boxShadow !== "none";

  const applyFontSize = (v: number, commit: boolean) => {
    setFontSize(v);
    if (commit) engine.applyStyle("font-size", `${v}px`);
    else engine.applyStyleTransient("font-size", `${v}px`);
  };

  const bringForward = (delta: number) => {
    const z = parseInt(computed.zIndex, 10) || 0;
    if (computed.position === "static") engine.applyStyleTransient("position", "relative");
    engine.applyStyle("z-index", String(z + delta));
  };

  const parent = el.parentElement;
  const active = engine.activeSlide();
  const canSelectParent =
    !isSlide && parent != null && (parent === active || active?.contains(parent) === true);

  return (
    <div>
      <div className="section">
        <div className="row">
          <span className="tag-badge">
            {el.tagName.toLowerCase()}
            {el.classList[0] ? `.${el.classList[0]}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          {canSelectParent && (
            <button className="small-btn" onClick={() => engine.select(parent)}>
              親を選択
            </button>
          )}
          {!isSlide && (
            <button
              className="small-btn danger"
              onClick={() => engine.deleteSelection()}
            >
              削除
            </button>
          )}
        </div>
        {isSlide && (
          <div className="placeholder" style={{ padding: "6px 0", textAlign: "left" }}>
            スライド全体を選択中。背景色などを変更できます。
          </div>
        )}
      </div>

      {isImage && (
        <div className="section">
          <div className="section-title">画像</div>
          <div className="row">
            <button className="small-btn" onClick={() => replaceInputRef.current?.click()}>
              画像を差し替え…
            </button>
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await engine.replaceSelectedImage(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="row">
            <span className="row-label">フィット</span>
            <select
              value={computed.objectFit}
              onChange={(e) => engine.applyStyle("object-fit", e.target.value)}
            >
              <option value="fill">引き伸ばし</option>
              <option value="contain">全体を表示</option>
              <option value="cover">切り抜いて埋める</option>
            </select>
          </div>
        </div>
      )}

      {isShape && (shapeFillEls.length > 0 || shapeStrokeEls.length > 0) && (
        <div className="section">
          <div className="section-title">図形</div>
          {shapeFillEls.length > 0 && (
            <div className="row">
              <span className="row-label">塗り</span>
              <ColorField
                value={toHex(shapeFillEls[0].getAttribute("fill") ?? "")}
                palette={palette}
                onPreview={(hex) => {
                  for (const n of shapeFillEls) n.setAttribute("fill", hex);
                }}
                onChange={(hex) => {
                  for (const n of shapeFillEls) n.setAttribute("fill", hex);
                  engine.markColorsChanged();
                  engine.commit();
                }}
              />
            </div>
          )}
          {shapeStrokeEls.length > 0 && (
            <div className="row">
              <span className="row-label">線の色</span>
              <ColorField
                value={toHex(shapeStrokeEls[0].getAttribute("stroke") ?? "")}
                palette={palette}
                onPreview={(hex) => {
                  for (const n of shapeStrokeEls) n.setAttribute("stroke", hex);
                }}
                onChange={(hex) => {
                  for (const n of shapeStrokeEls) n.setAttribute("stroke", hex);
                  engine.markColorsChanged();
                  engine.commit();
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-title">カラー</div>
        <div className="row">
          <span className="row-label">文字色</span>
          <ColorField
            value={textColor}
            palette={palette}
            onPreview={(hex) => engine.applyStyleTransient("color", hex)}
            onChange={(hex) => engine.applyStyle("color", hex)}
          />
        </div>
        <div className="row">
          <span className="row-label">背景色</span>
          <ColorField
            value={bgColor}
            palette={palette}
            onPreview={(hex) => engine.applyStyleTransient("background-color", hex)}
            onChange={(hex) => engine.applyStyle("background-color", hex)}
            onClear={() => engine.applyStyle("background-color", "transparent")}
          />
        </div>
        <div className="row">
          <span className="row-label">枠線</span>
          <input
            type="number"
            min={0}
            max={40}
            value={borderWidth}
            onChange={(e) => {
              const w = parseInt(e.target.value, 10) || 0;
              if (w > 0 && computed.borderTopStyle === "none") {
                engine.applyStyleTransient("border-style", "solid");
              }
              engine.applyStyle("border-width", `${w}px`);
            }}
            title="枠線の太さ(px)"
          />
          <ColorField
            value={borderColor}
            palette={palette}
            onPreview={(hex) => engine.applyStyleTransient("border-color", hex)}
            onChange={(hex) => {
              if (borderWidth === 0) {
                engine.applyStyleTransient("border-style", "solid");
                engine.applyStyleTransient("border-width", "1px");
              }
              engine.applyStyle("border-color", hex);
            }}
          />
        </div>
      </div>

      {!isImage && (
        <div className="section">
          <div className="section-title">テキスト</div>
          <div className="row">
            <span className="row-label">サイズ</span>
            <SmoothSlider
              min={8}
              max={120}
              value={fontSize}
              onInput={(v) => applyFontSize(v, false)}
              onCommit={() => engine.commit()}
            />
            <input
              type="number"
              min={4}
              max={400}
              value={fontSize}
              onChange={(e) => applyFontSize(parseInt(e.target.value, 10) || 16, true)}
            />
          </div>
          <div className="row">
            <span className="row-label">フォント</span>
            <select
              value=""
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith("u:")) {
                  const used = usedFonts[Number(value.slice(2))];
                  if (used) engine.applyFontFamily(used.family);
                } else if (value.startsWith("c:")) {
                  const font = FONT_CATALOG[Number(value.slice(2))];
                  if (font) engine.applyFontFamily(font.family, font.url);
                }
              }}
              style={{ flex: 1 }}
              title={`現在: ${computed.fontFamily}`}
            >
              <option value="" disabled>
                {currentFontLabel}
              </option>
              {usedFonts.length > 0 && (
                <optgroup label="── スライド内で使用中 ──">
                  {usedFonts.map((f, i) => (
                    <option key={`u${i}`} value={`u:${i}`}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {FONT_GROUP_ORDER.map((group) => (
                <optgroup key={group} label={`── ${FONT_GROUP_LABELS[group]} ──`}>
                  {FONT_CATALOG.map((f, i) =>
                    f.group === group ? (
                      <option key={`c${i}`} value={`c:${i}`}>
                        {f.label}
                      </option>
                    ) : null
                  )}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="row">
            <span className="row-label">スタイル</span>
            <button
              className={`icon-toggle ${bold ? "on" : ""}`}
              style={{ fontWeight: 700 }}
              onClick={() => engine.applyStyle("font-weight", bold ? "400" : "700")}
            >
              B
            </button>
            <button
              className={`icon-toggle ${italic ? "on" : ""}`}
              style={{ fontStyle: "italic" }}
              onClick={() => engine.applyStyle("font-style", italic ? "normal" : "italic")}
            >
              I
            </button>
            <button
              className={`icon-toggle ${underline ? "on" : ""}`}
              style={{ textDecoration: "underline" }}
              onClick={() =>
                engine.applyStyle("text-decoration", underline ? "none" : "underline")
              }
            >
              U
            </button>
            <span style={{ width: 6 }} />
            {(
              [
                ["left", "⬅"],
                ["center", "↔"],
                ["right", "➡"],
              ] as const
            ).map(([value, icon]) => (
              <button
                key={value}
                className={`icon-toggle ${align === value ? "on" : ""}`}
                title={`${value === "left" ? "左" : value === "center" ? "中央" : "右"}揃え`}
                onClick={() => engine.applyStyle("text-align", value)}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">見た目</div>
        <div className="row">
          <span className="row-label">不透明度</span>
          <SmoothSlider
            min={5}
            max={100}
            value={Math.round(opacity * 100)}
            onInput={(v) => engine.applyStyleTransient("opacity", String(v / 100))}
            onCommit={() => engine.commit()}
          />
        </div>
        {(!isShape || shapeHasRect) && (
          <div className="row">
            <span className="row-label">角丸</span>
            <SmoothSlider
              min={0}
              max={isShape ? 50 : 80}
              value={isShape ? shapeRectRadius : radius}
              onInput={(v) =>
                isShape
                  ? engine.setShapeRadius(v)
                  : engine.applyStyleTransient("border-radius", `${v}px`)
              }
              onCommit={() => engine.commit()}
            />
          </div>
        )}
        <div className="row">
          <span className="row-label">影</span>
          <button
            className={`icon-toggle ${hasShadow ? "on" : ""}`}
            style={{ width: "auto", padding: "0 10px" }}
            onClick={() =>
              engine.applyStyle(
                "box-shadow",
                hasShadow ? "none" : "0 12px 32px rgba(0, 0, 0, 0.25)"
              )
            }
          >
            {hasShadow ? "あり" : "なし"}
          </button>
        </div>
      </div>

      {!isSlide && (
        <div className="section">
          <div className="section-title">配置</div>
          <div className="row">
            <span className="row-label" title="スライドに対して整列">整列</span>
            <AlignButtons onAlign={(cmd) => engine.alignToSlide(cmd)} titleSuffix="（スライド基準）" />
          </div>
          <div className="row">
            <button className="small-btn" onClick={() => bringForward(1)}>
              前面へ
            </button>
            <button className="small-btn" onClick={() => bringForward(-1)}>
              背面へ
            </button>
            <button className="small-btn" onClick={() => engine.resetPosition()}>
              位置をリセット
            </button>
          </div>
          <div className="placeholder" style={{ padding: "2px 0", textAlign: "left" }}>
            ドラッグまたは矢印キーで移動（Shift で 10px）
          </div>
        </div>
      )}
    </div>
  );
}
