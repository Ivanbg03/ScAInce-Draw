/** Mechanics and free-body diagram types: body, force, moment, surface. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL, boxAnchors, surfaceAnchors, LABEL_PLACE } from '../registry.js';
import { strokeAttrs, tip, rectCorners, tikzStroke, SIDES, besideSegment, centreBoxHandle, labelPointOf } from './shared.js';

/* ------------------------------ body ----------------------------- */

defineType({
  name: 'body',
  label: 'Body',
  group: 'Mechanics',
  hint: 'A block, disc or wedge. Attach forces to it by id.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      shape: { type: 'string', enum: ['rect', 'circle', 'wedge'], description: 'The body outline.', default: 'rect' },
      width: { type: 'number', description: 'The width in diagram units.', default: 2, minimum: 0.1 },
      height: { type: 'number', description: 'The height in diagram units.', default: 1.4, minimum: 0.1 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#dbeafe' },
      ...STROKE,
      ...LABEL,
      ...LABEL_PLACE,
    },
    required: ['x', 'y', 'shape'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  anchors: (element) => boxAnchors(element),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [centreBoxHandle(element, 0.1)],
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const group = svg('g');
    const paint = strokeAttrs(element, { fill: element.fill });

    if (element.shape === 'circle') {
      group.append(svg('circle', {
        cx: centre.x, cy: centre.y, r: ctx.L(element.width / 2), ...paint,
      }));
    } else if (element.shape === 'wedge') {
      const half = element.width / 2;
      const points = [
        { x: element.x - half, y: element.y - element.height / 2 },
        { x: element.x + half, y: element.y - element.height / 2 },
        { x: element.x - half, y: element.y + element.height / 2 },
      ].map((point) => ctx.S(point.x, point.y));
      group.append(svg('polygon', {
        points: points.map((point) => `${point.x},${point.y}`).join(' '),
        transform: element.angle ? `rotate(${-element.angle} ${centre.x} ${centre.y})` : null,
        ...paint,
      }));
    } else {
      const corners = rectCorners(element.x, element.y, element.width, element.height, element.angle)
        .map((point) => ctx.S(point.x, point.y));
      group.append(svg('polygon', {
        points: corners.map((point) => `${point.x},${point.y}`).join(' '),
        ...paint,
      }));
    }

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
    const options = tikzStroke(element, ctx, [`fill=${ctx.color(element.fill)}`]);
    const lines = [];

    if (element.shape === 'circle') {
      lines.push(`\\draw[${options}] ${ctx.P(element.x, element.y)} circle (${round(element.width / 2)});`);
    } else if (element.shape === 'wedge') {
      const half = element.width / 2;
      const half2 = element.height / 2;
      const path = [
        ctx.P(element.x - half, element.y - half2),
        ctx.P(element.x + half, element.y - half2),
        ctx.P(element.x - half, element.y + half2),
      ].join(' -- ');
      lines.push(`\\draw[${options}] ${path} -- cycle;`);
    } else {
      const path = rectCorners(element.x, element.y, element.width, element.height, element.angle)
        .map((point) => ctx.P(point.x, point.y)).join(' -- ');
      lines.push(`\\draw[${options}] ${path} -- cycle;`);
    }

    if (element.label) {
      const spot = labelPointOf(element, ctx.byId);
      lines.push(`\\node at ${ctx.P(spot.x, spot.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ force ---------------------------- */

/** The tail of a force: the body centre when it references one, else its own x,y. */
function forceTail(element, lookup) {
  if (element.bodyId) {
    const body = lookup(element.bodyId);
    if (body) return { x: body.x + element.offsetX, y: body.y + element.offsetY };
  }
  return { x: element.x, y: element.y };
}

defineType({
  name: 'force',
  label: 'Force vector',
  group: 'Mechanics',
  hint: 'An arrow with a magnitude and an angle. Attach it to a body by id.',
  schema: {
    type: 'object',
    properties: {
      bodyId: { type: 'string', format: 'elementRef', description: 'The id of the body this force acts on. Leave empty to place it freely.', default: '' },
      offsetX: { type: 'number', description: 'The tail offset from the body centre, x.', default: 0 },
      offsetY: { type: 'number', description: 'The tail offset from the body centre, y.', default: 0 },
      ...POSITION,
      magnitude: { type: 'number', description: 'The arrow length in diagram units.', default: 2, minimum: 0.05 },
      angle: { type: 'number', description: 'The direction in degrees. 0 points right, 90 points up.', default: 90, minimum: -360, maximum: 360 },
      ...STROKE,
      ...LABEL,
      labelSide: { type: 'string', enum: SIDES, description: 'Which side of the arrow the label sits on.', default: 'left' },
    },
    required: ['magnitude', 'angle'],
  },
  // The anchor must be the drawn tail, not the raw x,y. When the force is
  // attached to a body the tail is the body's position plus the offset, so
  // returning x,y put the anchor grip and the rotation grip at the origin.
  anchor: (element, lookup) => forceTail(element, lookup || (() => null)),
  move: (element, dx, dy) => (element.bodyId
    ? { offsetX: round(element.offsetX + dx), offsetY: round(element.offsetY + dy) }
    : { x: round(element.x + dx), y: round(element.y + dy) }),
  attachedTo: (element) => element.bodyId,
  handles(element, lookup) {
    const tail = forceTail(element, lookup);
    const point = tip(tail.x, tail.y, element.magnitude, element.angle);
    return [{
      x: point.x, y: point.y,
      set: (target) => ({
        magnitude: round(Math.hypot(target.x - tail.x, target.y - tail.y), 2) || 0.05,
        angle: round(Math.atan2(target.y - tail.y, target.x - tail.x) / DEG, 1),
      }),
    }];
  },
  render(element, ctx) {
    const tail = forceTail(element, ctx.byId);
    const point = tip(tail.x, tail.y, element.magnitude, element.angle);
    const from = ctx.S(tail.x, tail.y);
    const to = ctx.S(point.x, point.y);

    const group = svg('g');
    group.append(svg('line', {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      ...strokeAttrs(element),
      'marker-end': ctx.arrow(element.color),
    }));
    if (element.label) {
      const spot = besideSegment(tail, point, element.labelSide, 0.4);
      const screen = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: screen.x, y: screen.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const tail = forceTail(element, ctx.byId);
    const point = tip(tail.x, tail.y, element.magnitude, element.angle);
    const options = tikzStroke(element, ctx, ['->', '>=stealth']);
    const label = element.label
      ? ` node[midway, ${element.labelSide === 'right' ? 'below right' : 'above left'}] {${ctx.math(element.label)}}`
      : '';
    return [`\\draw[${options}] ${ctx.P(tail.x, tail.y)} --${label} ${ctx.P(point.x, point.y)};`];
  },
});

/* ----------------------------- moment ---------------------------- */

defineType({
  name: 'moment',
  label: 'Moment',
  group: 'Mechanics',
  hint: 'A curved arrow for a torque or a moment.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      radius: { type: 'number', description: 'The arc radius in diagram units.', default: 0.9, minimum: 0.05 },
      from: { type: 'number', description: 'The start angle in degrees.', default: 30 },
      to: { type: 'number', description: 'The end angle in degrees.', default: 300 },
      direction: { type: 'string', enum: ['ccw', 'cw'], description: 'The sense of rotation.', default: 'ccw' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'radius'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const radius = ctx.L(element.radius);
    const a = element.from * DEG;
    const b = element.to * DEG;
    const start = { x: centre.x + radius * Math.cos(a), y: centre.y - radius * Math.sin(a) };
    const end = { x: centre.x + radius * Math.cos(b), y: centre.y - radius * Math.sin(b) };
    const sweep = ((element.to - element.from) % 360 + 360) % 360;

    const group = svg('g');
    const path = svg('path', {
      d: `M${start.x} ${start.y} A${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 0 ${end.x} ${end.y}`,
      ...strokeAttrs(element),
    });
    path.setAttribute(
      element.direction === 'cw' ? 'marker-start' : 'marker-end',
      element.direction === 'cw' ? ctx.arrowBack(element.color) : ctx.arrow(element.color),
    );
    group.append(path);

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: centre.x, y: centre.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const tipSpec = element.direction === 'cw' ? '<-' : '->';
    const options = tikzStroke(element, ctx, [tipSpec, '>=stealth']);
    const lines = [
      `\\draw[${options}] ${ctx.P(element.x, element.y)} ` +
      `+(${round(element.from)}:${round(element.radius)}) arc ` +
      `(${round(element.from)}:${round(element.to)}:${round(element.radius)});`,
    ];
    if (element.label) {
      lines.push(`\\node at ${ctx.P(element.x, element.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ---------------------------- surface ---------------------------- */

defineType({
  name: 'surface',
  label: 'Surface / ground',
  group: 'Mechanics',
  hint: 'A hatched line for the ground, a wall or an incline.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The length in diagram units.', default: 8, minimum: 0.1 },
      angle: { type: 'number', description: 'The incline in degrees.', default: 0, minimum: -180, maximum: 180 },
      side: { type: 'string', enum: ['below', 'above'], description: 'Which side carries the hatch.', default: 'below' },
      hatchStep: { type: 'number', description: 'The gap between hatch strokes, in diagram units.', default: 0.4, minimum: 0.05 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  anchors: (element) => surfaceAnchors(element),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const end = tip(element.x, element.y, element.length, element.angle);
    const from = ctx.S(element.x, element.y);
    const to = ctx.S(end.x, end.y);

    const group = svg('g');
    group.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, ...strokeAttrs(element) }));

    // The hatch strokes lean 45 degrees back from the surface, on the chosen
    // side. Everything stays in document units, so the y-up convention holds.
    const sign = element.side === 'above' ? -1 : 1;
    const tickAngle = element.angle + 180 + sign * 45;
    const tickLength = element.hatchStep * 0.9;
    const count = Math.max(1, Math.round(element.length / element.hatchStep));
    const tickPaint = strokeAttrs(element, {
      'stroke-width': (element.strokeWidth ?? 2) * 0.6,
      'stroke-dasharray': null,
    });

    for (let index = 0; index <= count; index++) {
      const base = tip(element.x, element.y, (index / count) * element.length, element.angle);
      const end2 = tip(base.x, base.y, tickLength, tickAngle);
      const start = ctx.S(base.x, base.y);
      const stop = ctx.S(end2.x, end2.y);
      group.append(svg('line', {
        x1: start.x, y1: start.y, x2: stop.x, y2: stop.y, ...tickPaint,
      }));
    }

    if (element.label) {
      const middle = tip(element.x, element.y, element.length / 2, element.angle);
      const spot = ctx.S(middle.x, middle.y);
      group.append(ctx.text(element.label, {
        x: spot.x, y: spot.y + sign * 26, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const end = tip(element.x, element.y, element.length, element.angle);
    const options = tikzStroke(element, ctx);
    const pattern = element.side === 'above' ? 'north east lines' : 'north west lines';
    return [
      `% \\usetikzlibrary{patterns}`,
      `\\draw[${options}] ${ctx.P(element.x, element.y)} -- ${ctx.P(end.x, end.y)};`,
      `\\path[pattern=${pattern}, pattern color=${ctx.color(element.color)}] ` +
      `${ctx.P(element.x, element.y)} -- ${ctx.P(end.x, end.y)} ` +
      `-- ++(${round(element.angle - 90)}:0.35) -- ++(${round(element.angle + 180)}:${round(element.length)}) -- cycle;`,
    ];
  },
});
