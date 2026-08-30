import { describe, expect, it } from "vitest";
import { inkBounds, outputSize, sketchSvg } from "./render";
import { emptyBoard, type Block, type Board, type InkStroke } from "../types";

/**
 * The picture is the assistant's only access to freehand ink, and it is not
 * something anyone reviews before it goes out. A stroke rendered outside the
 * viewBox, or a block whose id is missing from its caption, produces a confident
 * description of the wrong thing — which is worse than reporting nothing, because
 * the count in the board view at least admitted to knowing nothing.
 */

function stroke(points: Array<[number, number]>, id = "s1"): InkStroke {
  return { id, points: points.map(([x, y]) => [x, y, 0.5]), color: "#e5484d", size: 6 };
}

function note(id: string, x: number, y: number, title: string): Block {
  return {
    id,
    type: "note",
    position: { x, y },
    width: 200,
    height: 120,
    data: { title, body: "" },
  } as Block;
}

function boardWith(ink: InkStroke[], nodes: Block[] = []): Board {
  return { ...emptyBoard(), ink, nodes };
}

describe("inkBounds", () => {
  it("is null with no ink", () => {
    expect(inkBounds([])).toBeNull();
    expect(inkBounds([stroke([])])).toBeNull();
  });

  it("covers every point, with padding around it", () => {
    const r = inkBounds([stroke([[100, 100], [200, 300]])], 10)!;
    expect(r.x).toBe(90);
    expect(r.y).toBe(90);
    expect(r.x + r.width).toBe(210);
    expect(r.y + r.height).toBe(310);
  });

  it("spans every stroke, not just the first", () => {
    const r = inkBounds([stroke([[0, 0]], "a"), stroke([[500, 400]], "b")], 0)!;
    expect(r.width).toBe(500);
    expect(r.height).toBe(400);
  });

  it("never produces a zero-sized region", () => {
    // A single tap is one point. A zero-width viewBox renders nothing at all,
    // and the model would be shown a blank image of a drawing that exists.
    const r = inkBounds([stroke([[50, 50]])], 0)!;
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it("handles negative coordinates, which an infinite canvas has", () => {
    const r = inkBounds([stroke([[-300, -200], [-100, -100]])], 0)!;
    expect(r.x).toBe(-300);
    expect(r.width).toBe(200);
  });
});

describe("outputSize", () => {
  it("caps the longest side", () => {
    const s = outputSize({ x: 0, y: 0, width: 4000, height: 2000 }, 1024);
    expect(s.width).toBe(1024);
    expect(s.height).toBe(512);
  });

  it("never upscales a small sketch", () => {
    const s = outputSize({ x: 0, y: 0, width: 300, height: 200 }, 1024);
    expect(s).toEqual({ width: 300, height: 200 });
  });

  it("stays at least one pixel on a sliver", () => {
    const s = outputSize({ x: 0, y: 0, width: 4000, height: 1 }, 1024);
    expect(s.height).toBeGreaterThanOrEqual(1);
  });
});

describe("sketchSvg", () => {
  const region = { x: 0, y: 0, width: 400, height: 300 };

  it("carries a viewBox matching the region, so nothing is cropped", () => {
    const svg = sketchSvg(boardWith([stroke([[10, 10], [50, 50], [90, 20]])]), region);
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("draws the ink", () => {
    const svg = sketchSvg(boardWith([stroke([[10, 10], [50, 50], [90, 20], [120, 60]])]), region);
    expect(svg).toContain("<path");
    expect(svg).toContain("#e5484d");
  });

  it("paints an opaque background", () => {
    // A transparent PNG composites onto black in some viewers, and dark ink on
    // black is not a picture of anything.
    expect(sketchSvg(boardWith([stroke([[10, 10], [50, 50]])]), region)).toContain('fill="#ffffff"');
  });

  it("includes nearby blocks, captioned with the id the model must quote back", () => {
    // An arrow drawn between two cards is *about* those cards. Rendered alone it
    // is a diagonal line, and the model would describe a diagonal line.
    const svg = sketchSvg(
      boardWith([stroke([[10, 10], [200, 200]])], [note("n1", 20, 20, "Redis")]),
      region,
    );
    expect(svg).toContain("n1 · Redis");
    expect(svg).toContain("<rect");
  });

  it("leaves out blocks far from the drawing", () => {
    const svg = sketchSvg(
      boardWith([stroke([[10, 10], [50, 50]])], [note("far", 5000, 5000, "Unrelated")]),
      region,
    );
    expect(svg).not.toContain("Unrelated");
  });

  it("escapes markup in a title rather than emitting it", () => {
    // Block titles are user text. Unescaped, a stray angle bracket produces
    // malformed SVG and the whole render fails rather than one caption.
    const svg = sketchSvg(
      boardWith([stroke([[10, 10], [50, 50]])], [note("n1", 20, 20, '<script>&"x"')]),
      region,
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("truncates a very long title instead of overrunning the picture", () => {
    const svg = sketchSvg(
      boardWith([stroke([[10, 10], [50, 50]])], [note("n1", 20, 20, "x".repeat(300))]),
      region,
    );
    expect(svg).toContain("…");
    expect(svg).not.toContain("x".repeat(60));
  });

  it("still renders when there is no ink to draw", () => {
    // Reachable if every stroke is too short to produce an outline.
    const svg = sketchSvg(boardWith([stroke([[10, 10]])]), region);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
