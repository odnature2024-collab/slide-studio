// Undo/Redo 用のスナップショット履歴（HTML 文字列を保持）

const MAX_ENTRIES = 60;

export class SnapshotHistory {
  private stack: string[] = [];
  private index = -1;

  /** 履歴を初期状態にリセットし、最初のスナップショットを積む */
  reset(initial: string): void {
    this.stack = [initial];
    this.index = 0;
  }

  /** 新しいスナップショットを積む（現在位置より先の redo 履歴は破棄） */
  push(snapshot: string): void {
    if (this.index >= 0 && this.stack[this.index] === snapshot) return; // 変化なし
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snapshot);
    if (this.stack.length > MAX_ENTRIES) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  undo(): string | null {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return this.stack[this.index];
  }

  redo(): string | null {
    if (!this.canRedo()) return null;
    this.index += 1;
    return this.stack[this.index];
  }

  current(): string | null {
    return this.index >= 0 ? this.stack[this.index] : null;
  }
}
