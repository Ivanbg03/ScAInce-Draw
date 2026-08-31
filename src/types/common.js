/** Element types that every domain uses: label, arrow, polyline, angle. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { toTikz } from '../mathtext.js';
import {
  strokeAttrs, parsePoints, formatPoints, besideSegment,
  angleBetween, distance, tikzStroke, SIDES,
} from './shared.js';

/* ----------------------------- label ----------------------------- */

defineType({
  name: 'label',
  label: 'Text label',
  group: 'Common',
  hint: 'Free text or a formula anywhere on the canvas.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      text: { type: 'string', description: 'LaTeX-lite source, for example E = mc^2.', default: 'label' },
      size: { type: 'number', description: 'The font size in px.', default: 18, minimum: 6, maximum: 72 },
      color: { type: 'string', format: 'color', description: 'The text colour.', default: '#1f2937' },
      rotate: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      anchor: { type: 'string', enum: ['start', 'middle', 'end'], description: 'The horizontal anchor.', default: 'middle' },
    },
    required: ['x', 'y', 'text'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const point = ctx.S(element.x, element.y);
    return ctx.text(element.text, {
      x: point.x, y: point.y,
      anchor: element.anchor,
      size: element.size,
      color: element.color,
      rotate: -element.rotate,
    });
  },
  tikz(element, ctx) {
    const options = [`text=${ctx.color(element.color)}`, `anchor=${
      element.anchor === 'start' ? 'west' : element.anchor === 'end' ? 'east' : 'center'
    }`];
    if (element.rotate) options.push(`rotate=${round(element.rotate)}`);
    return [`\\node[${options.join(', ')}] at ${ctx.P(element.x, element.y)} {${ctx.math(element.text)}};`];
  },
});

/* ----------------------------- arrow ----------------------------- */

defineType({
  name: 'arrow',
  label: 'Arrow',
  group: 'Common',
  hint: 'A straight arrow between two points.',
  schema: {
    type: 'object',
    properties: {
      x1: { type: 'number', description: 'The tail x.', default: 0 },
      y1: { type: 'number', description: 'The tail y.', default: 0 },
      x2: { type: 'number', description: 'The tip x.', default: 3 },
      y2: { type: 'number', description: 'The tip y.', default: 2 },
      head: { type: 'string', enum: ['end', 'both', 'none'], description: 'Where the arrowheads sit.', default: 'end' },
      ...STROKE,
      ...LABEL,
      labelSide: { type: 'string', enum: SIDES, description: 'Which side of the line the label sits on.', default: 'left' },
    },
    required: ['x1', 'y1', 'x2', 'y2'],
  },
  anchor: (element) => ({ x: element.x1, y: element.y1 }),
  move: (element, dx, dy) => ({
    x1: element.x1 + dx, y1: element.y1 + dy,
    x2: element.x2 + dx, y2: element.y2 + dy,
  }),
  handles: (element) => [
    { x: element.x2, y: element.y2, set: (point) => ({ x2: point.x, y2: point.y }) },
  ],
  render(element, ctx) {
    const from = ctx.S(element.x1, element.y1);
    const to = ctx.S(element.x2, element.y2);
    const group = svg('g');
    group.append(svg('line', {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      ...strokeAttrs(element),
      'marker-end': element.head === 'none' ? null : ctx.arrow(element.color),
      'marker-start': element.head === 'both' ? ctx.arrowBack(element.color) : null,
    }));
    if (element.label) {
      const spot = besideSegment(
        { x: element.x1, y: element.y1 },
        { x: element.x2, y: element.y2 },
        element.labelSide,
      );
      const screen = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: screen.x, y: screen.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const tipSpec = element.head === 'none' ? '' : element.head === 'both' ? '<->' : '->';
    const options = tikzStroke(element, ctx, [tipSpec]);
    const label = element.label
      ? ` node[midway, ${element.labelSide === 'right' ? 'below right' : 'above left'}] {${ctx.math(element.label)}}`
      : '';
    return [`\\draw[${options}] ${ctx.P(element.x1, element.y1)} --${label} ${ctx.P(element.x2, element.y2)};`];
  },
});

/* ---------------------------- polyline --------------------------- */

defineType({
  name: 'polyline',
  label: 'Polyline',
  group: 'Common',
  hint: 'A path through a list of points. Use it for a boundary or a path.',
  schema: {
    type: 'object',
    properties: {
      points: {
        type: 'string', format: 'points',
        description: 'Points as "x,y x,y x,y" in diagram units.',
        default: '0,0 2,1 4,0',
      },
      closed: { type: 'boolean', description: 'Join the last point to the first.', default: false },
      fill: { type: 'string', format: 'color', description: 'The fill colour. Use none for no fill.', default: 'none' },
      fillOpacity: { type: 'number', description: 'The fill opacity from 0 to 1.', default: 0.15, minimum: 0, maximum: 1 },
      head: { type: 'string', enum: ['end', 'both', 'none'], description: 'Where the arrowheads sit.', default: 'none' },
      ...STROKE,
      ...LABEL,
    },
    required: ['points'],
  },
  anchor(element) {
    const points = parsePoints(element.points);
    return points[0] || { x: 0, y: 0 };
  },
  move(element, dx, dy) {
    const points = parsePoints(element.points).map((point) => ({
      x: round(point.x + dx), y: round(point.y + dy),
    }));
    return { points: formatPoints(points) };
  },
  render(element, ctx) {
    const points = parsePoints(element.points);
    if (points.length < 2) return svg('g');
    const screen = points.map((point) => ctx.S(point.x, point.y));
    const data = screen.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')
      + (element.closed ? ' Z' : '');

    const group = svg('g');
    group.append(svg('path', {
      d: data,
      ...strokeAttrs(element, {
        fill: element.fill === 'none' ? 'none' : element.fill,
        'fill-opacity': element.fill === 'none' ? null : element.fillOpacity,
      }),
      'marker-end': element.head === 'none' ? null : ctx.arrow(element.color),
      'marker-start': element.head === 'both' ? ctx.arrowBack(element.color) : null,
    }));
    if (element.label) {
      const last = points[points.length - 1];
      const spot = ctx.S(last.x, last.y);
      group.append(ctx.text(element.label, {
        x: spot.x + 12, y: spot.y - 8, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const points = parsePoints(element.points);
    if (points.length < 2) return [];
    const tipSpec = element.head === 'none' ? '' : element.head === 'both' ? '<->' : '->';
    const extra = [tipSpec];
    if (element.fill !== 'none') {
      extra.push(`fill=${ctx.color(element.fill)}`, `fill opacity=${element.fillOpacity}`);
    }
    const path = points.map((point) => ctx.P(point.x, point.y)).join(' -- ')
      + (element.closed ? ' -- cycle' : '');
    return [`\\draw[${tikzStroke(element, ctx, extra)}] ${path};`];
  },
});

/* ----------------------------- angle ----------------------------- */

defineType({
  name: 'angle',
  label: 'Angle mark',
  group: 'Common',
  hint: 'An arc between two directions, with a label such as \\theta.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      from: { type: 'number', description: 'The start angle in degrees.', default: 0 },
      to: { type: 'number', description: 'The end angle in degrees.', default: 45 },
      radius: { type: 'number', description: 'The arc radius in diagram units.', default: 1, minimum: 0.05 },
      rightAngle: { type: 'boolean', description: 'Draw a square mark instead of an arc.', default: false },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'from', 'to'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const radius = ctx.L(element.radius);
    const group = svg('g');

    if (element.rightAngle) {
      const a = element.from * DEG;
      const b = element.to * DEG;
      const p1 = { x: centre.x + radius * Math.cos(a), y: centre.y - radius * Math.sin(a) };
      const p3 = { x: centre.x + radius * Math.cos(b), y: centre.y - radius * Math.sin(b) };
      const p2 = { x: p1.x + p3.x - centre.x, y: p1.y + p3.y - centre.y };
      group.append(svg('path', {
        d: `M${p1.x} ${p1.y} L${p2.x} ${p2.y} L${p3.x} ${p3.y}`,
        ...strokeAttrs(element),
      }));
    } else {
      const a = element.from * DEG;
      const b = element.to * DEG;
      const start = { x: centre.x + radius * Math.cos(a), y: centre.y - radius * Math.sin(a) };
      const end = { x: centre.x + radius * Math.cos(b), y: centre.y - radius * Math.sin(b) };
      const sweep = ((element.to - element.from) % 360 + 360) % 360;
      group.append(svg('path', {
        d: `M${start.x} ${start.y} A${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 0 ${end.x} ${end.y}`,
        ...strokeAttrs(element),
      }));
    }

    if (element.label) {
      const middle = (element.from + element.to) / 2 * DEG;
      const distanceOut = radius + 14;
      group.append(ctx.text(element.label, {
        x: centre.x + distanceOut * Math.cos(middle),
        y: centre.y - distanceOut * Math.sin(middle),
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const lines = [];
    const options = tikzStroke(element, ctx);
    lines.push(
      `\\draw[${options}] ${ctx.P(element.x, element.y)} ` +
      `+(${round(element.from)}:${round(element.radius)}) arc ` +
      `(${round(element.from)}:${round(element.to)}:${round(element.radius)});`,
    );
    if (element.label) {
      const middle = (element.from + element.to) / 2;
      lines.push(
        `\\node at ${ctx.P(element.x, element.y)} ` +
        `[shift=(${round(middle)}:${round(element.radius + 0.4)})] {${ctx.math(element.label)}};`,
      );
    }
    return lines;
  },
});
