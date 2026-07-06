// 右パネル：デザイン統一機能。文書全体の色を抽出し、一括で置き換える

import { useMemo, useRef, useState } from "react";
import type { EditorEngine } from "../lib/engine";
import {
  extractPalette,
  ROLE_LABELS,
  type ColorRole,
  type PaletteEntry,
} from "../lib/colorExtractor";
import { replaceColorEverywhere } from "../lib/themeApplier";

interface Props {
  engine: EditorEngine;
  version: number;
  /** App で1回だけ抽出した近似色まとめ済みパレット（再抽出を避ける） */
  mergedPalette: PaletteEntry[];
}

const MERGE_TOLERANCE = 24;
const MAX_ROWS = 14;

interface Preset {
  name: string;
  colors: Record<"main" | "sub" | "accent", string>;
}

const PRESETS: Preset[] = [
  { name: "コーポレート", colors: { main: "#1d4ed8", sub: "#0ea5e9", accent: "#f59e0b" } },
  { name: "フォレスト", colors: { main: "#166534", sub: "#65a30d", accent: "#d97706" } },
  { name: "サンセット", colors: { main: "#be123c", sub: "#fb7185", accent: "#facc15" } },
  { name: "モノクロ×朱", colors: { main: "#1f2937", sub: "#6b7280", accent: "#e11d48" } },
  { name: "オーシャン", colors: { main: "#0e7490", sub: "#38bdf8", accent: "#f97316" } },
  { name: "ラベンダー", colors: { main: "#6d28d9", sub: "#a78bfa", accent: "#fbbf24" } },
  { name: "アース", colors: { main: "#7c2d12", sub: "#d97706", accent: "#84cc16" } },
  { name: "ミッドナイト", colors: { main: "#1e293b", sub: "#64748b", accent: "#38bdf8" } },
  { name: "サクラ", colors: { main: "#be185d", sub: "#f9a8d4", accent: "#0d9488" } },
  { name: "シトラス", colors: { main: "#3f6212", sub: "#a3e635", accent: "#facc15" } },
];

const ROLE_ORDER: ColorRole[] = ["main", "sub", "accent", "background", "text", "other"];

export default function ThemePanel({ engine, version, mergedPalette }: Props) {
  const [merge, setMerge] = useState(true);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, ColorRole>>({});
  // ライブプレビュー中の置換対象（連続置換で色が変わっていくため追跡が必要）
  const liveTargetsRef = useRef<Map<string, string[]>>(new Map());

  const palette = useMemo(() => {
    void version;
    // まとめ表示は App で抽出済みのものを使う（既定。再抽出しない）
    if (merge) return mergedPalette;
    if (!engine.doc) return [];
    return extractPalette(engine.doc, 0);
  }, [engine, version, merge, mergedPalette]);

  const effectiveRole = (hex: string, fallback: ColorRole): ColorRole =>
    roleOverrides[hex] ?? fallback;

  const previewReplace = (originHex: string, members: string[], newHex: string) => {
    if (!engine.doc) return;
    const targets = liveTargetsRef.current.get(originHex) ?? members;
    replaceColorEverywhere(engine.doc, targets, newHex);
    liveTargetsRef.current.set(originHex, [newHex]);
    engine.onOverlay();
  };

  const commitReplace = (originHex: string, members: string[], newHex: string) => {
    if (!engine.doc) return;
    const targets = liveTargetsRef.current.get(originHex) ?? members;
    replaceColorEverywhere(engine.doc, targets, newHex);
    liveTargetsRef.current.delete(originHex);
    engine.recordThemeOp(members, newHex);
    engine.commit();
  };

  const applyPreset = (preset: Preset) => {
    if (!engine.doc) return;
    let changed = 0;
    for (const role of ["main", "sub", "accent"] as const) {
      const newHex = preset.colors[role];
      const members = palette
        .filter((p) => effectiveRole(p.hex, p.role) === role)
        .flatMap((p) => p.members);
      if (members.length > 0) {
        const n = replaceColorEverywhere(engine.doc, members, newHex);
        if (n > 0) {
          engine.recordThemeOp(members, newHex);
          changed += n;
        }
      }
    }
    if (changed > 0) engine.commit();
  };

  if (!engine.loaded) {
    return <div className="placeholder">ファイルを開くと、使われている色がここに表示されます。</div>;
  }

  const rows = palette.slice(0, MAX_ROWS);

  return (
    <div>
      <div className="section">
        <div className="section-title">テーマプリセット</div>
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button key={preset.name} className="preset-card" onClick={() => applyPreset(preset)}>
              <span className="preset-chips">
                <span style={{ background: preset.colors.main }} />
                <span style={{ background: preset.colors.sub }} />
                <span style={{ background: preset.colors.accent }} />
              </span>
              <span className="preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
        <div className="placeholder" style={{ padding: "6px 0", textAlign: "left" }}>
          メイン／サブ／アクセントに割り当てられた色を一括で置き換えます。
        </div>
        <button
          className="small-btn reset-theme"
          disabled={engine.themeOps.length === 0}
          onClick={() => engine.resetTheme()}
          title="一括変更した色をすべて読み込み時の色に戻します"
        >
          ↺ テーマを初期値に戻す
        </button>
      </div>

      <div className="section">
        <div className="section-title">使用中のカラー（クリックで一括変更）</div>
        <label className="merge-row">
          <input
            type="checkbox"
            checked={merge}
            onChange={(e) => setMerge(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          よく似た色をまとめる
        </label>
        {rows.map((entry) => {
          const role = effectiveRole(entry.hex, entry.role);
          return (
            <div className="palette-row" key={entry.hex}>
              <span className="color-swatch" title="クリックして一括変更">
                <span className="color-swatch-fill" style={{ background: entry.hex }} />
                <input
                  type="color"
                  value={entry.hex}
                  onInput={(e) =>
                    previewReplace(entry.hex, entry.members, (e.target as HTMLInputElement).value)
                  }
                  onChange={(e) => commitReplace(entry.hex, entry.members, e.target.value)}
                />
              </span>
              <span className="palette-hex">
                {entry.hex}
                {entry.members.length > 1 && ` +${entry.members.length - 1}`}
              </span>
              <span className="palette-count">×{entry.count}</span>
              <select
                className="role-select"
                value={role}
                onChange={(e) =>
                  setRoleOverrides((prev) => ({
                    ...prev,
                    [entry.hex]: e.target.value as ColorRole,
                  }))
                }
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {palette.length > MAX_ROWS && (
          <div className="placeholder" style={{ padding: "4px 0" }}>
            他 {palette.length - MAX_ROWS} 色…
          </div>
        )}
      </div>
    </div>
  );
}
