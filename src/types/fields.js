/** Fields and waves: vector field, point charge, wave train. */

import { svg, DEG, round } from '../dom.js';
import { MATH_FONT } from '../mathtext.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, tip } from './shared.js';
import { axesMapper } from './plots.js';
import { compile } from '../expr.js';

/* -------------------------- vector field ------------------------- */

/** One arrow per grid point, in document units. */
function fieldArrows(element, axes) {
  const u = compile(element.uExpression, ['x', 'y']);
  if (u.error) return { arrows: [], error: `u(x,y): ${u.error}` };
  const v = compile(element.vExpression, ['x', 'y']);
  if (v.error) return { arrows: [], error: `v(x,y): ${v.error}` };

  const map = axesMapper(axes).toDoc;
  const xMin = axes ? axes.xMin : element.xMin;
  const xMax = axes ? axes.xMax : element.xMax;
  const yMin = axes ? axes.yMin : element.yMin;
  const yMax = axes ? axes.yMax : element.yMax;

  const columns = Math.max(2, Math.min(40, Math.round(element.columns)));
  const rows = Math.max(2, Math.min(40, Math.round(element.rows)));
  const arrows = [];
  let longest = 0;

  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const dataX = xMin + ((column + 0.5) / columns) * (xMax - xMin);
      const dataY = yMin + ((row + 0.5) / rows) * (yMax - yMin);
      const dx = u.fn(dataX, dataY);
      const dy = v.fn(dataX, dataY);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;

      const magnitude = Math.hypot(dx, dy);
      if (magnitude > longest) longest = magnitude;
      arrows.push({ dataX, dataY, dx, dy, magnitude });
    }
  }

  // One grid cell, measured in DATA units. The tip is worked out in data space
  // and mapped afterwards; adding a data vector to an already-mapped point
  // would only be right when one data unit happens to equal one document unit.
  const cell = Math.min((xMax - xMin) / columns, (yMax - yMin) / rows);
  const full = cell * element.arrowScale;

  for (const arrow of arrows) {
    const factor = element.normalise
      ? (arrow.magnitude === 0 ? 0 : full / arrow.magnitude)
      : (longest === 0 ? 0 : full / longest);
    arrow.base = map(arrow.dataX, arrow.dataY);
    arrow.tipPoint = map(arrow.dataX + arrow.dx * factor, arrow.dataY + arrow.dy * factor);
  }

  return { arrows, error: null, longest };
}

defineType({
  name: 'vector-field',
  label: 'Vector field',
  group: 'Fields',
  hint: 'A grid of arrows from u(x,y) and v(x,y). Use it for a force, a flow or an electric field.',
  schema: {
    type: 'object',
    properties: {
      axesId: { type: 'string', format: 'elementRef', description: 'The id of the axes. It supplies the range.', default: '' },
      uExpression: { type: 'string', format: 'expression', description: 'The x component as an expression in x and y.', default: '-y' },
      vExpression: { type: 'string', format: 'expression', description: 'The y component as an expression in x and y.', default: 'x' },
      columns: { type: 'number', description: 'The number of arrows across.', default: 9, minimum: 2, maximum: 40 },
      rows: { type: 'number', description: 'The number of arrows up.', default: 9, minimum: 2, maximum: 40 },
      arrowScale: { type: 'number', description: 'The arrow length as a fraction of one grid cell.', default: 0.8, minimum: 0.05, maximum: 3 },
      normalise: { type: 'boolean', description: 'Draw every arrow the same length, showing direction only.', default: false },
      xMin: { type: 'number', description: 'The lowest x, used when no axes is set.', default: -3 },
      xMax: { type: 'number', description: 'The highest x, used when no axes is set.', default: 3 },
      yMin: { type: 'number', description: 'The lowest y, used when no axes is set.', default: -3 },
      yMax: { type: 'number', description: 'The highest y, used when no axes is set.', default: 3 },
      ...STROKE,
      ...LABEL,
    },
    required: ['uExpression', 'vExpression'],
  },
  anchor(element, lookup) {
    const axes = lookup ? lookup(element.axesId) : null;
    return axes ? { x: axes.x, y: axes.y + axes.height } : { x: 0, y: 0 };
  },
  move: () => ({}),
  attachedTo: (element) => element.axesId,
  render(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { arrows, error } = fieldArrows(element, axes);
    const group = svg('g');

    if (error) {
      const spot = axes ? ctx.S(axes.x, axes.y + axes.height) : ctx.S(0, 0);
      group.append(ctx.text(`⚠ ${error}`, {
        x: spot.x, y: spot.y - 14, anchor: 'start', size: 12, color: '#b91c1c',
      }));
      return group;
    }

    const paint = strokeAttrs(element, { 'stroke-width': Math.max(0.5, (element.strokeWidth ?? 2) * 0.7) });
    for (const arrow of arrows) {
      const from = ctx.S(arrow.base.x, arrow.base.y);
      const to = ctx.S(arrow.tipPoint.x, arrow.tipPoint.y);
      if (Math.hypot(to.x - from.x, to.y - from.y) < 0.6) continue; // a zero of the field
      group.append(svg('line', {
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        ...paint,
        'marker-end': ctx.arrow(element.color),
      }));
    }

    if (element.label && axes) {
      const spot = ctx.S(axes.x + axes.width, axes.y + axes.height);
      group.append(ctx.text(element.label, {
        x: spot.x, y: spot.y - 12, anchor: 'end',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const axes = ctx.byId(element.axesId);
    const { arrows, error } = fieldArrows(element, axes);
    if (error) return [`% vector field "${element.id}": ${error}`];

    const options = tikzStroke(element, ctx, ['->', '>=stealth']);
    return arrows
      .filter((arrow) => Math.hypot(arrow.tipPoint.x - arrow.base.x, arrow.tipPoint.y - arrow.base.y) > 0.01)
      .map((arrow) => `\\draw[${options}] ${ctx.P(arrow.base.x, arrow.base.y)} -- ${
        ctx.P(arrow.tipPoint.x, arrow.tipPoint.y)};`);
  },
});

/* ----------------------------- charge ---------------------------- */

const CHARGE_GLYPH = { positive: '+', negative: '−', neutral: '', mass: '' };

defineType({
  name: 'charge',
  label: 'Charge / point mass',
  group: 'Fields',
  hint: 'A circled plus or minus for a charge, or a filled dot for a point mass.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      sign: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mass'], description: 'What the marker stands for.', default: 'positive' },
      radius: { type: 'number', description: 'The marker radius in diagram units.', default: 0.3, minimum: 0.02 },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#fee2e2' },
      ...STROKE,
      ...LABEL,
      labelPlace: { type: 'string', enum: ['above', 'below', 'right', 'left'], description: 'Where the label sits.', default: 'above' },
    },
    required: ['x', 'y', 'sign'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const radius = ctx.L(element.radius);
    const group = svg('g');
    const solid = element.sign === 'mass';

    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: radius,
      ...strokeAttrs(element, { fill: solid ? element.color : element.fill }),
    }));

    const glyph = CHARGE_GLYPH[element.sign];
    if (glyph) {
      const text = svg('text', {
        x: centre.x, y: centre.y,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': radius * 1.6, fill: element.color,
        'font-family': MATH_FONT,
      });
      text.textContent = glyph;
      group.append(text);
    }

    if (element.label) {
      const offset = radius + 12;
      const spot = {
        above: { x: centre.x, y: centre.y - offset },
        below: { x: centre.x, y: centre.y + offset },
        right: { x: centre.x + offset, y: centre.y },
        left: { x: centre.x - offset, y: centre.y },
      }[element.labelPlace];
      group.append(ctx.text(element.label, {
        x: spot.x, y: spot.y,
        anchor: element.labelPlace === 'right' ? 'start' : element.labelPlace === 'left' ? 'end' : 'middle',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const solid = element.sign === 'mass';
    const options = tikzStroke(element, ctx, [
      `fill=${ctx.color(solid ? element.color : element.fill)}`,
    ]);
    const lines = [`\\draw[${options}] ${ctx.P(element.x, element.y)} circle (${round(element.radius, 3)});`];

    const glyph = { positive: '$+$', negative: '$-$', neutral: '', mass: '' }[element.sign];
    if (glyph) lines.push(`\\node at ${ctx.P(element.x, element.y)} {${glyph}};`);

    if (element.label) {
      const place = { above: 'above', below: 'below', right: 'right', left: 'left' }[element.labelPlace];
      lines.push(`\\node[${place}] at ${ctx.P(element.x, element.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ wave ----------------------------- */

/** The points of a sine train running along the element direction. */
function wavePoints(element) {
  const count = Math.max(8, Math.min(2000, Math.round(element.length / 0.02)));
  const cos = Math.cos(element.angle * DEG);
  const sin = Math.sin(element.angle * DEG);
  const wavelength = Math.max(0.01, element.wavelength);
  const points = [];

  for (let index = 0; index < count; index++) {
    const along = (index / (count - 1)) * element.length;
    const phase = (along / wavelength) * Math.PI * 2 + element.phase * DEG;
    const across = element.amplitude * Math.sin(phase)
      * (element.damping ? Math.exp(-element.damping * along) : 1);
    points.push({
      x: element.x + along * cos - across * sin,
      y: element.y + along * sin + across * cos,
    });
  }
  return points;
}

defineType({
  name: 'wave',
  label: 'Wave',
  group: 'Fields',
  hint: 'A sine train along a direction. Use it for a light wave, a signal or an oscillation.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The length in diagram units.', default: 6, minimum: 0.2 },
      angle: { type: 'number', description: 'The direction in degrees.', default: 0, minimum: -360, maximum: 360 },
      amplitude: { type: 'number', description: 'The peak height in diagram units.', default: 0.6, minimum: 0.01 },
      wavelength: { type: 'number', description: 'The distance between two peaks.', default: 1.5, minimum: 0.05 },
      phase: { type: 'number', description: 'The starting phase in degrees.', default: 0, minimum: -360, maximum: 360 },
      damping: { type: 'number', description: 'The decay rate. Use 0 for a steady wave.', default: 0, minimum: 0, maximum: 5 },
      head: { type: 'string', enum: ['end', 'none'], description: 'Draw an arrowhead at the far end.', default: 'none' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length', 'amplitude', 'wavelength'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles(element) {
    const end = tip(element.x, element.y, element.length, element.angle);
    return [{
      x: end.x, y: end.y,
      set: (target) => ({
        length: round(Math.hypot(target.x - element.x, target.y - element.y), 2) || 0.2,
        angle: round(Math.atan2(target.y - element.y, target.x - element.x) / DEG, 1),
      }),
    }];
  },
  render(element, ctx) {
    const points = wavePoints(element).map((point) => ctx.S(point.x, point.y));
    const group = svg('g');
    group.append(svg('path', {
      d: points.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' '),
      ...strokeAttrs(element),
      'marker-end': element.head === 'end' ? ctx.arrow(element.color) : null,
    }));

    if (element.label) {
      const spot = tip(element.x, element.y, element.length / 2, element.angle);
      const above = tip(spot.x, spot.y, element.amplitude + 0.35, element.angle + 90);
      const point = ctx.S(above.x, above.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const points = wavePoints(element);
    const step = Math.max(1, Math.floor(points.length / 160));
    const kept = points.filter((_, index) => index % step === 0 || index === points.length - 1);
    const extra = element.head === 'end' ? ['->', '>=stealth'] : [];
    const lines = [`\\draw[${tikzStroke(element, ctx, extra)}] plot coordinates {${
      kept.map((point) => ctx.P(point.x, point.y)).join(' ')}};`];

    if (element.label) {
      const spot = tip(element.x, element.y, element.length / 2, element.angle);
      const above = tip(spot.x, spot.y, element.amplitude + 0.35, element.angle + 90);
      lines.push(`\\node at ${ctx.P(above.x, above.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});
