/** Function plot types: axes, curve, marker, area. */

import { svg, round, clamp, DEG } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, cornerBoxHandle } from './shared.js';
import { compile } from '../expr.js';

/**
 * Builds the data-to-document mapping for an axes element.
 * The axes x,y is the bottom left corner of the plot box.
 */
/**
 * A tick label. In "pi" mode the number is written as a multiple of pi, which
 * is what a trigonometric plot wants: 3.1416 and 6.2832 on an axis are numbers
 * a reader has to decode.
 */
export function tickLabel(value, unit) {
  if (unit !== 'pi') return String(round(value, 6));

  const share = value / Math.PI;
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // Halves, thirds and quarters cover every axis a course will draw.
  for (const denominator of [1, 2, 3, 4, 6]) {
    const scaled = share * denominator;
    if (!near(scaled, Math.round(scaled))) continue;
    const numerator = Math.round(scaled);
    if (numerator === 0) return '0';

    const sign = numerator < 0 ? '-' : '';
    const size = Math.abs(numerator);
    const head = size === 1 ? '\\pi' : `${size}\\pi`;
    return denominator === 1 ? `${sign}${head}` : `${sign}${head}/${denominator}`;
  }
  return String(round(value, 4));
}

export function axesMapper(axes) {
  if (!axes) {
    return { axes: null, toDoc: (dataX, dataY) => ({ x: dataX, y: dataY }) };
  }
  const spanX = (axes.xMax - axes.xMin) || 1;
  const spanY = (axes.yMax - axes.yMin) || 1;
  return {
    axes,
    toDoc: (dataX, dataY) => ({
      x: axes.x + ((dataX - axes.xMin) / spanX) * axes.width,
      y: axes.y + ((dataY - axes.yMin) / spanY) * axes.height,
    }),
  };
}

/** Ticks at a step, aligned to zero, inside a range. */
function ticksFor(min, max, step) {
  if (!(step > 0)) return [];
  const values = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + step * 1e-6 && values.length < 200; value += step) {
    values.push(round(value, 6));
  }
  return values;
}

/* ------------------------------ axes ----------------------------- */

defineType({
  name: 'axes',
  label: 'Plot axes',
  group: 'Plots',
  hint: 'A Cartesian frame. A curve, a marker or an area attaches to it by id.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      width: { type: 'number', description: 'The box width in diagram units.', default: 8, minimum: 0.5 },
      height: { type: 'number', description: 'The box height in diagram units.', default: 6, minimum: 0.5 },
      xMin: { type: 'number', description: 'The lowest x value.', default: -4 },
      xMax: { type: 'number', description: 'The highest x value.', default: 4 },
      yMin: { type: 'number', description: 'The lowest y value.', default: -2 },
      yMax: { type: 'number', description: 'The highest y value.', default: 4 },
      tickX: { type: 'number', description: 'The x tick step. Use 0 for no ticks.', default: 1, minimum: 0 },
      tickUnit: { type: 'string', enum: ['number', 'pi'], description: 'How tick numbers read. "pi" labels them as multiples of pi, which is what a trigonometric plot wants.', default: 'number' },
      tickY: { type: 'number', description: 'The y tick step. Use 0 for no ticks.', default: 1, minimum: 0 },
      showGrid: { type: 'boolean', description: 'Draw a grid inside the box.', default: false },
      xLabel: { type: 'string', description: 'The x axis label.', default: 'x' },
      yLabel: { type: 'string', description: 'The y axis label.', default: 'y' },
      ...STROKE,
    },
    required: ['x', 'y', 'width', 'height'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [cornerBoxHandle(element, 0.5)],
  render(element, ctx) {
    const map = axesMapper(element).toDoc;
    const group = svg('g');
    const paint = strokeAttrs(element);
    const thin = strokeAttrs(element, {
      'stroke-width': 1,
      'stroke-opacity': 0.25,
      'stroke-dasharray': null,
    });

    const zeroX = clamp(0, element.xMin, element.xMax);
    const zeroY = clamp(0, element.yMin, element.yMax);
    const at = (dataX, dataY) => {
      const point = map(dataX, dataY);
      return ctx.S(point.x, point.y);
    };

    if (element.showGrid) {
      for (const value of ticksFor(element.xMin, element.xMax, element.tickX)) {
        const a = at(value, element.yMin);
        const b = at(value, element.yMax);
        group.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...thin }));
      }
      for (const value of ticksFor(element.yMin, element.yMax, element.tickY)) {
        const a = at(element.xMin, value);
        const b = at(element.xMax, value);
        group.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...thin }));
      }
    }

    // The two axis lines, drawn at data zero when zero sits inside the range.
    const xStart = map(element.xMin, zeroY);
    const xEnd = map(element.xMax, zeroY);
    const yStart = map(zeroX, element.yMin);
    const yEnd = map(zeroX, element.yMax);
    const xa = ctx.S(xStart.x, xStart.y);
    const xb = ctx.S(xEnd.x, xEnd.y);
    const ya = ctx.S(yStart.x, yStart.y);
    const yb = ctx.S(yEnd.x, yEnd.y);

    group.append(svg('line', { x1: xa.x, y1: xa.y, x2: xb.x, y2: xb.y, ...paint, 'marker-end': ctx.arrow(element.color) }));
    group.append(svg('line', { x1: ya.x, y1: ya.y, x2: yb.x, y2: yb.y, ...paint, 'marker-end': ctx.arrow(element.color) }));

    // Ticks and their numbers.
    for (const value of ticksFor(element.xMin, element.xMax, element.tickX)) {
      if (value === 0) continue;
      const point = at(value, zeroY);
      group.append(svg('line', { x1: point.x, y1: point.y - 4, x2: point.x, y2: point.y + 4, ...paint }));
      group.append(ctx.text(tickLabel(value, element.tickUnit), {
        x: point.x, y: point.y + 16, size: 11, color: element.color, baseline: 'hanging',
      }));
    }
    for (const value of ticksFor(element.yMin, element.yMax, element.tickY)) {
      if (value === 0) continue;
      const point = at(zeroX, value);
      group.append(svg('line', { x1: point.x - 4, y1: point.y, x2: point.x + 4, y2: point.y, ...paint }));
      group.append(ctx.text(tickLabel(value, element.tickUnit), {
        x: point.x - 10, y: point.y, size: 11, color: element.color, anchor: 'end',
      }));
    }

    if (element.xLabel) {
      group.append(ctx.text(element.xLabel, { x: xb.x + 16, y: xb.y, size: 15, color: element.color }));
    }
    if (element.yLabel) {
      group.append(ctx.text(element.yLabel, { x: yb.x, y: yb.y - 16, size: 15, color: element.color }));
    }
    return group;
  },
  tikz(element, ctx) {
    const map = axesMapper(element).toDoc;
    const zeroX = clamp(0, element.xMin, element.xMax);
    const zeroY = clamp(0, element.yMin, element.yMax);
    const options = tikzStroke(element, ctx, ['->', '>=stealth']);
    const lines = [];

    const xStart = map(element.xMin, zeroY);
    const xEnd = map(element.xMax, zeroY);
    const yStart = map(zeroX, element.yMin);
    const yEnd = map(zeroX, element.yMax);

    lines.push(
      `\\draw[${options}] ${ctx.P(xStart.x, xStart.y)} -- ${ctx.P(xEnd.x, xEnd.y)} ` +
      `node[right] {${ctx.math(element.xLabel)}};`,
    );
    lines.push(
      `\\draw[${options}] ${ctx.P(yStart.x, yStart.y)} -- ${ctx.P(yEnd.x, yEnd.y)} ` +
      `node[above] {${ctx.math(element.yLabel)}};`,
    );

    for (const value of ticksFor(element.xMin, element.xMax, element.tickX)) {
      if (value === 0) continue;
      const at = map(value, zeroY);
      lines.push(
        `\\draw[${tikzStroke(element, ctx)}] ${ctx.P(at.x, at.y)} ++(0,-0.08) -- ++(0,0.16) ` +
        `node[below=4pt] {\\footnotesize $${value}$};`,
      );
    }
    for (const value of ticksFor(element.yMin, element.yMax, element.tickY)) {
      if (value === 0) continue;
      const at = map(zeroX, value);
      lines.push(
        `\\draw[${tikzStroke(element, ctx)}] ${ctx.P(at.x, at.y)} ++(-0.08,0) -- ++(0.16,0) ` +
        `node[left=4pt] {\\footnotesize $${value}$};`,
      );
    }
    return lines;
  },
});

/* ------------------------------ curve ---------------------------- */

/** Samples an expression and splits it where it leaves the box or goes wild. */
/**
 * A point on a curve, in document units.
 *
 * The caller works in data coordinates, which is the only frame the curve's
 * expression is written in. Returning document units keeps the axis mapping
 * where it belongs.
 */
export function curvePoint(element, axes, dataX) {
  const { fn } = compile(element.expression, 'x');
  if (!fn) return null;
  const dataY = fn(dataX);
  if (!Number.isFinite(dataY)) return null;
  return axesMapper(axes).toDoc(dataX, dataY);
}

/**
 * The unit tangent to a curve at a data x, in document units.
 *
 * This is not the data slope. Axes rarely have the same scale on both
 * directions, so a data slope of 1 does not draw at 45 degrees: with 1.208
 * document units per unit of x and 1.939 per unit of y it draws at 58.1. A
 * velocity arrow set to 45 degrees therefore left the trajectory it was meant
 * to be tangent to, by thirteen degrees.
 */
export function curveTangent(element, axes, dataX) {
  const span = Math.abs(Number(element.to) - Number(element.from)) || 1;
  const h = span * 1e-4;
  const before = curvePoint(element, axes, dataX - h);
  const after = curvePoint(element, axes, dataX + h);
  if (!before || !after) return null;
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return { x: dx / length, y: dy / length };
}

function sampleCurve(element, axes) {
  const { fn, error } = compile(element.expression, 'x');
  if (!fn) return { pieces: [], error };

  const map = axesMapper(axes).toDoc;
  const from = element.from;
  const to = element.to;
  const count = Math.max(2, Math.min(2000, element.samples));
  const step = (to - from) / (count - 1);

  const pieces = [];
  let current = [];

  for (let index = 0; index < count; index++) {
    const dataX = from + index * step;
    const dataY = fn(dataX);
    const inRange = Number.isFinite(dataY)
      && (!axes || (dataY >= axes.yMin && dataY <= axes.yMax));

    if (!inRange) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    current.push(map(dataX, dataY));
  }
  if (current.length > 1) pieces.push(current);

  return { pieces, error: null };
}

defineType({
  name: 'curve',
  label: 'Function curve',
  group: 'Plots',
  hint: 'Plots y = f(x). The parser is safe: it never calls eval.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes this curve belongs to.', default: '' },
      expression: { type: 'string', format: 'expression', description: 'An expression in x, for example sin(x)/x or x^2-1.', default: 'sin(x)' },
      from: { type: 'number', description: 'The lowest x to sample.', default: -4 },
      to: { type: 'number', description: 'The highest x to sample.', default: 4 },
      samples: { type: 'number', description: 'The number of sample points.', default: 240, minimum: 2, maximum: 2000 },
      head: { type: 'string', enum: ['none', 'end', 'middle'], description: 'An arrowhead showing which way the curve runs. A cycle needs one.', default: 'none' },
      ...STROKE,
      ...LABEL,
    },
    required: ['expression', 'from', 'to'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axes ? { x: axes.x, y: axes.y + axes.height } : { x: 0, y: 0 };
  },
  // A curve had no anchors at all, so nothing could be attached to one. These
  // are its own ends and midpoint, in document units.
  anchors(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    const from = Number(element.from);
    const to = Number(element.to);
    const spots = [
      ['start', from], ['middle', (from + to) / 2], ['end', to],
    ];
    const list = [];
    for (const [name, dataX] of spots) {
      const point = curvePoint(element, axes, dataX);
      if (point) list.push({ name, x: point.x, y: point.y, description: `Curve at x = ${round(dataX, 3)}.` });
    }
    const along = curveTangent(element, axes, (from + to) / 2);
    return { anchors: list, along: along || { x: 1, y: 0 } };
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId, // A curve follows its axes. Move the axes instead.
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = sampleCurve(element, axes);
    const group = svg('g');

    if (error) {
      const spot = axes ? ctx.S(axes.x, axes.y + axes.height) : ctx.S(0, 0);
      group.append(ctx.text(`⚠ ${error}`, {
        x: spot.x, y: spot.y - 14, anchor: 'start', size: 12, color: '#b91c1c',
      }));
      return group;
    }

    for (const piece of pieces) {
      const screen = piece.map((point) => ctx.S(point.x, point.y));
      group.append(svg('path', {
        d: screen.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' '),
        ...strokeAttrs(element),
      }));
    }

    // Direction. A cycle or a trajectory is meaningless without it.
    if (element.head && element.head !== 'none') {
      for (const piece of pieces) {
        if (piece.length < 2) continue;
        const spot = element.head === 'end'
          ? piece.length - 1
          : Math.max(1, Math.floor(piece.length / 2));
        // sampleCurve works in document units; a transform needs screen px.
        // Placing the head at the document coordinate put it outside the sheet
        // and, because it lives in the curve's own group, dragged the curve's
        // bounding box out with it.
        const from = ctx.S(piece[spot - 1].x, piece[spot - 1].y);
        const to = ctx.S(piece[spot].x, piece[spot].y);
        const heading = Math.atan2(to.y - from.y, to.x - from.x) / DEG;
        const size = Math.max(5, (element.strokeWidth ?? 2) * 3.4);
        group.append(svg('path', {
          d: `M${-size} ${-size * 0.5} L0 0 L${-size} ${size * 0.5}`,
          transform: `translate(${to.x} ${to.y}) rotate(${heading})`,
          fill: 'none',
          ...strokeAttrs(element, { 'stroke-dasharray': null, 'stroke-linejoin': 'round' }),
        }));
        if (element.head === 'end') break;
      }
    }

    if (element.label && pieces.length) {
      const lastPiece = pieces[pieces.length - 1];
      const last = lastPiece[lastPiece.length - 1];
      const spot = ctx.S(last.x, last.y);
      group.append(ctx.text(element.label, {
        x: spot.x + 10, y: spot.y - 10, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = sampleCurve(element, axes);
    if (error) return [`% curve "${element.id}" has an invalid expression: ${error}`];

    const options = tikzStroke(element, ctx);
    return pieces.map((piece) => {
      // Thin the points so the TikZ source stays readable.
      const step = Math.max(1, Math.floor(piece.length / 120));
      const kept = piece.filter((_, index) => index % step === 0 || index === piece.length - 1);
      return `\\draw[${options}] plot coordinates {${
        kept.map((point) => ctx.P(point.x, point.y)).join(' ')
      }};`;
    });
  },
});

/* ----------------------------- marker ---------------------------- */

defineType({
  name: 'marker',
  label: 'Data point',
  group: 'Plots',
  hint: 'A marked point at a data coordinate on an axes.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes.', default: '' },
      dataX: { type: 'number', description: 'The x value in data units.', default: 1 },
      dataY: { type: 'number', description: 'The y value in data units.', default: 1 },
      shape: { type: 'string', enum: ['dot', 'circle', 'cross', 'square'], description: 'The marker shape.', default: 'dot' },
      size: { type: 'number', description: 'The marker size in px.', default: 5, minimum: 1, maximum: 30 },
      showGuides: { type: 'boolean', description: 'Draw dashed guides to both axes.', default: false },
      ...STROKE,
      ...LABEL,
    },
    required: ['dataX', 'dataY'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axesMapper(axes).toDoc(element.dataX, element.dataY);
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId, // Edit the data values in the panel instead.
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const map = axesMapper(axes).toDoc;
    const at = map(element.dataX, element.dataY);
    const point = ctx.S(at.x, at.y);
    const group = svg('g');
    const size = element.size;

    if (element.showGuides && axes) {
      const onX = map(element.dataX, Math.max(axes.yMin, Math.min(0, axes.yMax)));
      const onY = map(Math.max(axes.xMin, Math.min(0, axes.xMax)), element.dataY);
      const a = ctx.S(onX.x, onX.y);
      const b = ctx.S(onY.x, onY.y);
      const guide = strokeAttrs(element, { 'stroke-dasharray': '4 3', 'stroke-opacity': 0.6, 'stroke-width': 1 });
      group.append(svg('line', { x1: point.x, y1: point.y, x2: a.x, y2: a.y, ...guide }));
      group.append(svg('line', { x1: point.x, y1: point.y, x2: b.x, y2: b.y, ...guide }));
    }

    if (element.shape === 'cross') {
      const paint = strokeAttrs(element);
      group.append(svg('line', { x1: point.x - size, y1: point.y - size, x2: point.x + size, y2: point.y + size, ...paint }));
      group.append(svg('line', { x1: point.x - size, y1: point.y + size, x2: point.x + size, y2: point.y - size, ...paint }));
    } else if (element.shape === 'square') {
      group.append(svg('rect', {
        x: point.x - size, y: point.y - size, width: size * 2, height: size * 2,
        ...strokeAttrs(element, { fill: element.color }),
      }));
    } else {
      group.append(svg('circle', {
        cx: point.x, cy: point.y, r: size,
        ...strokeAttrs(element, { fill: element.shape === 'dot' ? element.color : '#ffffff' }),
      }));
    }

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: point.x + size + 6, y: point.y - size - 4, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const at = axesMapper(axes).toDoc(element.dataX, element.dataY);
    const options = tikzStroke(element, ctx, [`fill=${ctx.color(element.color)}`]);
    // ctx.px converts a screen size to document units, which scale= then honours.
    const lines = [`\\filldraw[${options}] ${ctx.P(at.x, at.y)} circle (${ctx.px(element.size)});`];
    if (element.label) {
      lines.push(`\\node[above right] at ${ctx.P(at.x, at.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ area ----------------------------- */

defineType({
  name: 'area',
  label: 'Shaded area',
  group: 'Plots',
  hint: 'Shades the region between a curve and the x axis.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes.', default: '' },
      expression: { type: 'string', format: 'expression', description: 'The upper edge of the band, as an expression in x.', default: 'sin(x)' },
      lowerExpression: { type: 'string', format: 'expression', description: 'The lower edge, as an expression in x. Leave empty to fill down to the axis.', default: '' },
      from: { type: 'number', description: 'The left edge of the region.', default: 0 },
      to: { type: 'number', description: 'The right edge of the region.', default: 3 },
      samples: { type: 'number', description: 'The number of sample points.', default: 120, minimum: 2, maximum: 2000 },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#2563eb' },
      fillOpacity: { type: 'number', description: 'The fill opacity from 0 to 1.', default: 0.2, minimum: 0, maximum: 1 },
      ...LABEL,
    },
    required: ['expression', 'from', 'to'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axesMapper(axes).toDoc((element.from + element.to) / 2, 0);
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId,
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { fn, error } = compile(element.expression, 'x');
    if (error) return svg('g');

    const map = axesMapper(axes).toDoc;
    const baseline = axes ? clamp(0, axes.yMin, axes.yMax) : 0;
    const count = Math.max(2, Math.min(2000, element.samples));
    const step = (element.to - element.from) / (count - 1);

    // A second expression makes the band lie between two curves, which is the
    // commonest integral figure there is. Without it the fill always dropped
    // to the axis, so the region between f and g could not be drawn at all.
    const lower = element.lowerExpression
      ? compile(element.lowerExpression, 'x').fn
      : null;

    const top = [];
    const bottom = [];

    for (let index = 0; index < count; index++) {
      const dataX = element.from + index * step;
      let dataY = fn(dataX);
      if (!Number.isFinite(dataY)) continue;
      let floorY = lower ? lower(dataX) : baseline;
      if (!Number.isFinite(floorY)) continue;
      if (axes) {
        dataY = clamp(dataY, axes.yMin, axes.yMax);
        floorY = clamp(floorY, axes.yMin, axes.yMax);
      }
      top.push(map(dataX, dataY));
      bottom.push(map(dataX, floorY));
    }
    if (top.length < 2) return svg('g');

    const path = [...top, ...bottom.reverse()].map((point) => ctx.S(point.x, point.y));

    const group = svg('g');
    group.append(svg('path', {
      d: path.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' ') + ' Z',
      fill: element.fill,
      'fill-opacity': element.fillOpacity,
      stroke: 'none',
    }));

    if (element.label) {
      const middle = map((element.from + element.to) / 2, baseline);
      const spot = ctx.S(middle.x, middle.y);
      group.append(ctx.text(element.label, {
        x: spot.x, y: spot.y - 18, size: element.labelSize, color: element.fill,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { fn, error } = compile(element.expression, 'x');
    if (error) return [`% area "${element.id}" has an invalid expression: ${error}`];

    const map = axesMapper(axes).toDoc;
    const baseline = axes ? clamp(0, axes.yMin, axes.yMax) : 0;
    const count = Math.min(120, Math.max(2, element.samples));
    const step = (element.to - element.from) / (count - 1);
    const points = [];

    for (let index = 0; index < count; index++) {
      const dataX = element.from + index * step;
      let dataY = fn(dataX);
      if (!Number.isFinite(dataY)) continue;
      if (axes) dataY = clamp(dataY, axes.yMin, axes.yMax);
      const at = map(dataX, dataY);
      points.push(ctx.P(at.x, at.y));
    }
    if (points.length < 2) return [];

    const start = map(element.from, baseline);
    const end = map(element.to, baseline);
    return [
      `\\fill[${ctx.color(element.fill)}, opacity=${element.fillOpacity}] ` +
      `${ctx.P(start.x, start.y)} -- ${points.join(' -- ')} -- ${ctx.P(end.x, end.y)} -- cycle;`,
    ];
  },
});
