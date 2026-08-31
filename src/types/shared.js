/**
 * Helpers shared by every element type.
 *
 * The render context (ctx) that each type receives:
 *   ctx.S(x, y)        document units -> screen px, y is up in the document
 *   ctx.L(length)      a document length -> px
 *   ctx.scale          px per document unit
 *   ctx.byId(id)       another element, for a reference such as a link end
 *   ctx.arrow(color)   registers an arrowhead marker, returns url(#id)
 *   ctx.hatch(color)   registers a hatch pattern, returns url(#id)
 *   ctx.mapper(axesId) returns { toDoc(dataX, dataY), axes } for a plot
 *   ctx.text(src, o)   a math label as an SVG <text>
 *
 * The TikZ context:
 *   ctx.P(x, y)        "(1.5,2)" in document units, y is up
 *   ctx.color(hex)     registers a colour, returns its TikZ name
 *   ctx.opts(element)  "draw=cA, line width=0.5pt, dashed"
 *   ctx.math(src)      "$...$"
 *   ctx.byId(id)
 *   ctx.mapper(axesId)
 */

import { dashArray, anchorsOf } from '../registry.js';
import { DEG, round } from '../dom.js';

/** SVG stroke attributes from the common stroke fields. */
/**
 * How much to shrink a pixel measurement so the screen previews the export.
 *
 * A stroke width and a font size are pixel values, so at a lower zoom they
 * stayed the same size while the geometry shrank: text at 30 px/unit looked a
 * third larger against the drawing than in the export, which always renders at
 * EXPORT_SCALE. buildContext sets this once per render pass.
 *
 * It is module state because strokeAttrs is called from a hundred places with
 * no render context to hand. Renders are synchronous and never interleave, so
 * the value is always the one for the pass in progress.
 */
let previewZoom = 1;

export function setPreviewZoom(factor) {
  previewZoom = Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** A pixel measurement, shrunk for the preview but never to nothing. */
export function px(value, floor = 0.6) {
  return Math.max(floor, (Number(value) || 0) * previewZoom);
}

export function strokeAttrs(element, overrides = {}) {
  const width = element.strokeWidth ?? 2;
  const merged = {
    stroke: element.color || '#1f2937',
    'stroke-width': width,
    'stroke-dasharray': dashArray(element.style, width),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    fill: 'none',
    ...overrides,
  };
  // Scale whatever width survived the overrides, and the dashes with it.
  if (merged['stroke-width'] !== null && merged['stroke-width'] !== undefined) {
    const scaled = px(merged['stroke-width']);
    merged['stroke-width'] = round(scaled, 3);
    if (merged['stroke-dasharray']) {
      merged['stroke-dasharray'] = String(merged['stroke-dasharray'])
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((part) => round(Math.max(0.2, Number(part) * previewZoom), 3))
        .join(' ');
    }
  }
  return merged;
}

/** Parses "0,0 1.5,2 3,1" into [{x, y}, ...]. */
export function parsePoints(source) {
  return String(source || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
    });
}

/** Serialises points back to the compact string form. */
export function formatPoints(points) {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

/** The end point of a vector given a tail, a length and an angle in degrees. */
export function tip(x, y, magnitude, angleDeg) {
  return {
    x: x + magnitude * Math.cos(angleDeg * DEG),
    y: y + magnitude * Math.sin(angleDeg * DEG),
  };
}

/** The angle in degrees from one point to another. */
export function angleBetween(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) / DEG;
}

/** The distance between two points. */
export function distance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * A label position beside a segment.
 * side is 'left', 'right' or 'above' relative to the direction of travel.
 */
export function besideSegment(from, to, side, gap = 0.35) {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const length = distance(from, to) || 1;
  const normalX = -(to.y - from.y) / length;
  const normalY = (to.x - from.x) / length;
  const sign = side === 'right' ? -1 : 1;
  if (side === 'centre') return { x: midX, y: midY };
  return { x: midX + normalX * gap * sign, y: midY + normalY * gap * sign };
}

/** A rectangle's corner points, rotated about its centre. */
export function rectCorners(cx, cy, width, height, angleDeg = 0) {
  const half = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ];
  const cos = Math.cos(angleDeg * DEG);
  const sin = Math.sin(angleDeg * DEG);
  return half.map((point) => ({
    x: cx + point.x * cos - point.y * sin,
    y: cy + point.x * sin + point.y * cos,
  }));
}

/**
 * The point where a ray from the centre of a rectangle leaves its border.
 * The schematic link type uses it so an arrow stops at the box edge.
 */
export function rectBorderPoint(cx, cy, width, height, towardX, towardY) {
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx === 0 ? Infinity : (width / 2) / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : (height / 2) / Math.abs(dy);
  const factor = Math.min(scaleX, scaleY);
  return { x: cx + dx * factor, y: cy + dy * factor };
}

/** Common TikZ line options for an element with the stroke fields. */
export function tikzStroke(element, ctx, extra = []) {
  const options = [`draw=${ctx.color(element.color || '#1f2937')}`];
  const width = element.strokeWidth ?? 2;
  options.push(`line width=${(width * 0.4).toFixed(2)}pt`);
  if (element.style === 'dashed') options.push('dashed');
  if (element.style === 'dotted') options.push('dotted');
  return options.concat(extra).filter(Boolean).join(', ');
}

/** The standard set of stroke-only schema fields plus a label. */
export const SIDES = ['left', 'right', 'centre'];

/**
 * A size grip for a box drawn around its centre.
 * Without one the only way to resize is to type two numbers.
 */
/**
 * Where a shape's own label sits, in document units.
 *
 * A free-body diagram puts every force at the centre of mass, so a label drawn
 * dead centre competes with every arrow tail for one point and nothing can
 * separate them. labelPlace names an anchor instead; the label sits most of
 * the way toward it, which keeps it inside the shape.
 */
export function labelPointOf(element, lookup) {
  const centre = { x: element.x, y: element.y };
  const place = element.labelPlace || 'center';
  if (place === 'center') return centre;

  const { anchors } = anchorsOf(element, lookup);
  const target = anchors.find((entry) => entry.name === place);
  if (!target) return centre;

  return {
    x: centre.x + (target.x - centre.x) * LABEL_INSET,
    y: centre.y + (target.y - centre.y) * LABEL_INSET,
  };
}

/** How far toward the named anchor a label sits. Short of the edge. */
const LABEL_INSET = 0.58;

export function centreBoxHandle(element, min = 0.2) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
    set: (point) => ({
      width: Math.max(min, round((point.x - element.x) * 2, 2)),
      height: Math.max(min, round((point.y - element.y) * 2, 2)),
    }),
  };
}

/** A size grip for a box whose x,y is its bottom left corner. */
export function cornerBoxHandle(element, min = 0.5) {
  return {
    x: element.x + element.width,
    y: element.y + element.height,
    set: (point) => ({
      width: Math.max(min, round(point.x - element.x, 2)),
      height: Math.max(min, round(point.y - element.y, 2)),
    }),
  };
}
