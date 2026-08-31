/** Further plot types: parametric curve, polar curve, scatter series. */

import { svg, round, clamp } from '../dom.js';
import { defineType, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, parsePoints } from './shared.js';
import { axesMapper } from './plots.js';
import { compile } from '../expr.js';

/** Splits a run of data points wherever a point is missing or off the axes. */
function toPieces(points, axes) {
  const pieces = [];
  let current = [];

  for (const point of points) {
    const usable = point
      && Number.isFinite(point.dataX) && Number.isFinite(point.dataY)
      && (!axes || (
        point.dataX >= axes.xMin && point.dataX <= axes.xMax
        && point.dataY >= axes.yMin && point.dataY <= axes.yMax));

    if (!usable) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    current.push(point.at);
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/** Draws the pieces of a sampled curve, plus a label at the last point. */
function renderPieces(pieces, element, ctx) {
  const group = svg('g');
  for (const piece of pieces) {
    const screen = piece.map((point) => ctx.S(point.x, point.y));
    group.append(svg('path', {
      d: screen.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' '),
      ...strokeAttrs(element),
    }));
  }
  if (element.label && pieces.length) {
    const last = pieces[pieces.length - 1];
    const point = ctx.S(last[last.length - 1].x, last[last.length - 1].y);
    group.append(ctx.text(element.label, {
      x: point.x + 10, y: point.y - 10, anchor: 'start',
      size: element.labelSize, color: element.color,
    }));
  }
  return group;
}

/** Emits the pieces as TikZ, thinned so the source stays readable. */
function tikzPieces(pieces, element, ctx) {
  const options = tikzStroke(element, ctx);
  return pieces.map((piece) => {
    const step = Math.max(1, Math.floor(piece.length / 120));
    const kept = piece.filter((_, index) => index % step === 0 || index === piece.length - 1);
    return `\\draw[${options}] plot coordinates {${
      kept.map((point) => ctx.P(point.x, point.y)).join(' ')}};`;
  });
}

/** A warning marker when an expression will not compile. */
function errorNote(message, element, ctx, axes) {
  const group = svg('g');
  const spot = axes ? ctx.S(axes.x, axes.y + axes.height) : ctx.S(0, 0);
  group.append(ctx.text(`⚠ ${message}`, {
    x: spot.x, y: spot.y - 14, anchor: 'start', size: 12, color: '#b91c1c',
  }));
  return group;
}

/* --------------------------- parametric -------------------------- */

function sampleParametric(element, axes) {
  const x = compile(element.xExpression, 't');
  if (x.error) return { pieces: [], error: `x(t): ${x.error}` };
  const y = compile(element.yExpression, 't');
  if (y.error) return { pieces: [], error: `y(t): ${y.error}` };

  const map = axesMapper(axes).toDoc;
  const count = Math.max(2, Math.min(4000, element.samples));
  const step = (element.tMax - element.tMin) / (count - 1);
  const points = [];

  for (let index = 0; index < count; index++) {
    const t = element.tMin + index * step;
    const dataX = x.fn(t);
    const dataY = y.fn(t);
    points.push({ dataX, dataY, at: map(dataX, dataY) });
  }
  return { pieces: toPieces(points, axes), error: null };
}

defineType({
  name: 'parametric',
  label: 'Parametric curve',
  group: 'Plots',
  hint: 'Plots x(t) and y(t). Use it for a circle, an ellipse, a spiral or a Lissajous figure.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes this curve belongs to.', default: '' },
      xExpression: { type: 'string', format: 'expression', description: 'The x coordinate as an expression in t, for example 2*cos(t).', default: '2*cos(t)' },
      yExpression: { type: 'string', format: 'expression', description: 'The y coordinate as an expression in t, for example 2*sin(t).', default: '2*sin(t)' },
      tMin: { type: 'number', description: 'The lowest value of t.', default: 0 },
      tMax: { type: 'number', description: 'The highest value of t. Use 6.2832 for one full turn.', default: 6.2832 },
      samples: { type: 'number', description: 'The number of sample points.', default: 240, minimum: 2, maximum: 4000 },
      ...STROKE,
      ...LABEL,
    },
    required: ['xExpression', 'yExpression', 'tMin', 'tMax'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axes ? { x: axes.x, y: axes.y + axes.height } : { x: 0, y: 0 };
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId,
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = sampleParametric(element, axes);
    if (error) return errorNote(error, element, ctx, axes);
    return renderPieces(pieces, element, ctx);
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = sampleParametric(element, axes);
    if (error) return [`% parametric "${element.id}": ${error}`];
    return tikzPieces(pieces, element, ctx);
  },
});

/* ------------------------------ polar ---------------------------- */

function samplePolar(element, axes) {
  const radius = compile(element.rExpression, 't');
  if (radius.error) return { pieces: [], error: `r(t): ${radius.error}` };

  const map = axesMapper(axes).toDoc;
  const count = Math.max(2, Math.min(4000, element.samples));
  const step = (element.tMax - element.tMin) / (count - 1);
  const points = [];

  for (let index = 0; index < count; index++) {
    const theta = element.tMin + index * step;
    const value = radius.fn(theta);
    const dataX = value * Math.cos(theta);
    const dataY = value * Math.sin(theta);
    points.push({ dataX, dataY, at: map(dataX, dataY) });
  }
  return { pieces: toPieces(points, axes), error: null };
}

defineType({
  name: 'polar',
  label: 'Polar curve',
  group: 'Plots',
  hint: 'Plots r as a function of the angle t in radians. Use it for a rose, a cardioid or a spiral.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes this curve belongs to.', default: '' },
      rExpression: { type: 'string', format: 'expression', description: 'The radius as an expression in t, for example 2*cos(3*t).', default: '2*cos(3*t)' },
      tMin: { type: 'number', description: 'The lowest angle in radians.', default: 0 },
      tMax: { type: 'number', description: 'The highest angle in radians. Use 6.2832 for one full turn.', default: 6.2832 },
      samples: { type: 'number', description: 'The number of sample points.', default: 360, minimum: 2, maximum: 4000 },
      ...STROKE,
      ...LABEL,
    },
    required: ['rExpression', 'tMin', 'tMax'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axes ? { x: axes.x, y: axes.y + axes.height } : { x: 0, y: 0 };
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId,
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = samplePolar(element, axes);
    if (error) return errorNote(error, element, ctx, axes);
    return renderPieces(pieces, element, ctx);
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { pieces, error } = samplePolar(element, axes);
    if (error) return [`% polar "${element.id}": ${error}`];
    return tikzPieces(pieces, element, ctx);
  },
});

/* ----------------------------- scatter --------------------------- */

defineType({
  name: 'scatter',
  label: 'Data series',
  group: 'Plots',
  hint: 'Plots measured points from a list. Optionally joins them with a line.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes.', default: '' },
      data: {
        type: 'string', format: 'points',
        description: 'The points as "x,y x,y x,y" in data units.',
        default: '0,0 1,0.8 2,1.9 3,2.7 4,4.1',
      },
      shape: { type: 'string', enum: ['dot', 'circle', 'cross', 'square', 'none'], description: 'The marker shape.', default: 'dot' },
      size: { type: 'number', description: 'The marker size in px.', default: 4, minimum: 0.5, maximum: 30 },
      connect: { type: 'boolean', description: 'Join the points with a line.', default: false },
      ...STROKE,
      ...LABEL,
    },
    required: ['data'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    const points = parsePoints(element.data);
    const first = points[0] || { x: 0, y: 0 };
    return axesMapper(axes).toDoc(first.x, first.y);
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId,
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const map = axesMapper(axes).toDoc;
    const points = parsePoints(element.data)
      .map((point) => map(point.x, point.y))
      .map((point) => ctx.S(point.x, point.y));

    const group = svg('g');
    if (!points.length) return group;

    if (element.connect && points.length > 1) {
      group.append(svg('path', {
        d: points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
        ...strokeAttrs(element),
      }));
    }

    const size = element.size;
    for (const point of points) {
      if (element.shape === 'none') break;
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
    }

    if (element.label) {
      const last = points[points.length - 1];
      group.append(ctx.text(element.label, {
        x: last.x + 10, y: last.y - 10, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const map = axesMapper(axes).toDoc;
    const points = parsePoints(element.data).map((point) => map(point.x, point.y));
    if (!points.length) return [];

    const lines = [];
    if (element.connect && points.length > 1) {
      lines.push(`\\draw[${tikzStroke(element, ctx)}] ${
        points.map((point) => ctx.P(point.x, point.y)).join(' -- ')};`);
    }
    if (element.shape !== 'none') {
      const options = tikzStroke(element, ctx, [`fill=${ctx.color(element.color)}`]);
      for (const point of points) {
        lines.push(`\\filldraw[${options}] ${ctx.P(point.x, point.y)} circle (${ctx.px(element.size)});`);
      }
    }
    if (element.label) {
      const last = points[points.length - 1];
      lines.push(`\\node[above right] at ${ctx.P(last.x, last.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});
