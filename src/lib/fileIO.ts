// HTML ファイルの読み込み・保存（File System Access API ＋ フォールバック）

export interface LoadedFile {
  text: string;
  name: string;
  handle: FileSystemFileHandle | null;
}

const HTML_TYPE: FilePickerAcceptType = {
  description: "HTML ファイル",
  accept: { "text/html": [".html", ".htm"] },
};

/** ファイルピッカーで HTML を開く。キャンセル時は null */
export async function openHtmlFile(): Promise<LoadedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [HTML_TYPE] });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return null;
      throw err;
    }
  }
  // フォールバック: <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,.htm,text/html";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ text: await file.text(), name: file.name, handle: null });
    };
    // キャンセル検知（フォーカス復帰時に未選択なら null）
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** File オブジェクト（ドラッグ&ドロップ等）から読み込む */
export async function loadFromFile(file: File): Promise<LoadedFile> {
  return { text: await file.text(), name: file.name, handle: null };
}

/**
 * HTML を保存する。handle があれば上書き、なければ保存ダイアログ（非対応ならダウンロード）。
 * 実際に使われたハンドルを返す（以後の上書き保存に使う）。
 */
export async function saveHtmlFile(
  text: string,
  suggestedName: string,
  handle: FileSystemFileHandle | null
): Promise<FileSystemFileHandle | null> {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return handle;
  }
  if (window.showSaveFilePicker) {
    try {
      const newHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [HTML_TYPE],
      });
      const writable = await newHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return newHandle;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return null;
      throw err;
    }
  }
  downloadHtml(text, suggestedName);
  return null;
}

/** ブラウザのダウンロードとして保存する */
export function downloadHtml(text: string, name: string): void {
  const blob = new Blob([text], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
