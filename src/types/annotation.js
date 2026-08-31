/** Annotation types: dimension, text box, brace, container. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import {
  strokeAttrs, tikzStroke, tip, besideSegment, distance, angleBetween, centreBoxHandle,
} from './shared.js';

/* --------------------------- dimension --------------------------- */

defineType({
  name: 'dimension',
  label: 'Dimension',
  group: 'Common',
  hint: 'A measurement line with witness ticks and a length label.',
  schema: {
    type: 'object',
    properties: {
      x1: { type: 'number', description: 'The start x.', default: 0 },
      y1: { type: 'number', description: 'The start y.', default: 0 },
      x2: { type: 'number', description: 'The end x.', default: 4 },
      y2: { type: 'number', description: 'The end y.', default: 0 },
      offset: { type: 'number', description: 'How far the line sits from the measured edge.', default: 0.8 },
      tick: { type: 'number', description: 'The witness tick length in diagram units.', default: 0.25, minimum: 0 },
      ...STROKE,
      ...LABEL,
      autoLength: { type: 'boolean', description: 'Show the measured length when no label is set.', default: true },
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
    const from = { x: element.x1, y: element.y1 };
    const to = { x: element.x2, y: element.y2 };
    const heading = angleBetween(from, to);
    const normal = heading + 90;

    const a = tip(from.x, from.y, element.offset, normal);
    const b = tip(to.x, to.y, element.offset, normal);
    const group = svg('g');
    const paint = strokeAttrs(element);

    // The two witness lines, from the measured points out to the dimension line.
    group.append(svg('line', {
      ...lineAttrs(ctx, from, tip(from.x, from.y, element.offset + element.tick, normal)), ...paint,
    }));
    group.append(svg('line', {
      ...lineAttrs(ctx, to, tip(to.x, to.y, element.offset + element.tick, normal)), ...paint,
    }));

    // The dimension line itself, with an arrowhead at each end.
    group.append(svg('line', {
      ...lineAttrs(ctx, a, b), ...paint,
      'marker-start': ctx.arrowBack(element.color),
      'marker-end': ctx.arrow(element.color),
    }));

    const text = element.label || (element.autoLength ? String(round(distance(from, to), 2)) : '');
    if (text) {
      const spot = besideSegment(a, b, 'left', 0.32);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(text, {
        x: point.x, y: point.y, size: element.labelSize, color: element.color,
        rotate: Math.abs(heading) > 90 ? -(heading + 180) : -heading,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const from = { x: element.x1, y: element.y1 };
    const to = { x: element.x2, y: element.y2 };
    const normal = angleBetween(from, to) + 90;
    const a = tip(from.x, from.y, element.offset, normal);
    const b = tip(to.x, to.y, element.offset, normal);
    const witnessA = tip(from.x, from.y, element.offset + element.tick, normal);
    const witnessB = tip(to.x, to.y, element.offset + element.tick, normal);
    const plain = tikzStroke(element, ctx);
    const text = element.label || (element.autoLength ? String(round(distance(from, to), 2)) : '');

    return [
      `\\draw[${plain}] ${ctx.P(from.x, from.y)} -- ${ctx.P(witnessA.x, witnessA.y)};`,
      `\\draw[${plain}] ${ctx.P(to.x, to.y)} -- ${ctx.P(witnessB.x, witnessB.y)};`,
      `\\draw[${tikzStroke(element, ctx, ['<->', '>=stealth'])}] ${ctx.P(a.x, a.y)} --${
        text ? ` node[midway, above, sloped] {${ctx.math(text)}}` : ''} ${ctx.P(b.x, b.y)};`,
    ];
  },
});

/** Screen coordinates for a line between two document points. */
function lineAttrs(ctx, from, to) {
  const a = ctx.S(from.x, from.y);
  const b = ctx.S(to.x, to.y);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/* ---------------------------- text box --------------------------- */

defineType({
  name: 'text-box',
  label: 'Note box',
  group: 'Common',
  hint: 'A boxed annotation with an optional leader line.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      text: { type: 'string', description: 'The note text. Prose is escaped for LaTeX.', default: 'Note' },
      width: { type: 'number', description: 'The box width in diagram units.', default: 3.4, minimum: 0.2 },
      height: { type: 'number', description: 'The box height in diagram units.', default: 1, minimum: 0.2 },
      size: { type: 'number', description: 'The text size in px.', default: 14, minimum: 6, maximum: 48 },
      fill: { type: 'string', format: 'color', description: 'The box fill colour.', default: '#fef9c3' },
      leaderX: { type: 'number', description: 'The leader target x. Leave equal to x for no leader.', default: 0 },
      leaderY: { type: 'number', description: 'The leader target y.', default: 0 },
      showLeader: { type: 'boolean', description: 'Draw a line from the box to the leader target.', default: false },
      ...STROKE,
    },
    required: ['x', 'y', 'text'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [
    centreBoxHandle(element, 0.2),
    ...(element.showLeader
      ? [{ x: element.leaderX, y: element.leaderY, set: (point) => ({ leaderX: point.x, leaderY: point.y }) }]
      : []),
  ],
  render(element, ctx) {
    const topLeft = ctx.S(element.x - element.width / 2, element.y + element.height / 2);
    const centre = ctx.S(element.x, element.y);
    const group = svg('g');

    if (element.showLeader) {
      const target = ctx.S(element.leaderX, element.leaderY);
      group.append(svg('line', {
        x1: centre.x, y1: centre.y, x2: target.x, y2: target.y,
        ...strokeAttrs(element, { 'stroke-dasharray': '4 3' }),
        'marker-end': ctx.arrow(element.color),
      }));
    }

    group.append(svg('rect', {
      x: topLeft.x, y: topLeft.y,
      width: ctx.L(element.width), height: ctx.L(element.height),
      rx: 4, ry: 4,
      ...strokeAttrs(element, { fill: element.fill }),
    }));
    group.append(ctx.text(element.text, {
      x: centre.x, y: centre.y, size: element.size, color: element.color,
    }));
    return group;
  },
  tikz(element, ctx) {
    const halfW = element.width / 2;
    const halfH = element.height / 2;
    const lines = [];
    if (element.showLeader) {
      lines.push(`\\draw[${tikzStroke(element, ctx, ['->', '>=stealth', 'dashed'])}] ${
        ctx.P(element.x, element.y)} -- ${ctx.P(element.leaderX, element.leaderY)};`);
    }
    lines.push(
      `\\draw[${tikzStroke(element, ctx, [`fill=${ctx.color(element.fill)}`, 'rounded corners'])}] ${
        ctx.P(element.x - halfW, element.y - halfH)} rectangle ${ctx.P(element.x + halfW, element.y + halfH)};`,
      `\\node[align=center, text=${ctx.color(element.color)}] at ${
        ctx.P(element.x, element.y)} {${ctx.math(element.text)}};`,
    );
    return lines;
  },
});

/* ----------------------------- brace ----------------------------- */

defineType({
  name: 'brace',
  label: 'Curly brace',
  group: 'Common',
  hint: 'A brace that groups a span, with a label at its middle.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The span in diagram units.', default: 4, minimum: 0.2 },
      angle: { type: 'number', description: 'The direction of the span in degrees.', default: 0, minimum: -360, maximum: 360 },
      depth: { type: 'number', description: 'How far the brace bulges, in diagram units.', default: 0.45, minimum: 0.02 },
      flip: { type: 'boolean', description: 'Put the brace on the other side.', default: false },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length'],
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
    const side = element.flip ? -1 : 1;
    const length = element.length;
    const depth = element.depth;

    // A brace is not a tent. It hooks up from each end, runs flat, and spikes
    // at the centre. Everything is laid out along the span and across it, then
    // mapped once.
    const cos = Math.cos(element.angle * DEG);
    const sin = Math.sin(element.angle * DEG);
    const at = (along, across) => {
      const out = across * side;
      const local = ctx.S(
        element.x + along * cos - out * sin,
        element.y + along * sin + out * cos,
      );
      return `${local.x} ${local.y}`;
    };

    const shelf = depth * 0.82;
    const data = [
      `M${at(0, 0)}`,
      `Q${at(length * 0.06, shelf * 0.9)} ${at(length * 0.2, shelf)}`,
      `L${at(length * 0.44, shelf)}`,
      `Q${at(length * 0.5, shelf)} ${at(length * 0.5, depth * 1.5)}`,
      `Q${at(length * 0.5, shelf)} ${at(length * 0.56, shelf)}`,
      `L${at(length * 0.8, shelf)}`,
      `Q${at(length * 0.94, shelf * 0.9)} ${at(length, 0)}`,
    ].join(' ');

    const group = svg('g');
    group.append(svg('path', { d: data, ...strokeAttrs(element) }));

    if (element.label) {
      const middle = tip(element.x, element.y, length / 2, element.angle);
      const spot = tip(middle.x, middle.y, (depth * 1.5 + 0.4) * side, element.angle + 90);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const side = element.flip ? -1 : 1;
    const across = element.angle + 90 * side;
    const middle = tip(element.x, element.y, element.length / 2, element.angle);
    const end = tip(element.x, element.y, element.length, element.angle);
    const label = element.label ? ` node[midway, ${side > 0 ? 'above' : 'below'}] {${ctx.math(element.label)}}` : '';

    return [
      '% \\usetikzlibrary{decorations.pathreplacing}',
      `\\draw[${tikzStroke(element, ctx, [
        `decorate`, `decoration={brace, amplitude=${round(element.depth * 8, 2)}pt${side < 0 ? ', mirror' : ''}}`,
      ])}] ${ctx.P(element.x, element.y)} --${label} ${ctx.P(end.x, end.y)};`,
      `% brace midpoint: ${ctx.P(middle.x, middle.y)}`,
    ];
  },
});

/* --------------------------- container --------------------------- */

defineType({
  name: 'container',
  label: 'Group box',
  group: 'Schematic',
  hint: 'A dashed box with a title, to group a subsystem.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      width: { type: 'number', description: 'The box width in diagram units.', default: 8, minimum: 0.5 },
      height: { type: 'number', description: 'The box height in diagram units.', default: 5, minimum: 0.5 },
      title: { type: 'string', description: 'The title shown at the top left.', default: 'Subsystem' },
      fill: { type: 'string', format: 'color', description: 'The fill colour. Use none for no fill.', default: 'none' },
      fillOpacity: { type: 'number', description: 'The fill opacity from 0 to 1.', default: 0.08, minimum: 0, maximum: 1 },
      ...STROKE,
    },
    required: ['x', 'y', 'width', 'height'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [{
    x: element.x + element.width / 2,
    y: element.y - element.height / 2,
    set: (point) => ({
      width: Math.max(0.5, round((point.x - element.x) * 2, 2)),
      height: Math.max(0.5, round((element.y - point.y) * 2, 2)),
    }),
  }],
  render(element, ctx) {
    const topLeft = ctx.S(element.x - element.width / 2, element.y + element.height / 2);
    const group = svg('g');

    group.append(svg('rect', {
      x: topLeft.x, y: topLeft.y,
      width: ctx.L(element.width), height: ctx.L(element.height),
      rx: 6, ry: 6,
      ...strokeAttrs(element, {
        'stroke-dasharray': '8 5',
        fill: element.fill === 'none' ? 'none' : element.fill,
        'fill-opacity': element.fill === 'none' ? null : element.fillOpacity,
      }),
    }));

    if (element.title) {
      group.append(ctx.text(element.title, {
        x: topLeft.x + 10, y: topLeft.y + 14, anchor: 'start',
        size: 14, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const halfW = element.width / 2;
    const halfH = element.height / 2;
    const extra = ['dashed', 'rounded corners'];
    if (element.fill !== 'none') {
      extra.push(`fill=${ctx.color(element.fill)}`, `fill opacity=${element.fillOpacity}`);
    }
    const lines = [
      `\\draw[${tikzStroke(element, ctx, extra)}] ${ctx.P(element.x - halfW, element.y - halfH)} rectangle ${
        ctx.P(element.x + halfW, element.y + halfH)};`,
    ];
    if (element.title) {
      lines.push(`\\node[anchor=north west, text=${ctx.color(element.color)}] at ${
        ctx.P(element.x - halfW + 0.15, element.y + halfH - 0.1)} {${ctx.math(element.title)}};`);
    }
    return lines;
  },
});
