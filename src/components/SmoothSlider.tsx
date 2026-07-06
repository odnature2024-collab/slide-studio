// レイテンシ対策スライダー。
// - ドラッグ中は内部状態で即応（算出スタイルに縛られて指の動きから遅れない）
// - 値の適用は requestAnimationFrame で1フレーム1回に間引く（iframe の過剰な再計算を防ぐ）
// - 指を離したときに確定（履歴へ）

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** ドラッグ中の連続適用（間引き済み） */
  onInput: (value: number) => void;
  /** 指を離したときの確定 */
  onCommit: () => void;
  title?: string;
}

export default function SmoothSlider({
  value,
  min,
  max,
  step = 1,
  onInput,
  onCommit,
  title,
}: Props) {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  // 外から値が変わったら同期（ドラッグ中は指の値を優先）
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const flush = () => {
    rafRef.current = 0;
    if (pendingRef.current != null) {
      onInput(pendingRef.current);
      pendingRef.current = null;
    }
  };

  const handleChange = (v: number) => {
    setLocal(v);
    pendingRef.current = v;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
  };

  const finish = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (pendingRef.current != null) {
      onInput(pendingRef.current);
      pendingRef.current = null;
    }
    onCommit();
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={local}
      title={title}
      onPointerDown={() => (draggingRef.current = true)}
      onChange={(e) => handleChange(parseFloat(e.target.value))}
      onPointerUp={finish}
      onPointerCancel={finish}
      onBlur={finish}
    />
  );
}
