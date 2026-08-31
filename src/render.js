/**
 * The SVG renderer.
 *
 * The document uses mathematical coordinates: the origin sits at the bottom
 * left and y grows upward. The screen uses SVG coordinates, where y grows
 * downward. One function, S(), maps between them. No SVG transform flips the
 * canvas, because a flip would mirror every text label.
 */

import { svg, round, clamp, DEG } from './dom.js';
import { getType } from './registry.js';
import { mathText, measureText } from './mathtext.js';
import { axesMapper } from './types/plots.js';
import { setPreviewZoom } from './types/shared.js';

const MARGIN = 24;        // px of padding around the document box
const TEXT_PAD = 3;      // px of breathing room a label keeps from the sheet edge
const HALO = '#ffffff';  // the sheet is white in every theme, so this is safe

/**
 * The pixels-per-unit that every export renders at, whatever the screen zoom.
 *
 * Label sizes and line widths are pixel values, so a sheet rendered at a lower
 * zoom carries relatively larger text. Following view.scale would let the zoom
 * buttons silently restyle every SVG, PNG and TikZ dot radius. The exports pin
 * this constant instead, and the zoom stays a pure view control.
 */
export const EXPORT_SCALE = 40;
const ROTATE_RADIUS = 34; // px from the anchor to the rotation grip
const GRIP_CLEARANCE = 16; // px two grips need before both can be grabbed

/**
 * Every render gets its own marker namespace.
 *
 * Several SVGs share one page — the canvas and forty-eight palette icons — and
 * a url(#id) reference resolves against the whole document, not the enclosing
 * SVG. Numbering markers from zero in each render meant the canvas arrows
 * pointed at a palette icon's marker and took its colour.
 */
let renderSeq = 0;

/**
 * Elements whose render() threw during the last pass.
 *
 * renderDocument has always caught a per-element failure and carried on, which
 * is right: one broken shape should not blank the sheet. But it only warned to
 * the console, so four curves once vanished from a figure while the audit
 * reported it clean. A failure a caller cannot see is a failure they cannot
 * fix.
 */
let lastFailures = [];

export function renderFailures() {
  return lastFailures.slice();
}

/** Builds the render context for one pass. */
export function buildContext(doc, view, defs, margin = MARGIN, previewScale = true) {
  const scale = view.scale;
  // 1 when rendering at the export scale, so an export is unchanged. Palette
  // icons render at a fitted scale and opt out, or their strokes would fade.
  const zoom = previewScale ? scale / EXPORT_SCALE : 1;
  setPreviewZoom(zoom);
  const height = doc.canvas.height * scale + margin * 2;
  const fullWidth = doc.canvas.width * scale + margin * 2;

  const S = (x, y) => ({
    x: round(margin + x * scale, 2),
    y: round(height - margin - y * scale, 2),
  });

  const byId = (id) => doc.elements.find((element) => element.id === id) || null;

  // One arrowhead serves both ends. "auto-start-reverse" already flips a
  // marker-start, so a separately reversed path would flip it back and the
  // arrow would vanish into the line — which is what happened to the
  // dimension type's start tip.
  const namespace = ++renderSeq;
  const markers = new Map();
  const ensureMarker = (color) => {
    if (markers.has(color)) return markers.get(color);
    const id = `arrow-${namespace}-${markers.size}`;
    defs.append(svg('marker', {
      id,
      viewBox: '0 0 9 6',
      refX: 8.5,
      refY: 3,
      markerWidth: 6,
      markerHeight: 5,
      orient: 'auto-start-reverse',
      markerUnits: 'strokeWidth',
    }, [svg('path', { d: 'M0,0 L0,6 L9,3 Z', fill: color })]));
    const url = `url(#${id})`;
    markers.set(color, url);
    return url;
  };

  // The inverse of S. The pointer handling needs it.
  const D = (screenX, screenY) => ({
    x: (screenX - margin) / scale,
    y: (height - margin - screenY) / scale,
  });

  return {
    S,
    D,
    L: (length) => round(length * scale, 2),
    scale,
    doc,
    byId,
    arrow: (color) => ensureMarker(color || '#1f2937'),
    arrowBack: (color) => ensureMarker(color || '#1f2937'),
    mapper: (axesId) => axesMapper(byId(axesId)),
    // Labels are placed by each type at a point that suits the shape, which
    // for a curve is its last sample. When that sits near the edge the text
    // ran off the sheet and the export cut it in half. Nudge it back inside
    // rather than let it escape; the anchor is kept so the type's intent
    // survives. Rotated text is left alone, since its box is not axis aligned.
    text: (source, options = {}) => {
      // Scaled first, so the clamp measures the text that will actually draw.
      const size = Math.max(6, (Number(options.size) || 14) * zoom);
      const anchor = options.anchor || 'middle';
      let x = Number(options.x) || 0;
      let y = Number(options.y) || 0;

      if (!options.rotate) {
        const w = measureText(source, size);
        const leftOf = (at) => (anchor === 'start' ? at : anchor === 'end' ? at - w : at - w / 2);

        const spill = leftOf(x) + w - (fullWidth - TEXT_PAD);
        if (spill > 0) x -= spill;
        const short = TEXT_PAD - leftOf(x);
        if (short > 0) x += short;

        const half = size * 0.6;
        y = clamp(y, TEXT_PAD + half, height - TEXT_PAD - half);
      }

      return mathText(source, { halo: HALO, ...options, x, y, size });
    },
    zoom,
    width: fullWidth,
    height,
  };
}

/**
 * Draws the background grid in document units.
 *
 * Graph paper, not a mesh: every fifth line is drawn darker. A fine grid
 * without that hierarchy reads as noise and you lose the sense of scale, which
 * is the whole reason for having a grid.
 */
function gridLayer(doc, ctx) {
  const layer = svg('g', { 'data-layer': 'grid' });
  const step = doc.canvas.grid;
  if (!doc.canvas.showGrid || !(step > 0)) return layer;

  const minor = { stroke: 'var(--grid)', 'stroke-width': 1 };
  const major = { stroke: 'var(--grid-major)', 'stroke-width': 1 };
  const isMajor = (value) => Math.abs(value / (step * 5) - Math.round(value / (step * 5))) < 1e-6;

  // A very fine grid at a low zoom turns solid, so minor lines drop out once
  // they would sit closer than four pixels apart.
  const showMinor = step * ctx.scale >= 4;

  for (let x = 0; x <= doc.canvas.width + 1e-9; x += step) {
    const heavy = isMajor(x);
    if (!heavy && !showMinor) continue;
    const a = ctx.S(x, 0);
    const b = ctx.S(x, doc.canvas.height);
    layer.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(heavy ? major : minor) }));
  }
  for (let y = 0; y <= doc.canvas.height + 1e-9; y += step) {
    const heavy = isMajor(y);
    if (!heavy && !showMinor) continue;
    const a = ctx.S(0, y);
    const b = ctx.S(doc.canvas.width, y);
    layer.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(heavy ? major : minor) }));
  }
  return layer;
}

/**
 * Renders the document into a fresh <svg>.
 * options: { selection: string[], interactive: boolean, background: string }
 */
export function renderDocument(doc, view, options = {}) {
  const {
    selection = [], interactive = true, background = null, margin,
    previewScale = true,
  } = options;

  const defs = svg('defs');
  const ctx = buildContext(doc, view, defs, margin, previewScale);

  const root = svg('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: ctx.width,
    height: ctx.height,
    viewBox: `0 0 ${ctx.width} ${ctx.height}`,
    'font-family': 'Georgia, "Times New Roman", serif',
  }, [defs]);

  if (background) {
    root.append(svg('rect', { x: 0, y: 0, width: ctx.width, height: ctx.height, fill: background }));
  }

  if (interactive) root.append(gridLayer(doc, ctx));

  const content = svg('g', { 'data-layer': 'content' });
  const failures = [];
  for (const element of doc.elements) {
    let node;
    try {
      node = getType(element.type).render(element, ctx);
    } catch (error) {
      console.warn(`render failed for ${element.id}`, error);
      failures.push({ id: element.id, type: element.type, reason: error?.message || String(error) });
      continue;
    }
    node.setAttribute('data-id', element.id);
    node.setAttribute('class', selection.includes(element.id) ? 'element is-selected' : 'element');
    content.append(node);
  }
  root.append(content);

  if (interactive) root.append(sheetHandles(doc, ctx));

  if (interactive && selection.length) {
    root.append(handleLayer(doc, ctx, selection));
  }

  lastFailures = failures;
  return { root, ctx };
}

/**
 * Grips for resizing the sheet itself, on every edge and every corner.
 *
 * The document origin is the bottom left corner. Growing from the top or the
 * right simply adds space. Growing from the bottom or the left would put the
 * origin somewhere new, so the interaction layer shifts every shape by the
 * same amount and the drawing stays exactly where it was.
 */
function sheetHandles(doc, ctx) {
  const layer = svg('g', { 'data-layer': 'sheet' });
  const { width, height } = doc.canvas;
  const half = { x: width / 2, y: height / 2 };

  const grips = [
    { at: ctx.S(width, half.y), edge: 'e', w: 5, h: 26 },
    { at: ctx.S(0, half.y), edge: 'w', w: 5, h: 26 },
    { at: ctx.S(half.x, height), edge: 'n', w: 26, h: 5 },
    { at: ctx.S(half.x, 0), edge: 's', w: 26, h: 5 },
    { at: ctx.S(width, height), edge: 'ne', w: 9, h: 9 },
    { at: ctx.S(0, height), edge: 'nw', w: 9, h: 9 },
    { at: ctx.S(width, 0), edge: 'se', w: 9, h: 9 },
    { at: ctx.S(0, 0), edge: 'sw', w: 9, h: 9 },
  ];

  for (const grip of grips) {
    layer.append(svg('rect', {
      x: round(grip.at.x - grip.w / 2, 2),
      y: round(grip.at.y - grip.h / 2, 2),
      width: grip.w,
      height: grip.h,
      rx: 2,
      class: `sheet-grip sheet-grip-${grip.edge}`,
      'data-canvas-handle': grip.edge,
    }));
  }

  return layer;
}

/** The name a type gives its rotation, or nothing when it has none. */
export function rotationField(type) {
  return ['angle', 'rotate'].find((name) => Object.hasOwn(type.schema.properties, name)) || null;
}

/** Draws the drag handles for the current selection. */
function handleLayer(doc, ctx, selection) {
  const layer = svg('g', { 'data-layer': 'handles' });

  for (const id of selection) {
    const element = doc.elements.find((item) => item.id === id);
    if (!element) continue;
    const type = getType(element.type);

    const anchor = type.anchor(element, ctx.byId);
    if (anchor) {
      const point = ctx.S(anchor.x, anchor.y);
      layer.append(svg('circle', {
        cx: point.x, cy: point.y, r: 5,
        class: 'handle handle-anchor',
        'data-handle': 'anchor',
        'data-id': id,
      }));
    }

    const handlePoints = [];
    if (typeof type.handles === 'function') {
      const handles = type.handles(element, ctx.byId) || [];
      handles.forEach((handle, index) => {
        const point = ctx.S(handle.x, handle.y);
        handlePoints.push(point);
        layer.append(svg('rect', {
          x: point.x - 5, y: point.y - 5, width: 10, height: 10,
          class: 'handle handle-point',
          'data-handle': String(index),
          'data-id': id,
        }));
      });
    }

    // Anything with a rotation field gets a grip, at a fixed screen distance
    // so it stays reachable however small the shape is. The field is not
    // always called "angle": a label calls it "rotate", and keying only off
    // "angle" left the label rotatable by typing but not by dragging.
    const spin = rotationField(type);
    if (anchor && spin) {
      const centre = ctx.S(anchor.x, anchor.y);
      const radians = (element[spin] || 0) * DEG;
      const along = (radius) => ({
        x: centre.x + Math.cos(radians) * radius,
        y: centre.y - Math.sin(radians) * radius,
      });

      // A resize handle can land on the grip at some zooms. A shape puts one
      // at width/2 units, which is 36px at 30px/unit against the fixed 34px,
      // and the two grips then hide each other. The grip steps outward past
      // the obstruction. The radius only grows, so the loop terminates.
      let radius = ROTATE_RADIUS;
      for (let pass = 0; pass <= handlePoints.length; pass++) {
        const trial = along(radius);
        const clash = handlePoints.find(
          (point) => Math.hypot(point.x - trial.x, point.y - trial.y) < GRIP_CLEARANCE,
        );
        if (!clash) break;
        radius = Math.max(
          radius,
          Math.hypot(clash.x - centre.x, clash.y - centre.y) + GRIP_CLEARANCE,
        );
      }
      const grip = along(radius);
      layer.append(svg('line', {
        x1: centre.x, y1: centre.y, x2: grip.x, y2: grip.y,
        class: 'handle-arm',
      }));
      layer.append(svg('circle', {
        cx: grip.x, cy: grip.y, r: 5,
        class: 'handle handle-rotate',
        'data-handle': 'rotate',
        'data-field': spin,
        'data-id': id,
      }));
    }
  }

  return layer;
}
