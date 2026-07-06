// PDF 書き出し：スライドごとの iframe を1ページずつ並べた印刷用ドキュメントを
// 非表示 iframe に組み立て、ブラウザの印刷ダイアログ（「PDF に保存」）を開く。
// サムネイル・プレゼンと同じ「serialize(true) + onlySlideCss」方式なので見た目が一致する。

import { injectStyleIntoHtml, onlySlideCss } from "./editorDoc";

export interface PdfExportOptions {
  /** serialize(true) — スライド連番マーク付きの HTML */
  html: string;
  slideCount: number;
  width: number;
  height: number;
  /** 印刷ダイアログ・PDF の既定ファイル名になるタイトル */
  title: string;
}

/** 各スライド iframe 内に追加する印刷用スタイル（背景色・画像を必ず印刷する） */
const PRINT_COLOR_CSS = `
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** iframe の読み込みと Web フォントの準備を待つ */
function waitForFrame(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    frame.addEventListener(
      "load",
      () => {
        const doc = frame.contentDocument;
        const fonts = doc?.fonts;
        if (fonts) {
          fonts.ready.then(() => resolve(), () => resolve());
        } else {
          resolve();
        }
      },
      { once: true }
    );
  });
}

export async function exportPdf(options: PdfExportOptions): Promise<void> {
  const { html, slideCount, width, height, title } = options;
  if (slideCount === 0) return;

  // 印刷用ドキュメントを入れる非表示ホスト（display:none だと印刷できないため opacity で隠す）
  const host = document.createElement("iframe");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);

  try {
    const doc = host.contentDocument;
    if (!doc) throw new Error("印刷用フレームを初期化できませんでした");
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: ${width}px ${height}px; margin: 0; }
html, body { margin: 0; padding: 0; }
.page { width: ${width}px; height: ${height}px; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page iframe { width: ${width}px; height: ${height}px; border: 0; display: block; }
</style></head><body></body></html>`);
    doc.close();

    // スライドごとに1ページ分の iframe を並べる（スクリプトは実行しない）
    const waits: Promise<void>[] = [];
    for (let i = 0; i < slideCount; i++) {
      const page = doc.createElement("div");
      page.className = "page";
      const frame = doc.createElement("iframe");
      frame.setAttribute("sandbox", "allow-same-origin");
      waits.push(waitForFrame(frame));
      frame.srcdoc = injectStyleIntoHtml(html, onlySlideCss(i) + PRINT_COLOR_CSS);
      page.appendChild(frame);
      doc.body.appendChild(page);
    }
    await Promise.all(waits);
    // フォント・画像の描画が落ち着くまでひと呼吸置く
    await new Promise((r) => setTimeout(r, 300));

    host.contentWindow?.focus();
    host.contentWindow?.print();
  } finally {
    // Chrome では print() はダイアログを閉じるまで戻らないため、戻ってから片付ける
    // （非同期印刷のブラウザでも猶予を置いてから除去する）
    setTimeout(() => host.remove(), 2000);
  }
}
