// 上部ツールバー：開く / 保存 / Undo / Redo / 画像挿入 / プレゼン

import { useRef } from "react";
import type { EditorEngine } from "../lib/engine";
import { openHtmlFile, downloadHtml } from "../lib/fileIO";
import { exportPdf } from "../lib/pdfExport";

interface Props {
  engine: EditorEngine;
  version: number;
  onPresent: () => void;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24">
      <path d={d} />
    </svg>
  );
}

export default function Toolbar({ engine, onPresent }: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = async () => {
    if (engine.dirty && !window.confirm("未保存の変更があります。破棄して別のファイルを開きますか？")) {
      return;
    }
    const file = await openHtmlFile();
    if (file) engine.loadFile(file);
  };

  const handleImagePick = () => imageInputRef.current?.click();

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await engine.insertImageFromFile(file);
    e.target.value = "";
  };

  const handleExportPdf = async () => {
    engine.finishEditing();
    await exportPdf({
      html: engine.serialize(true),
      slideCount: engine.slides.length,
      width: engine.slideSize.width,
      height: engine.slideSize.height,
      title: (engine.fileName ?? "スライド").replace(/\.html?$/i, ""),
    });
  };

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="brand-mark">S</span>
        <span className="brand-name">スライドスタジオ</span>
      </div>

      <button className="tb-btn" onClick={handleOpen} title="HTMLファイルを開く">
        <Icon d="M4 20h16M4 20V6a2 2 0 0 1 2-2h5l2 3h5a2 2 0 0 1 2 2v11" />
        開く
      </button>
      <button
        className="tb-btn"
        disabled={!engine.loaded}
        onClick={() => void engine.save()}
        title="保存（⌘S）"
      >
        <Icon d="M5 3h11l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v6h8V3M7 21v-8h10v8" />
        保存
      </button>
      <button
        className="tb-btn"
        disabled={!engine.loaded}
        onClick={() => void engine.saveAs()}
        title="別名で保存（⇧⌘S）"
      >
        <Icon d="M5 3h11l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M12 11v7m0 0l-3-3m3 3l3-3" />
        別名で保存
      </button>
      <button
        className="tb-btn"
        disabled={!engine.loaded}
        onClick={() => downloadHtml(engine.serialize(), engine.fileName ?? "スライド.html")}
        title="ダウンロードとして保存"
      >
        <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
      </button>
      <button
        className="tb-btn"
        disabled={!engine.loaded}
        onClick={() => void handleExportPdf()}
        title="PDFとして書き出し（印刷ダイアログで「PDFに保存」を選択）"
      >
        <Icon d="M6 3h9l5 5v13H6zM15 3v5h5M9 13h6M9 17h6" />
        PDF
      </button>

      <div className="tb-sep" />

      <button
        className="tb-btn"
        disabled={!engine.history.canUndo()}
        onClick={() => engine.undo()}
        title="元に戻す（⌘Z）"
      >
        <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
      </button>
      <button
        className="tb-btn"
        disabled={!engine.history.canRedo()}
        onClick={() => engine.redo()}
        title="やり直す（⇧⌘Z）"
      >
        <Icon d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
      </button>

      <div className="tb-sep" />

      <button
        className="tb-btn"
        disabled={!engine.loaded}
        onClick={handleImagePick}
        title="画像を挿入"
      >
        <Icon d="M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5-9 9" />
        画像
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageSelected}
      />

      <button
        className={`tb-btn ${engine.multiSelectMode ? "on" : ""}`}
        disabled={!engine.loaded}
        onClick={() => engine.setMultiSelectMode(!engine.multiSelectMode)}
        title="複数選択モード（ON の間はクリック／タップで要素を追加選択）"
      >
        <Icon d="M3 3h9v9H3zM12 12h9v9h-9z" />
        複数選択
      </button>

      <div className="tb-spacer" />

      {engine.loaded && (
        <div className="file-label" title={engine.fileName ?? ""}>
          {engine.dirty && <span className="dirty-dot" title="未保存の変更" />}
          {engine.fileName}
          {!engine.detectionConfident && (
            <span className="detect-badge" title={`スライド検出: ${engine.detectionMethod}`}>
              検出: {engine.detectionMethod}
            </span>
          )}
        </div>
      )}

      <button className="tb-btn primary" disabled={!engine.loaded} onClick={onPresent}>
        <Icon d="M6 4l14 8-14 8z" />
        プレゼン
      </button>
    </div>
  );
}
