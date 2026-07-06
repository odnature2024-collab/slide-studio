// アプリ本体：レイアウト・グローバルショートカット・ファイルのドラッグ&ドロップ

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorEngine } from "./lib/engine";
import { loadFromFile, openHtmlFile } from "./lib/fileIO";
import { extractPalette } from "./lib/colorExtractor";
import Toolbar from "./components/Toolbar";
import SlidePanel from "./components/SlidePanel";
import EditorCanvas from "./components/EditorCanvas";
import PropertyPanel from "./components/PropertyPanel";
import ThemePanel from "./components/ThemePanel";
import PresentModal from "./components/PresentModal";

type SideTab = "theme" | "props";

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function App() {
  const engineRef = useRef<EditorEngine | null>(null);
  if (!engineRef.current) engineRef.current = new EditorEngine();
  const engine = engineRef.current;

  const [version, setVersion] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [tab, setTab] = useState<SideTab>("theme");
  const lastSelectedRef = useRef<Element | null>(null);

  // パネル幅（スプリッターでドラッグ調整、localStorage に保存）
  const [leftWidth, setLeftWidth] = useState(() =>
    clampWidth(Number(localStorage.getItem("hse-left-width")) || 216, 140, 480)
  );
  const [rightWidth, setRightWidth] = useState(() =>
    clampWidth(Number(localStorage.getItem("hse-right-width")) || 300, 240, 640)
  );
  const [splitting, setSplitting] = useState(false);

  const startSplit = (side: "left" | "right") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    setSplitting(true);
    const startX = ev.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (side === "left") setLeftWidth(clampWidth(startLeft + dx, 140, 480));
      else setRightWidth(clampWidth(startRight - dx, 240, 640));
    };
    const onUp = (e: PointerEvent) => {
      setSplitting(false);
      const dx = e.clientX - startX;
      if (side === "left") {
        localStorage.setItem("hse-left-width", String(clampWidth(startLeft + dx, 140, 480)));
      } else {
        localStorage.setItem("hse-right-width", String(clampWidth(startRight - dx, 240, 640)));
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    engine.onUpdate = () => setVersion((v) => v + 1);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__engine = engine;
    }
    return () => {
      engine.onUpdate = () => {};
    };
  }, [engine]);

  // 要素を新たに選択したらプロパティタブへ自動で切り替える
  useEffect(() => {
    if (engine.selected && engine.selected !== lastSelectedRef.current) setTab("props");
    lastSelectedRef.current = engine.selected;
  });

  // グローバルショートカット（iframe 外にフォーカスがあるときも効くように）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) {
        if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
          ev.preventDefault();
          if (ev.shiftKey) void engine.saveAs();
          else void engine.save();
        }
        return;
      }
      engine.handleKeyDown(ev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  // 未保存のまま閉じようとしたら警告
  useEffect(() => {
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (engine.dirty) ev.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [engine]);

  const handleDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".html") || file.name.endsWith(".htm") || file.type === "text/html") {
      if (engine.dirty && !window.confirm("未保存の変更があります。破棄して開きますか？")) return;
      engine.loadFile(await loadFromFile(file));
    } else if (file.type.startsWith("image/") && engine.loaded) {
      await engine.insertImageFromFile(file);
    }
  };

  const handleOpen = async () => {
    const file = await openHtmlFile();
    if (file) engine.loadFile(file);
  };

  const handleDemo = async () => {
    const res = await fetch("./demo-slides.html");
    const text = await res.text();
    engine.loadFile({ text, name: "デモスライド.html", handle: null });
  };

  // パレット抽出は重めの処理。色が変わった編集のときだけ再抽出する
  // （移動・リサイズ・角丸など色に無関係な操作では version が上がっても再計算しない）
  const paletteEntries = useMemo(() => {
    if (!engine.doc) return [];
    return extractPalette(engine.doc, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, engine.colorEpoch]);

  const paletteHexes = useMemo(
    () => paletteEntries.slice(0, 6).map((p) => p.hex),
    [paletteEntries]
  );

  // 図形挿入の初期色はテーマのメインカラー
  const shapeFill =
    paletteEntries.find((p) => p.role === "main")?.hex ?? paletteEntries[0]?.hex ?? "#4285f4";

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <Toolbar
        engine={engine}
        version={version}
        shapeFill={shapeFill}
        onPresent={() => setPresenting(true)}
      />

      {engine.loaded ? (
        <div className={`app-main ${splitting ? "splitting" : ""}`}>
          <SlidePanel engine={engine} version={version} panelWidth={leftWidth} />
          <div
            className={`splitter ${splitting ? "dragging" : ""}`}
            onPointerDown={startSplit("left")}
            title="ドラッグで幅を調整"
          />
          <EditorCanvas engine={engine} version={version} />
          <div
            className={`splitter ${splitting ? "dragging" : ""}`}
            onPointerDown={startSplit("right")}
            title="ドラッグで幅を調整"
          />
          <aside className="side-panel" style={{ width: rightWidth }}>
            <div className="side-tabs">
              <button
                className={`side-tab ${tab === "theme" ? "active" : ""}`}
                onClick={() => setTab("theme")}
              >
                テーマ
              </button>
              <button
                className={`side-tab ${tab === "props" ? "active" : ""}`}
                onClick={() => setTab("props")}
              >
                プロパティ
              </button>
            </div>
            <div className="side-body">
              {tab === "theme" ? (
                <ThemePanel engine={engine} version={version} mergedPalette={paletteEntries} />
              ) : (
                <PropertyPanel engine={engine} version={version} palette={paletteHexes} />
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-logo">S</div>
          <div className="empty-title">スライドスタジオ</div>
          <div className="empty-desc">
            HTML スライドを、パワーポイントのように直感的に編集。
            <br />
            色の一括変更・文字編集・画像挿入・ドラッグ移動に対応しています。
          </div>
          <div className="empty-actions">
            <button className="big-btn primary" onClick={handleOpen}>
              HTMLファイルを開く
            </button>
            <button className="big-btn ghost" onClick={handleDemo}>
              デモスライドで試す
            </button>
          </div>
          <div className="drop-hint">ここに HTML ファイルをドラッグ&ドロップしても開けます</div>
        </div>
      )}

      {presenting && <PresentModal engine={engine} onClose={() => setPresenting(false)} />}
    </div>
  );
}
