import { Position, type InternalNode, type Node } from "@xyflow/react";

/**
 * Geometry for "floating" edges — connections that attach to the nearest point on
 * a block's border rather than to a fixed handle.
 *
 * Without this, an edge created without an explicit handle snaps to whichever
 * handle is declared first and loops around the card to reach it. On a research
 * board most connections are made by the assistant, which has no view of handles
 * and should not need one, so edges have to route themselves sensibly.
 */

/** Point where the line from this node's centre toward `target` crosses this node's border. */
function nodeIntersection(node: InternalNode<Node>, target: InternalNode<Node>) {
  const w = (node.measured?.width ?? 0) / 2;
  const h = (node.measured?.height ?? 0) / 2;
  const nx = node.internals.positionAbsolute.x + w;
  const ny = node.internals.positionAbsolute.y + h;
  const tx = target.internals.positionAbsolute.x + (target.measured?.width ?? 0) / 2;
  const ty = target.internals.positionAbsolute.y + (target.measured?.height ?? 0) / 2;

  if (w === 0 || h === 0) return { x: nx, y: ny };

  // Rectangle-border intersection in normalised space, then mapped back.
  const xx = (tx - nx) / (2 * w) - (ty - ny) / (2 * h);
  const yy = (tx - nx) / (2 * w) + (ty - ny) / (2 * h);
  const denom = Math.abs(xx) + Math.abs(yy);
  if (denom === 0) return { x: nx, y: ny };
  const a = 1 / denom;
  const x3 = a * xx;
  const y3 = a * yy;
  return { x: w * (x3 + y3) + nx, y: h * (-x3 + y3) + ny };
}

/** Which side the intersection landed on — drives the bezier control-point direction. */
function edgeSide(node: InternalNode<Node>, point: { x: number; y: number }): Position {
  const nx = Math.round(node.internals.positionAbsolute.x);
  const ny = Math.round(node.internals.positionAbsolute.y);
  const px = Math.round(point.x);
  const py = Math.round(point.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + (node.measured?.width ?? 0) - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  return Position.Bottom;
}

export function getFloatingEdgeParams(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sourcePoint = nodeIntersection(source, target);
  const targetPoint = nodeIntersection(target, source);
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: edgeSide(source, sourcePoint),
    targetPos: edgeSide(target, targetPoint),
  };
}
