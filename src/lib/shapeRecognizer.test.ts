import { describe, it, expect } from "vitest";
import { recognizeShape, pathLength, type Pt } from "./shapeRecognizer";

/** 疑似乱数（テストを決定的にする） */
function makeRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

describe("recognizeShape — 直線", () => {
  it("手ブレ入りのほぼ水平な線を、完全な水平線にスナップする", () => {
    const rnd = makeRandom(1);
    const pts: Pt[] = [];
    for (let i = 0; i <= 50; i++) {
      // 2°弱の傾き＋±3px の揺れ
      pts.push({ x: 100 + i * 4, y: 300 + i * 0.12 + rnd() * 6 });
    }
    const shape = recognizeShape(pts);
    expect(shape).not.toBeNull();
    // 全点が始点の y に一致（水平スナップ）
    const ys = shape!.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    // 端点はほぼ維持される
    expect(Math.abs(shape![0].x - 100)).toBeLessThan(1);
    expect(Math.abs(shape![shape!.length - 1].x - 300)).toBeLessThan(3);
  });

  it("斜め45°付近の線は45°にスナップする", () => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 5, y: i * 5.2 });
    const shape = recognizeShape(pts)!;
    const a = shape[0];
    const b = shape[shape.length - 1];
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    expect(Math.abs(angle - 45)).toBeLessThan(0.01);
  });
});

describe("recognizeShape — 円", () => {
  it("手ブレ入りの円を綺麗な円にする", () => {
    const rnd = makeRandom(7);
    const pts: Pt[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 1.97; // わずかに閉じきらない
      pts.push({ x: 400 + Math.cos(t) * (80 + rnd() * 8), y: 300 + Math.sin(t) * (80 + rnd() * 8) });
    }
    const shape = recognizeShape(pts)!;
    expect(shape).not.toBeNull();
    // 全点が中心から一定距離（円）
    for (const p of shape) {
      const r = Math.hypot(p.x - 400, p.y - 300);
      expect(Math.abs(r - 80)).toBeLessThan(6);
    }
  });
});

describe("recognizeShape — 多角形", () => {
  const traceEdges = (corners: Pt[], noise: () => number): Pt[] => {
    const pts: Pt[] = [];
    const nodes = [...corners, corners[0]];
    for (let i = 0; i < nodes.length - 1; i++) {
      for (let s = 0; s < 20; s++) {
        const t = s / 20;
        pts.push({
          x: nodes[i].x + (nodes[i + 1].x - nodes[i].x) * t + noise() * 5,
          y: nodes[i].y + (nodes[i + 1].y - nodes[i].y) * t + noise() * 5,
        });
      }
    }
    pts.push({ x: corners[0].x + 4, y: corners[0].y + 4 }); // ほぼ閉じる
    return pts;
  };

  it("三角形を認識して閉じた3角形にする", () => {
    const corners = [
      { x: 300, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 },
    ];
    const shape = recognizeShape(traceEdges(corners, makeRandom(3)))!;
    expect(shape).not.toBeNull();
    // 各頂点の近くを通る＆閉じている
    for (const c of corners) {
      const near = shape.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 12);
      expect(near).toBe(true);
    }
    const first = shape[0];
    const last = shape[shape.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1);
  });

  it("ほぼ軸平行の四角形は長方形にスナップする", () => {
    const corners = [
      { x: 100, y: 100 },
      { x: 400, y: 108 },
      { x: 405, y: 300 },
      { x: 98, y: 295 },
    ];
    const shape = recognizeShape(traceEdges(corners, makeRandom(9)))!;
    expect(shape).not.toBeNull();
    // 長方形なら x, y ともに2種類の値しか（ほぼ）持たない
    const xs = [...new Set(shape.map((p) => Math.round(p.x / 8)))];
    const ys = [...new Set(shape.map((p) => Math.round(p.y / 8)))];
    // 辺上の点も含むので、値域の端（min/max）に集中していることを確認
    const bbW = Math.max(...shape.map((p) => p.x)) - Math.min(...shape.map((p) => p.x));
    const bbH = Math.max(...shape.map((p) => p.y)) - Math.min(...shape.map((p) => p.y));
    expect(bbW).toBeGreaterThan(280);
    expect(bbH).toBeGreaterThan(180);
    expect(xs.length).toBeGreaterThan(2); // 辺の点列がある
    expect(ys.length).toBeGreaterThan(2);
  });
});

describe("recognizeShape — 認識しないケース", () => {
  it("短すぎるストロークは null", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 2 },
      { x: 6, y: 1 },
      { x: 9, y: 3 },
      { x: 12, y: 0 },
      { x: 15, y: 2 },
      { x: 18, y: 1 },
      { x: 20, y: 2 },
    ];
    expect(recognizeShape(pts)).toBeNull();
    expect(pathLength(pts)).toBeLessThan(40);
  });

  it("複雑な走り書きは null（元の線を残す）", () => {
    const rnd = makeRandom(5);
    const pts: Pt[] = [];
    let x = 200;
    let y = 200;
    for (let i = 0; i < 120; i++) {
      x += rnd() * 60;
      y += rnd() * 60;
      pts.push({ x, y });
    }
    expect(recognizeShape(pts)).toBeNull();
  });
});
