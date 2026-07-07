// ブラウザのフルスクリーン制御（ベンダー差を吸収）。
// プレゼン時にタブ・アドレスバーなどのブラウザ枠を隠して完全全画面にする。
// 注意: requestFullscreen はユーザー操作（クリック/タップ）の中から呼ぶ必要がある。

interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

/** フルスクリーン API が使えるか（iPhone Safari など非対応環境では false） */
export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsElement;
  return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
}

/** 現在フルスクリーン中か */
export function isFullscreen(): boolean {
  const doc = document as FsDocument;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** 全画面に入る（ユーザー操作ハンドラ内から呼ぶこと）。成否は問わず握りつぶす */
export async function enterFullscreen(target?: HTMLElement): Promise<void> {
  const el = (target ?? document.documentElement) as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions);
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    // 非対応・拒否時は通常表示のまま（PWA ホーム画面起動なら元々全画面）
  }
}

/** 全画面を抜ける */
export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const doc = document as FsDocument;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
  } catch {
    // 握りつぶす
  }
}
