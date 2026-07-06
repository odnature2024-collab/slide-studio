// エディタの中核。iframe 内のドキュメントを唯一の真実として編集を制御する。

import { detectSlides } from "./slideDetector";
import {
  injectEditorStyle,
  markSlides,
  markChromeElements,
  finishAllAnimations,
  setActiveSlide,
  serializeDocument,
  detectStateClass,
  SELECTED_ATTR,
  type SlideStateClass,
} from "./editorDoc";
import { SnapshotHistory } from "./history";
import { saveHtmlFile, type LoadedFile } from "./fileIO";
import { replaceColorEverywhere } from "./themeApplier";

export type StylableElement = HTMLElement | SVGElement;

interface PointerState {
  startX: number;
  startY: number;
  moved: boolean;
  /** クリック開始時点で既に選択の内側だったか（親選択拡大の判定に使う） */
  wasInsideSelection: boolean;
  target: StylableElement | null;
}

interface TransformBase {
  baseTransform: string;
  baseDx: number;
  baseDy: number;
}

/** ドラッグ中の対象（複数選択ではすべての要素をまとめて動かす） */
interface DragState {
  items: Array<{ el: StylableElement; base: TransformBase }>;
}

export type AlignCommand = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export interface ResizeStart {
  width: number;
  height: number;
  baseTransform: string;
  baseDx: number;
  baseDy: number;
  /** 角ハンドルで文字サイズを連動スケールさせる（テキストを含む要素） */
  fontScale: boolean;
  /** スケール対象要素と開始時のフォントサイズ(px) */
  fonts: Array<{ el: StylableElement; size: number }>;
  /** 開始時にインラインで height が指定されていたか（その値） */
  inlineHeight: string;
  isImage: boolean;
}

const NUDGE_COMMIT_DELAY = 600;

export class EditorEngine {
  iframe: HTMLIFrameElement | null = null;
  doc: Document | null = null;
  slides: HTMLElement[] = [];
  stateClass: SlideStateClass | null = null;
  detectionMethod = "";
  detectionConfident = true;
  slideSize = { width: 1280, height: 720 };
  current = 0;
  /** 選択中の要素（複数選択対応。先頭が主選択） */
  selection: StylableElement[] = [];
  /** タッチ環境用: ON の間はクリックのたびに選択へ追加／解除する */
  multiSelectMode = false;
  hovered: StylableElement | null = null;
  editingEl: StylableElement | null = null;
  fileName: string | null = null;
  fileHandle: FileSystemFileHandle | null = null;
  history = new SnapshotHistory();
  dirty = false;
  loaded = false;
  /** テーマ（色の一括置換）の操作記録。「初期値に戻す」で逆順に巻き戻す */
  themeOps: Array<{ targets: string[]; newHex: string }> = [];

  /** 構造的な変更（履歴・パネル更新が必要）の通知 */
  onUpdate: () => void = () => {};
  /** 一時的な変更（ドラッグ中・ホバー等、オーバーレイのみ更新）の通知 */
  onOverlay: () => void = () => {};

  private pendingHtml: string | null = null;
  private isInitialLoad = false;
  private pointer: PointerState | null = null;
  private drag: DragState | null = null;
  private resizeStart: ResizeStart | null = null;
  private editingOriginalHtml = "";
  private nudgeTimer: number | null = null;
  private listenersAbort: AbortController | null = null;
  /** タッチのダブルタップ検出用（iPad ではダブルクリックが使えないため） */
  private lastTap: { t: number; x: number; y: number } | null = null;

  // ---- ライフサイクル ----

  attachIframe(iframe: HTMLIFrameElement | null): void {
    this.iframe = iframe;
    if (iframe && this.pendingHtml != null) {
      iframe.srcdoc = this.pendingHtml;
      this.pendingHtml = null;
    }
  }

  loadFile(file: LoadedFile): void {
    this.fileName = file.name;
    this.fileHandle = file.handle;
    this.current = 0;
    this.dirty = false;
    this.loaded = true;
    this.themeOps = [];
    this.isInitialLoad = true;
    this.writeToIframe(file.text);
    this.onUpdate();
  }

  private writeToIframe(html: string): void {
    if (this.iframe) {
      this.iframe.srcdoc = html;
    } else {
      this.pendingHtml = html;
    }
  }

  /** iframe の onLoad から呼ばれる */
  handleIframeLoad(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc || !doc.body) return;
    this.doc = doc;
    this.selection = [];
    this.hovered = null;
    this.editingEl = null;
    this.pointer = null;
    this.drag = null;

    injectEditorStyle(doc);
    const detection = detectSlides(doc);
    this.slides = detection.slides;
    this.detectionMethod = detection.method;
    this.detectionConfident = detection.confident;
    this.current = Math.min(this.current, Math.max(0, this.slides.length - 1));
    markSlides(doc, this.slides);
    this.stateClass = detectStateClass(doc, this.slides);
    setActiveSlide(this.slides, this.current, this.stateClass);
    markChromeElements(doc, this.slides);
    finishAllAnimations(doc);
    this.measureSlideSize();
    this.bindDocListeners(doc);

    if (this.isInitialLoad) {
      this.isInitialLoad = false;
      this.history.reset(this.serialize());
    }
    this.onUpdate();
  }

  private measureSlideSize(): void {
    const slide = this.slides[this.current];
    if (!slide) return;
    const rect = slide.getBoundingClientRect();
    if (rect.width >= 320 && rect.width <= 4200 && rect.height >= 180 && rect.height <= 4200) {
      this.slideSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
    }
  }

  // ---- シリアライズ・保存・履歴 ----

  serialize(keepSlideMarks = false): string {
    if (!this.doc) return "";
    return serializeDocument(this.doc, {
      keepSlideMarks,
      stateClass: this.stateClass ?? undefined,
      // サムネイル・プレビューは全スライドを「表示中」状態で書き出し、
      // 保存・履歴は読み込み時の状態クラスに戻す
      stateMode: keepSlideMarks ? "all" : "original",
    });
  }

  commit(): void {
    if (!this.doc) return;
    this.dirty = true;
    // クラス変更やスタイル書き換えで再始動したアニメーションを完了状態にする
    finishAllAnimations(this.doc);
    this.history.push(this.serialize());
    this.onUpdate();
  }

  undo(): void {
    const html = this.history.undo();
    if (html != null) this.restore(html);
  }

  redo(): void {
    const html = this.history.redo();
    if (html != null) this.restore(html);
  }

  private restore(html: string): void {
    this.dirty = true;
    this.writeToIframe(html); // onLoad で再初期化される
  }

  async save(): Promise<boolean> {
    if (!this.doc || !this.fileName) return false;
    this.finishEditing();
    const handle = await saveHtmlFile(this.serialize(), this.fileName, this.fileHandle);
    if (handle) {
      this.fileHandle = handle;
      this.fileName = handle.name;
    }
    this.dirty = false;
    this.onUpdate();
    return true;
  }

  // ---- スライド操作 ----

  setCurrent(index: number): void {
    if (!this.doc || index < 0 || index >= this.slides.length) return;
    this.finishEditing();
    this.current = index;
    this.select(null);
    setActiveSlide(this.slides, index, this.stateClass);
    finishAllAnimations(this.doc);
    this.measureSlideSize();
    this.onUpdate();
  }

  duplicateSlide(index: number): void {
    const doc = this.doc;
    const src = this.slides[index];
    if (!doc || !src) return;
    const clone = src.cloneNode(true) as HTMLElement;
    src.after(clone);
    this.slides.splice(index + 1, 0, clone);
    markSlides(doc, this.slides);
    this.setCurrent(index + 1);
    this.commit();
  }

  deleteSlide(index: number): void {
    const doc = this.doc;
    if (!doc || this.slides.length <= 1 || !this.slides[index]) return;
    this.slides[index].remove();
    this.slides.splice(index, 1);
    markSlides(doc, this.slides);
    this.current = Math.min(this.current, this.slides.length - 1);
    this.select(null);
    setActiveSlide(this.slides, this.current, this.stateClass);
    this.commit();
  }

  moveSlide(index: number, delta: number): void {
    const doc = this.doc;
    const target = index + delta;
    if (!doc || target < 0 || target >= this.slides.length) return;
    const el = this.slides[index];
    const other = this.slides[target];
    if (delta < 0) other.before(el);
    else other.after(el);
    this.slides.splice(index, 1);
    this.slides.splice(target, 0, el);
    markSlides(doc, this.slides);
    this.current = target;
    setActiveSlide(this.slides, this.current, this.stateClass);
    this.commit();
  }

  // ---- 選択 ----

  activeSlide(): HTMLElement | null {
    return this.slides[this.current] ?? null;
  }

  /** 主選択（複数選択時は先頭の要素）。既存コードとの互換用 */
  get selected(): StylableElement | null {
    return this.selection[0] ?? null;
  }

  select(el: StylableElement | null): void {
    const same = el
      ? this.selection.length === 1 && this.selection[0] === el
      : this.selection.length === 0;
    if (same) return;
    this.setSelection(el ? [el] : []);
  }

  /** 追加選択／選択解除（Shift+クリック・複数選択モード用）。スライド自体は対象外 */
  toggleSelect(el: StylableElement): void {
    if (el === this.activeSlide()) return;
    if (this.selection.includes(el)) {
      this.setSelection(this.selection.filter((e) => e !== el));
      return;
    }
    // スライド自体や、祖先・子孫関係にある要素は同時選択しない（移動が二重適用されるため）
    const rest = this.selection.filter(
      (e) => e !== this.activeSlide() && !e.contains(el) && !el.contains(e)
    );
    this.setSelection([...rest, el]);
  }

  isSelected(el: StylableElement): boolean {
    return this.selection.includes(el);
  }

  setMultiSelectMode(on: boolean): void {
    if (this.multiSelectMode === on) return;
    this.multiSelectMode = on;
    this.onUpdate();
  }

  private setSelection(els: StylableElement[]): void {
    for (const prev of this.selection) prev.removeAttribute(SELECTED_ATTR);
    this.selection = els;
    for (const el of els) el.setAttribute(SELECTED_ATTR, "");
    this.onUpdate();
  }

  /** 選択中の要素のうち移動・整列・削除の対象になるもの（スライド自体を除く） */
  private movableSelection(): StylableElement[] {
    const active = this.activeSlide();
    return this.selection.filter((el) => el !== active);
  }

  /** クリック位置から選択対象を決める（アクティブスライドの内側のみ） */
  private pick(target: EventTarget | null): StylableElement | null {
    const doc = this.doc;
    const active = this.activeSlide();
    if (!doc || !active) return null;
    let el = target as Element | null;
    if (!el || el.nodeType !== 1) return null;
    if (el === doc.documentElement || el === doc.body) return null;
    if (el !== active && !active.contains(el)) return null;
    return el as StylableElement;
  }

  getRect(el: Element): DOMRect | null {
    if (!this.doc || !el.isConnected) return null;
    return el.getBoundingClientRect();
  }

  // ---- 親オーバーレイからの入力（iframe 内座標で受け取る） ----
  // iPad の Safari では縮小 iframe にタッチが届かないため、
  // 選択・ドラッグ等はすべて親ドキュメント側で受けてここへ流し込む。

  private elementAt(x: number, y: number): Element | null {
    return this.doc?.elementFromPoint(x, y) ?? null;
  }

  overlayPointerDown(x: number, y: number, additive = false): void {
    this.pointerDownCore(x, y, this.elementAt(x, y), additive);
  }

  overlayPointerMove(x: number, y: number): void {
    this.pointerMoveCore(x, y, this.elementAt(x, y));
  }

  overlayPointerUp(x: number, y: number): void {
    this.pointerUpCore(x, y, this.elementAt(x, y));
  }

  overlayDoubleClick(x: number, y: number): void {
    const el = this.pick(this.elementAt(x, y));
    if (el && !this.editingEl) this.tryStartTextEdit(el);
  }

  overlayLeave(): void {
    if (this.hovered) {
      this.hovered = null;
      this.onOverlay();
    }
  }

  // ---- iframe 内イベント ----

  private bindDocListeners(doc: Document): void {
    this.listenersAbort?.abort();
    const abort = new AbortController();
    this.listenersAbort = abort;
    const opts = { signal: abort.signal };

    // 通常の操作は親オーバーレイ経由で入るため、iframe 内のポインタ処理が
    // 実際に動くのは主にテキスト編集中（オーバーレイが無効のとき）だけ
    doc.addEventListener(
      "pointerdown",
      (ev) => {
        if (!this.editingEl) ev.preventDefault();
        try {
          (ev.target as Element).setPointerCapture?.(ev.pointerId);
        } catch {
          // 合成イベント等で pointerId が無効な場合は無視
        }
        this.pointerDownCore(ev.clientX, ev.clientY, ev.target, ev.shiftKey || ev.ctrlKey || ev.metaKey);
      },
      opts
    );
    doc.addEventListener(
      "pointermove",
      (ev) => this.pointerMoveCore(ev.clientX, ev.clientY, ev.target),
      opts
    );
    doc.addEventListener(
      "pointerup",
      (ev) => this.pointerUpCore(ev.clientX, ev.clientY, ev.target),
      opts
    );
    doc.addEventListener("dblclick", (ev) => this.handleDblClick(ev), opts);
    doc.addEventListener("keydown", (ev) => this.handleKeyDown(ev), opts);
    doc.addEventListener(
      "dragstart",
      (ev) => {
        if (!this.editingEl) ev.preventDefault();
      },
      opts
    );
    // iPad: タッチ移動をスクロール等に取られないようにする（テキスト編集中を除く）
    doc.addEventListener(
      "touchmove",
      (ev) => {
        if (!this.editingEl) ev.preventDefault();
      },
      { signal: abort.signal, passive: false }
    );
    // 画像ファイルのドロップで挿入
    doc.addEventListener("dragover", (ev) => ev.preventDefault(), opts);
    doc.addEventListener(
      "drop",
      (ev) => {
        ev.preventDefault();
        const file = ev.dataTransfer?.files?.[0];
        if (file && file.type.startsWith("image/")) {
          void this.insertImageFromFile(file);
        }
      },
      opts
    );
  }

  // 以降の pointer*Core は iframe 内座標 (x, y) と、その位置の要素を受け取る。
  // iPad の Safari は縮小表示した iframe へのタッチ入力に不具合があるため、
  // 実際の入力は親ドキュメントのオーバーレイで受けて overlay* 経由で渡される。

  private pointerDownCore(
    x: number,
    y: number,
    rawTarget: EventTarget | null,
    additive = false
  ): void {
    if (this.editingEl) {
      if (rawTarget && this.editingEl.contains(rawTarget as Node)) return; // テキスト編集中はそのまま
      this.finishEditing();
    }
    const el = this.pick(rawTarget);

    // 追加選択（Shift/Ctrl+クリック・複数選択モード）: タップごとに選択へ追加／解除。
    // ドラッグ移動は通常モードで選択の内側をつかんで行う
    if (additive || this.multiSelectMode) {
      this.pointer = null;
      if (el && el !== this.activeSlide()) this.toggleSelect(el);
      return;
    }

    const wasInside =
      el != null && this.selection.some((s) => s === el || s.contains(el));

    this.pointer = {
      startX: x,
      startY: y,
      moved: false,
      wasInsideSelection: wasInside,
      target: el,
    };

    if (!el) {
      this.select(null);
      return;
    }
    if (!wasInside) this.select(el);
  }

  private pointerMoveCore(x: number, y: number, rawTarget: EventTarget | null): void {
    if (this.pointer) {
      const dx = x - this.pointer.startX;
      const dy = y - this.pointer.startY;
      if (!this.pointer.moved && Math.hypot(dx, dy) > 3) {
        this.pointer.moved = true;
        const movable = this.movableSelection();
        if (movable.length > 0 && !this.editingEl) {
          this.drag = {
            items: movable.map((el) => ({ el, base: this.captureTransformBase(el) })),
          };
        }
      }
      if (this.pointer.moved && this.drag) {
        for (const { el, base } of this.drag.items) this.applyTranslate(el, base, dx, dy);
        this.onOverlay();
      }
      return;
    }
    // ホバーハイライト
    const el = this.pick(rawTarget);
    const next = el && this.selection.includes(el) ? null : el;
    if (next !== this.hovered) {
      this.hovered = next;
      this.onOverlay();
    }
  }

  private pointerUpCore(x: number, y: number, rawTarget: EventTarget | null): void {
    const pointer = this.pointer;
    this.pointer = null;
    if (!pointer) return;

    if (pointer.moved && this.drag) {
      this.drag = null;
      this.commit(); // 移動を確定
      return;
    }
    this.drag = null;

    const el = this.pick(rawTarget);

    // ダブルタップ（タッチ用のダブルクリック相当）でテキスト編集を開始
    if (el) {
      const now = performance.now();
      const isDoubleTap =
        this.lastTap != null &&
        now - this.lastTap.t < 400 &&
        Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24;
      this.lastTap = { t: now, x, y };
      if (isDoubleTap && !this.editingEl && this.tryStartTextEdit(el)) return;
    }

    // クリック（移動なし）: 選択の深掘り・親への拡大（単一選択時のみ）
    if (!el || this.selection.length !== 1 || !this.selected || !pointer.wasInsideSelection) return;
    const active = this.activeSlide();
    if (this.selected === el) {
      // 選択中の要素そのものを再クリック → 親要素へ拡大
      if (el !== active) {
        const parent = el.parentElement;
        if (parent && (parent === active || active?.contains(parent))) this.select(parent);
      }
    } else if (this.selected.contains(el)) {
      // 選択中要素の内側の子要素をクリック → その子を選択
      this.select(el);
    }
  }

  // ---- ドラッグ移動（transform: translate 方式） ----

  private captureTransformBase(el: StylableElement): TransformBase {
    const ds = (el as HTMLElement).dataset;
    if (ds.hseBase == null) {
      ds.hseBase = el.style.transform || "";
      ds.hseDx = "0";
      ds.hseDy = "0";
    }
    return {
      baseTransform: ds.hseBase,
      baseDx: parseFloat(ds.hseDx || "0"),
      baseDy: parseFloat(ds.hseDy || "0"),
    };
  }

  private applyTranslate(el: StylableElement, base: TransformBase, dx: number, dy: number): void {
    const nx = base.baseDx + dx;
    const ny = base.baseDy + dy;
    const ds = (el as HTMLElement).dataset;
    ds.hseDx = String(nx);
    ds.hseDy = String(ny);
    const translate = `translate(${Math.round(nx)}px, ${Math.round(ny)}px)`;
    el.style.transform = base.baseTransform
      ? `${base.baseTransform} ${translate}`
      : translate;
  }

  /** 矢印キーでの微移動 */
  nudge(dx: number, dy: number): void {
    const els = this.movableSelection();
    if (els.length === 0) return;
    for (const el of els) {
      const base = this.captureTransformBase(el);
      this.applyTranslate(el, base, dx, dy);
    }
    this.onOverlay();
    if (this.nudgeTimer != null) window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => {
      this.nudgeTimer = null;
      this.commit();
    }, NUDGE_COMMIT_DELAY);
  }

  /** ドラッグで加えた移動を取り消して元の位置に戻す */
  resetPosition(): void {
    if (this.selection.length === 0) return;
    for (const el of this.selection) {
      const ds = (el as HTMLElement).dataset;
      const base = ds.hseBase;
      if (base != null) {
        if (base) el.style.transform = base;
        else el.style.removeProperty("transform");
        delete ds.hseBase;
        delete ds.hseDx;
        delete ds.hseDy;
      } else {
        el.style.removeProperty("transform");
      }
    }
    this.commit();
  }

  /** 選択中の要素をすべて削除する（スライド自体は削除しない） */
  deleteSelection(): void {
    const els = this.movableSelection();
    if (els.length === 0) return;
    for (const el of els) el.remove();
    this.select(null);
    this.commit();
  }

  // ---- 整列 ----

  /** 選択中の要素をスライドに対して整列する */
  alignToSlide(cmd: AlignCommand): void {
    const slide = this.activeSlide();
    const els = this.movableSelection();
    if (!slide || els.length === 0) return;
    this.alignToRect(els, slide.getBoundingClientRect(), cmd);
  }

  /** 複数選択した要素同士を、選択全体の外接矩形を基準に整列する */
  alignSelection(cmd: AlignCommand): void {
    const els = this.movableSelection();
    if (els.length < 2) return;
    const rects = els.map((el) => el.getBoundingClientRect());
    this.alignToRect(els, {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }, cmd);
  }

  private alignToRect(
    els: StylableElement[],
    ref: { left: number; right: number; top: number; bottom: number },
    cmd: AlignCommand
  ): void {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      switch (cmd) {
        case "left":
          dx = ref.left - r.left;
          break;
        case "hcenter":
          dx = (ref.left + ref.right) / 2 - (r.left + r.right) / 2;
          break;
        case "right":
          dx = ref.right - r.right;
          break;
        case "top":
          dy = ref.top - r.top;
          break;
        case "vcenter":
          dy = (ref.top + ref.bottom) / 2 - (r.top + r.bottom) / 2;
          break;
        case "bottom":
          dy = ref.bottom - r.bottom;
          break;
      }
      dx = Math.round(dx);
      dy = Math.round(dy);
      if (dx === 0 && dy === 0) continue;
      const base = this.captureTransformBase(el);
      this.applyTranslate(el, base, dx, dy);
    }
    this.commit();
  }

  // ---- リサイズ（オーバーレイのハンドルから呼ばれる） ----

  beginResize(): ResizeStart | null {
    if (this.selection.length !== 1) return null; // リサイズは単一選択時のみ
    const el = this.selected;
    if (!el || el === this.activeSlide()) return null;
    const rect = el.getBoundingClientRect();
    const base = this.captureTransformBase(el);
    const isImage = ["IMG", "VIDEO", "CANVAS", "SVG", "svg", "PICTURE"].includes(el.tagName);
    // テキストを含む要素は、角ハンドルで文字サイズを連動スケールさせる（Canva 方式）
    const fontScale = !isImage && (el.textContent ?? "").trim().length > 0;
    const fonts: Array<{ el: StylableElement; size: number }> = [];
    if (fontScale) {
      const targets = [el, ...Array.from(el.querySelectorAll<StylableElement>("*"))].slice(0, 300);
      for (const t of targets) {
        if (!t.style) continue;
        const cs = this.getComputed(t);
        const size = cs ? parseFloat(cs.fontSize) : NaN;
        if (!Number.isNaN(size)) fonts.push({ el: t, size });
      }
    }
    this.resizeStart = {
      width: rect.width,
      height: rect.height,
      baseTransform: base.baseTransform,
      baseDx: base.baseDx,
      baseDy: base.baseDy,
      fontScale,
      fonts,
      inlineHeight: el.style.height,
      isImage,
    };
    return this.resizeStart;
  }

  private applyShift(el: StylableElement, start: ResizeStart, shiftX: number, shiftY: number): void {
    const ds = (el as HTMLElement).dataset;
    const nx = start.baseDx + shiftX;
    const ny = start.baseDy + shiftY;
    ds.hseDx = String(nx);
    ds.hseDy = String(ny);
    const translate = `translate(${Math.round(nx)}px, ${Math.round(ny)}px)`;
    el.style.transform = start.baseTransform ? `${start.baseTransform} ${translate}` : translate;
  }

  applyResize(handle: string, dx: number, dy: number, keepRatio: boolean): void {
    const el = this.selected;
    const start = this.resizeStart;
    if (!el || !start) return;

    const isCorner = handle.length === 2;

    let dw = 0;
    let dh = 0;
    if (handle.includes("e")) dw = dx;
    if (handle.includes("w")) dw = -dx;
    if (handle.includes("s")) dh = dy;
    if (handle.includes("n")) dh = -dy;

    // --- テキスト要素の角ハンドル: 文字サイズを比例スケール ---
    if (isCorner && start.fontScale && start.width > 0) {
      const factor = Math.min(20, Math.max(0.05, (start.width + dw) / start.width));
      const newWidth = Math.max(16, Math.round(start.width * factor));
      el.style.width = `${newWidth}px`;
      for (const { el: target, size } of start.fonts) {
        target.style.fontSize = `${Math.max(4, size * factor).toFixed(1)}px`;
      }
      // 高さが明示されていた場合だけ比例させる（それ以外は文字に追従して自動）
      if (start.inlineHeight) el.style.height = `${Math.round(start.height * factor)}px`;

      // 西・北の角は反対側の角を固定する
      const shiftX = handle.includes("w") ? start.width - newWidth : 0;
      const shiftY = handle.includes("n") ? Math.round(start.height * (1 - factor)) : 0;
      if (shiftX !== 0 || shiftY !== 0) this.applyShift(el, start, shiftX, shiftY);
      this.onOverlay();
      return;
    }

    // --- 通常のボックスリサイズ（画像・辺ハンドルなど） ---
    const lockRatio = keepRatio || (isCorner && start.isImage);
    let width = Math.max(16, start.width + dw);
    let height = Math.max(16, start.height + dh);
    if (lockRatio && start.width > 0 && start.height > 0) {
      const ratio = start.width / start.height;
      if (Math.abs(dw) >= Math.abs(dh)) height = width / ratio;
      else width = height * ratio;
    }

    if (isCorner || handle === "e" || handle === "w") el.style.width = `${Math.round(width)}px`;
    if (isCorner || handle === "n" || handle === "s") el.style.height = `${Math.round(height)}px`;

    const shiftX = handle.includes("w") ? start.width - width : 0;
    const shiftY = handle.includes("n") ? start.height - height : 0;
    if (shiftX !== 0 || shiftY !== 0) this.applyShift(el, start, shiftX, shiftY);
    this.onOverlay();
  }

  endResize(): void {
    if (!this.resizeStart) return;
    this.resizeStart = null;
    this.commit();
  }

  // ---- テキスト編集 ----

  private handleDblClick(ev: MouseEvent): void {
    const el = this.pick(ev.target);
    if (!el) return;
    this.tryStartTextEdit(el);
  }

  /** テキストを持つ要素なら編集を開始する（画像・SVG は対象外） */
  private tryStartTextEdit(el: StylableElement): boolean {
    if ((el.textContent ?? "").trim() === "") return false;
    if (el.tagName === "IMG" || el.tagName.toLowerCase() === "svg") return false;
    this.startEditing(el);
    return true;
  }

  startEditing(el: StylableElement): void {
    if (this.editingEl === el) return;
    this.finishEditing();
    this.editingEl = el;
    this.editingOriginalHtml = el.innerHTML;
    el.setAttribute("contenteditable", "true");
    (el as HTMLElement).focus();
    // フォーカスが外れたら編集を確定（iPad ではこれが主な終了経路になる）
    el.addEventListener("blur", () => this.finishEditing(), { once: true });
    this.select(el);
    this.onOverlay();
  }

  finishEditing(): void {
    const el = this.editingEl;
    if (!el) return;
    this.editingEl = null;
    el.removeAttribute("contenteditable");
    if (el.innerHTML !== this.editingOriginalHtml) this.commit();
    else this.onOverlay();
  }

  // ---- キーボード ----

  handleKeyDown(ev: KeyboardEvent): void {
    const meta = ev.metaKey || ev.ctrlKey;
    const key = ev.key;

    if (meta && key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (meta && key.toLowerCase() === "s") {
      ev.preventDefault();
      void this.save();
      return;
    }
    if (this.editingEl) {
      if (key === "Escape") this.finishEditing();
      return;
    }
    if (key === "Escape") {
      this.select(null);
      return;
    }
    if ((key === "Delete" || key === "Backspace") && this.selection.length > 0) {
      if (this.movableSelection().length > 0) {
        ev.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    const step = ev.shiftKey ? 10 : 1;
    if (key === "ArrowLeft") {
      ev.preventDefault();
      this.nudge(-step, 0);
    } else if (key === "ArrowRight") {
      ev.preventDefault();
      this.nudge(step, 0);
    } else if (key === "ArrowUp") {
      ev.preventDefault();
      this.nudge(0, -step);
    } else if (key === "ArrowDown") {
      ev.preventDefault();
      this.nudge(0, step);
    }
  }

  // ---- スタイル適用（プロパティパネルから） ----

  /** ライブプレビュー用（履歴に積まない） */
  applyStyleTransient(prop: string, value: string | null): void {
    const el = this.selected;
    if (!el) return;
    if (value == null || value === "") el.style.removeProperty(prop);
    else el.style.setProperty(prop, value);
    this.onOverlay();
  }

  /** 確定（履歴に積む） */
  applyStyle(prop: string, value: string | null): void {
    this.applyStyleTransient(prop, value);
    this.commit();
  }

  /** フォント適用。Web フォントは <link> をドキュメント本体に注入（保存後も有効） */
  applyFontFamily(family: string, webfontUrl?: string): void {
    const doc = this.doc;
    const el = this.selected;
    if (!doc || !el) return;
    if (webfontUrl && !doc.querySelector(`link[href="${webfontUrl}"]`)) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = webfontUrl;
      doc.head.appendChild(link);
    }
    el.style.fontFamily = family;
    this.commit();
  }

  getComputed(el: Element): CSSStyleDeclaration | null {
    return this.doc?.defaultView?.getComputedStyle(el) ?? null;
  }

  // ---- テーマ（色の一括置換） ----

  /** 一括置換を確定し、リセット用に操作を記録する */
  recordThemeOp(targets: string[], newHex: string): void {
    this.themeOps.push({ targets, newHex });
  }

  /**
   * テーマを読み込み時の色に戻す。記録した置換操作を逆順に巻き戻す。
   * （近似色をまとめて置換していた場合は代表色に戻る）
   */
  resetTheme(): void {
    if (!this.doc || this.themeOps.length === 0) return;
    for (let i = this.themeOps.length - 1; i >= 0; i--) {
      const op = this.themeOps[i];
      replaceColorEverywhere(this.doc, [op.newHex], op.targets[0]);
    }
    this.themeOps = [];
    this.commit();
  }

  // ---- 画像 ----

  async insertImageFromFile(file: File): Promise<void> {
    const dataUrl = await readAsDataUrl(file);
    this.insertImage(dataUrl);
  }

  insertImage(dataUrl: string): void {
    const doc = this.doc;
    const slide = this.activeSlide();
    if (!doc || !slide) return;
    const cs = this.getComputed(slide);
    if (cs && cs.position === "static") slide.style.position = "relative";
    const img = doc.createElement("img");
    img.src = dataUrl;
    img.alt = "";
    img.style.position = "absolute";
    img.style.left = "30%";
    img.style.top = "25%";
    img.style.width = "40%";
    img.style.height = "auto";
    slide.appendChild(img);
    this.select(img);
    this.commit();
  }

  async replaceSelectedImage(file: File): Promise<void> {
    const el = this.selected;
    if (!el || el.tagName !== "IMG") return;
    (el as HTMLImageElement).src = await readAsDataUrl(file);
    this.commit();
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
