/** Block and signal schematic types: block, link, node. */

import { svg, round } from '../dom.js';
import { MATH_FONT } from '../mathtext.js';
import { defineType, POSITION, STROKE, LABEL, boxAnchors, LABEL_PLACE } from '../registry.js';
import { strokeAttrs, tikzStroke, rectBorderPoint, besideSegment, centreBoxHandle, labelPointOf } from './shared.js';

/* ------------------------------ block ---------------------------- */

defineType({
  name: 'block',
  label: 'Block',
  group: 'Schematic',
  hint: 'A labelled box. A link connects two blocks by id.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      width: { type: 'number', description: 'The width in diagram units.', default: 3, minimum: 0.2 },
      height: { type: 'number', description: 'The height in diagram units.', default: 1.6, minimum: 0.2 },
      rounded: { type: 'number', description: 'The corner radius in diagram units.', default: 0.15, minimum: 0 },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#f1f5f9' },
      ...STROKE,
      ...LABEL,
      ...LABEL_PLACE,
    },
    required: ['x', 'y', 'width', 'height'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  anchors: (element) => boxAnchors(element),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [centreBoxHandle(element, 0.2)],
  render(element, ctx) {
    const topLeft = ctx.S(element.x - element.width / 2, element.y + element.height / 2);
    const group = svg('g');
    group.append(svg('rect', {
      x: topLeft.x, y: topLeft.y,
      width: ctx.L(element.width), height: ctx.L(element.height),
      rx: ctx.L(element.rounded), ry: ctx.L(element.rounded),
      ...strokeAttrs(element, { fill: element.fill }),
    }));
    if (element.label) {
      const spot = labelPointOf(element, ctx.byId);
      const at = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: at.x, y: at.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    // An explicit rectangle, not a sized node: TikZ's scale= option moves
    // coordinates but leaves a node's minimum width alone.
    const options = tikzStroke(element, ctx, [
      `fill=${ctx.color(element.fill)}`,
      element.rounded > 0 ? 'rounded corners' : '',
    ]);
    const halfW = element.width / 2;
    const halfH = element.height / 2;
    const lines = [
      `\\draw[${options}] ${ctx.P(element.x - halfW, element.y - halfH)} rectangle ` +
      `${ctx.P(element.x + halfW, element.y + halfH)};`,
    ];
    if (element.label) {
      const spot = labelPointOf(element, ctx.byId);
      lines.push(`\\node[align=center, text=${ctx.color(element.color)}] at ` +
        `${ctx.P(spot.x, spot.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ link ----------------------------- */

/** Resolves one end of a link to a centre point and a box size. */
function endPoint(reference, fallback, lookup) {
  const target = reference ? lookup(reference) : null;
  if (!target) return { x: fallback.x, y: fallback.y, width: 0, height: 0 };
  return {
    x: target.x,
    y: target.y,
    width: target.width ?? (target.r ? target.r * 2 : 0),
    height: target.height ?? (target.r ? target.r * 2 : 0),
  };
}

defineType({
  name: 'link',
  label: 'Link',
  group: 'Schematic',
  hint: 'An arrow between two blocks. It stops at each border.',
  schema: {
    type: 'object',
    properties: {
      fromId: { type: 'string', format: 'elementRef', description: 'The id of the source block.', default: '' },
      toId: { type: 'string', format: 'elementRef', description: 'The id of the target block.', default: '' },
      x1: { type: 'number', description: 'The source x, used when fromId is empty.', default: 0 },
      y1: { type: 'number', description: 'The source y, used when fromId is empty.', default: 0 },
      x2: { type: 'number', description: 'The target x, used when toId is empty.', default: 4 },
      y2: { type: 'number', description: 'The target y, used when toId is empty.', default: 0 },
      route: { type: 'string', enum: ['straight', 'orthogonal'], description: 'The path shape.', default: 'straight' },
      head: { type: 'string', enum: ['end', 'both', 'none'], description: 'Where the arrowheads sit.', default: 'end' },
      ...STROKE,
      ...LABEL,
      labelSide: { type: 'string', enum: ['left', 'right', 'centre'], description: 'Which side the label sits on.', default: 'left' },
    },
    required: [],
  },
  anchor(element, lookup) {
    const from = endPoint(element.fromId, { x: element.x1, y: element.y1 }, lookup || (() => null));
    return { x: from.x, y: from.y };
  },
  move: (element, dx, dy) => (element.fromId || element.toId ? {} : {
    x1: element.x1 + dx, y1: element.y1 + dy,
    x2: element.x2 + dx, y2: element.y2 + dy,
  }),
  attachedTo: (element) => element.fromId || element.toId,
  render(element, ctx) {
    const from = endPoint(element.fromId, { x: element.x1, y: element.y1 }, ctx.byId);
    const to = endPoint(element.toId, { x: element.x2, y: element.y2 }, ctx.byId);

    // Stop the arrow at each border so it does not overlap the box.
    const start = from.width
      ? rectBorderPoint(from.x, from.y, from.width, from.height, to.x, to.y)
      : { x: from.x, y: from.y };
    const finish = to.width
      ? rectBorderPoint(to.x, to.y, to.width, to.height, from.x, from.y)
      : { x: to.x, y: to.y };

    const waypoints = element.route === 'orthogonal'
      ? [start, { x: (start.x + finish.x) / 2, y: start.y }, { x: (start.x + finish.x) / 2, y: finish.y }, finish]
      : [start, finish];

    const screen = waypoints.map((point) => ctx.S(point.x, point.y));
    const group = svg('g');
    group.append(svg('path', {
      d: screen.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' '),
      ...strokeAttrs(element),
      'marker-end': element.head === 'none' ? null : ctx.arrow(element.color),
      'marker-start': element.head === 'both' ? ctx.arrowBack(element.color) : null,
    }));

    if (element.label) {
      const spot = besideSegment(start, finish, element.labelSide, 0.35);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const from = endPoint(element.fromId, { x: element.x1, y: element.y1 }, ctx.byId);
    const to = endPoint(element.toId, { x: element.x2, y: element.y2 }, ctx.byId);
    const start = from.width
      ? rectBorderPoint(from.x, from.y, from.width, from.height, to.x, to.y)
      : { x: from.x, y: from.y };
    const finish = to.width
      ? rectBorderPoint(to.x, to.y, to.width, to.height, from.x, from.y)
      : { x: to.x, y: to.y };

    const tipSpec = element.head === 'none' ? '' : element.head === 'both' ? '<->' : '->';
    const options = tikzStroke(element, ctx, [tipSpec, '>=stealth']);
    const joint = element.route === 'orthogonal' ? ' -| ' : ' -- ';
    const label = element.label ? ` node[midway, above] {${ctx.math(element.label)}}` : '';
    return [`\\draw[${options}] ${ctx.P(start.x, start.y)}${joint}${label} ${ctx.P(finish.x, finish.y)};`];
  },
});

/* ------------------------------ node ----------------------------- */

const NODE_SYMBOLS = { sum: '∑', product: '×', dot: '', plus: '+', minus: '−' };

defineType({
  name: 'node',
  label: 'Junction',
  group: 'Schematic',
  hint: 'A summing junction, a product node or a plain dot.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      r: { type: 'number', description: 'The radius in diagram units.', default: 0.3, minimum: 0.02 },
      symbol: { type: 'string', enum: Object.keys(NODE_SYMBOLS), description: 'The symbol inside the circle.', default: 'sum' },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#ffffff' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'r'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const radius = ctx.L(element.r);
    const group = svg('g');
    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: radius,
      ...strokeAttrs(element, { fill: element.symbol === 'dot' ? element.color : element.fill }),
    }));

    const symbol = NODE_SYMBOLS[element.symbol];
    if (symbol) {
      const glyph = svg('text', {
        x: centre.x, y: centre.y,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': radius * 1.3, fill: element.color,
        'font-family': MATH_FONT,
      });
      glyph.textContent = symbol;
      group.append(glyph);
    }

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: centre.x, y: centre.y - radius - 12,
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const fill = element.symbol === 'dot' ? element.color : element.fill;
    const options = tikzStroke(element, ctx, [`fill=${ctx.color(fill)}`]);
    const lines = [`\\draw[${options}] ${ctx.P(element.x, element.y)} circle (${round(element.r)});`];
    const symbol = NODE_SYMBOLS[element.symbol];
    if (symbol) {
      const tex = { '∑': '$\\Sigma$', '×': '$\\times$', '+': '$+$', '−': '$-$' }[symbol] || '';
      if (tex) lines.push(`\\node at ${ctx.P(element.x, element.y)} {${tex}};`);
    }
    if (element.label) {
      lines.push(`\\node[above] at ${ctx.P(element.x, element.y + element.r)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});
