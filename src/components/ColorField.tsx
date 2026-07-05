// カラーピッカー＋hex 入力＋パレットショートカットの共通コンポーネント

import { useEffect, useState } from "react";
import { normalizeColor } from "../lib/color";

interface Props {
  /** 現在の色（#rrggbb）。透明・未設定は null */
  value: string | null;
  /** ドラッグ中などのライブ変更 */
  onPreview?: (hex: string) => void;
  /** 確定 */
  onChange: (hex: string) => void;
  /** テーマパレットのショートカット色 */
  palette?: string[];
  /** 「透明にする」ボタンを出すか */
  onClear?: () => void;
}

export default function ColorField({ value, onPreview, onChange, palette, onClear }: Props) {
  const [hexText, setHexText] = useState(value ?? "");

  useEffect(() => {
    setHexText(value ?? "");
  }, [value]);

  const commitHexText = () => {
    const norm = normalizeColor(hexText.startsWith("#") ? hexText : `#${hexText}`);
    if (norm) onChange(norm.hex);
    else setHexText(value ?? "");
  };

  return (
    <div className="color-field">
      <span className="color-swatch" title="クリックして色を選択">
        {value && <span className="color-swatch-fill" style={{ background: value }} />}
        <input
          type="color"
          value={value ?? "#ffffff"}
          onInput={(e) => onPreview?.((e.target as HTMLInputElement).value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      <input
        className="hex-input"
        value={hexText}
        placeholder="—"
        onChange={(e) => setHexText(e.target.value)}
        onBlur={commitHexText}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitHexText();
        }}
      />
      {palette && palette.length > 0 && (
        <span className="mini-palette">
          {palette.slice(0, 6).map((hex) => (
            <span
              key={hex}
              className="mini-chip"
              style={{ background: hex }}
              title={hex}
              onClick={() => onChange(hex)}
            />
          ))}
        </span>
      )}
      {onClear && (
        <button className="small-btn" onClick={onClear} title="透明にする">
          透明
        </button>
      )}
    </div>
  );
}
