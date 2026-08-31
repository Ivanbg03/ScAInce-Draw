/** Optics parts: the object arrow, the screen and the prism. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, tip } from './shared.js';

/* -------------------------- object arrow ------------------------- */

defineType({
  name: 'object-arrow',
  label: 'Object / image',
  group: 'Optics',
  hint: 'The upright arrow that stands for an object or its image.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      height: { type: 'number', description: 'The arrow height. A negative value inverts it.', default: 1.6 },
      kind: { type: 'string', enum: ['object', 'image', 'virtual'], description: 'How the arrow is drawn.', default: 'object' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'height'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [{
    x: element.x, y: element.y + element.height,
    set: (point) => ({ height: round(point.y - element.y, 2) || 0.1 }),
  }],
  render(element, ctx) {
    const base = ctx.S(element.x, element.y);
    const top = ctx.S(element.x, element.y + element.height);
    const dashed = element.kind === 'virtual';

    const group = svg('g');
    group.append(svg('line', {
      x1: base.x, y1: base.y, x2: top.x, y2: top.y,
      ...strokeAttrs(element, {
        'stroke-width': (element.strokeWidth ?? 2) * 1.3,
        'stroke-dasharray': dashed ? '6 4' : null,
      }),
      'marker-end': ctx.arrow(element.color),
    }));

    if (element.label) {
      const above = element.height >= 0;
      group.append(ctx.text(element.label, {
        x: top.x + 10, y: top.y + (above ? -6 : 14), anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const extra = ['->', '>=stealth'];
    if (element.kind === 'virtual') extra.push('dashed');
    const lines = [`\\draw[${tikzStroke(element, ctx, extra)}] ${ctx.P(element.x, element.y)} -- ${
      ctx.P(element.x, element.y + element.height)};`];
    if (element.label) {
      const anchor = element.height >= 0 ? 'above right' : 'below right';
      lines.push(`\\node[${anchor}] at ${ctx.P(element.x, element.y + element.height)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- screen ---------------------------- */

defineType({
  name: 'screen',
  label: 'Screen',
  group: 'Optics',
  hint: 'A detector screen or a wall, hatched on its back face.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      height: { type: 'number', description: 'The screen height in diagram units.', default: 3, minimum: 0.2 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      side: { type: 'string', enum: ['right', 'left'], description: 'Which face carries the hatch.', default: 'right' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'height'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const half = element.height / 2;
    const along = element.angle + 90;      // the screen runs across the axis
    const back = element.angle + (element.side === 'left' ? 180 : 0);

    const top = tip(element.x, element.y, half, along);
    const bottom = tip(element.x, element.y, -half, along);
    const a = ctx.S(top.x, top.y);
    const b = ctx.S(bottom.x, bottom.y);

    const group = svg('g');
    group.append(svg('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      ...strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 1.5 }),
    }));

    const ticks = Math.max(2, Math.round(element.height * 3));
    const tickPaint = strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.6, 'stroke-dasharray': null });
    for (let index = 0; index <= ticks; index++) {
      const at = tip(bottom.x, bottom.y, (index / ticks) * element.height, along);
      const out = tip(at.x, at.y, element.height * 0.12, back + 45);
      const from = ctx.S(at.x, at.y);
      const to = ctx.S(out.x, out.y);
      group.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, ...tickPaint }));
    }

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: a.x, y: a.y - 14, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const half = element.height / 2;
    const along = element.angle + 90;
    const top = tip(element.x, element.y, half, along);
    const bottom = tip(element.x, element.y, -half, along);
    const depth = element.height * 0.12 * (element.side === 'left' ? -1 : 1);
    const backTop = tip(top.x, top.y, depth, element.angle);
    const backBottom = tip(bottom.x, bottom.y, depth, element.angle);

    const lines = [
      '% \\usetikzlibrary{patterns}',
      `\\path[pattern=north east lines, pattern color=${ctx.color(element.color)}] ${
        ctx.P(bottom.x, bottom.y)} -- ${ctx.P(top.x, top.y)} -- ${ctx.P(backTop.x, backTop.y)} -- ${
        ctx.P(backBottom.x, backBottom.y)} -- cycle;`,
      `\\draw[${tikzStroke(element, ctx)}] ${ctx.P(top.x, top.y)} -- ${ctx.P(bottom.x, bottom.y)};`,
    ];
    if (element.label) {
      lines.push(`\\node[above] at ${ctx.P(top.x, top.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- prism ----------------------------- */

/** The three corners of an isosceles prism standing on its base. */
function prismCorners(element) {
  const half = element.size / 2;
  const height = element.size * Math.sin(60 * DEG);
  const local = [
    { x: -half, y: -height / 2 },
    { x: half, y: -height / 2 },
    { x: 0, y: height / 2 },
  ];
  const cos = Math.cos(element.angle * DEG);
  const sin = Math.sin(element.angle * DEG);
  return local.map((point) => ({
    x: element.x + point.x * cos - point.y * sin,
    y: element.y + point.x * sin + point.y * cos,
  }));
}

defineType({
  name: 'prism',
  label: 'Prism',
  group: 'Optics',
  hint: 'A triangular prism for a dispersion or a refraction figure.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      size: { type: 'number', description: 'The base length in diagram units.', default: 2.6, minimum: 0.2 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      fill: { type: 'string', format: 'color', description: 'The glass fill colour.', default: '#bfdbfe' },
      fillOpacity: { type: 'number', description: 'The fill opacity from 0 to 1.', default: 0.45, minimum: 0, maximum: 1 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'size'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const corners = prismCorners(element).map((point) => ctx.S(point.x, point.y));
    const group = svg('g');
    group.append(svg('polygon', {
      points: corners.map((point) => `${point.x},${point.y}`).join(' '),
      ...strokeAttrs(element, { fill: element.fill, 'fill-opacity': element.fillOpacity }),
    }));
    if (element.label) {
      const centre = ctx.S(element.x, element.y);
      group.append(ctx.text(element.label, {
        x: centre.x, y: centre.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const corners = prismCorners(element);
    const options = tikzStroke(element, ctx, [
      `fill=${ctx.color(element.fill)}`,
      `fill opacity=${element.fillOpacity}`,
    ]);
    const lines = [`\\draw[${options}] ${
      corners.map((point) => ctx.P(point.x, point.y)).join(' -- ')} -- cycle;`];
    if (element.label) {
      lines.push(`\\node at ${ctx.P(element.x, element.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});
