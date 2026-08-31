/** General geometry: a shape primitive and a coordinate frame. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL, boxAnchors, LABEL_PLACE } from '../registry.js';
import { strokeAttrs, tikzStroke, tip, labelPointOf } from './shared.js';

/* ----------------------------- shape ----------------------------- */

/** The outline points of a regular polygon or a rectangle. */
function outlinePoints(element) {
  const cos = Math.cos(element.angle * DEG);
  const sin = Math.sin(element.angle * DEG);
  const place = (local) => ({
    x: element.x + local.x * cos - local.y * sin,
    y: element.y + local.x * sin + local.y * cos,
  });

  if (element.kind === 'rect') {
    const halfW = element.width / 2;
    const halfH = element.height / 2;
    return [
      { x: -halfW, y: -halfH }, { x: halfW, y: -halfH },
      { x: halfW, y: halfH }, { x: -halfW, y: halfH },
    ].map(place);
  }

  const sides = Math.max(3, Math.min(24, Math.round(element.sides)));
  const radius = element.width / 2;
  const points = [];
  for (let index = 0; index < sides; index++) {
    const angle = (index / sides) * Math.PI * 2 + Math.PI / 2;
    points.push(place({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) }));
  }
  return points;
}

defineType({
  name: 'shape',
  label: 'Shape',
  group: 'Common',
  hint: 'A circle, an ellipse, a rectangle or a regular polygon.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      kind: { type: 'string', enum: ['circle', 'ellipse', 'rect', 'polygon'], description: 'The outline.', default: 'circle' },
      width: { type: 'number', description: 'The width, or the diameter of a circle.', default: 2.4, minimum: 0.05 },
      height: { type: 'number', description: 'The height. It is ignored for a circle and a polygon.', default: 1.6, minimum: 0.05 },
      sides: { type: 'number', description: 'The number of sides of a polygon.', default: 6, minimum: 3, maximum: 24 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      fill: { type: 'string', format: 'color', description: 'The fill colour. Use none for no fill.', default: 'none' },
      fillOpacity: { type: 'number', description: 'The fill opacity from 0 to 1.', default: 0.2, minimum: 0, maximum: 1 },
      ...STROKE,
      ...LABEL,
      ...LABEL_PLACE,
    },
    required: ['x', 'y', 'kind', 'width'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  anchors: (element) => boxAnchors(
    element.kind === 'circle' || element.kind === 'polygon'
      ? { ...element, height: element.width }
      : element,
  ),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: (element) => [{
    x: element.x + element.width / 2,
    y: element.y,
    set: (point) => ({ width: Math.max(0.05, round((point.x - element.x) * 2, 2)) }),
  }],
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const group = svg('g');
    const paint = strokeAttrs(element, {
      fill: element.fill === 'none' ? 'none' : element.fill,
      'fill-opacity': element.fill === 'none' ? null : element.fillOpacity,
    });

    if (element.kind === 'circle') {
      group.append(svg('circle', { cx: centre.x, cy: centre.y, r: ctx.L(element.width / 2), ...paint }));
    } else if (element.kind === 'ellipse') {
      group.append(svg('ellipse', {
        cx: centre.x, cy: centre.y,
        rx: ctx.L(element.width / 2), ry: ctx.L(element.height / 2),
        transform: element.angle ? `rotate(${-element.angle} ${centre.x} ${centre.y})` : null,
        ...paint,
      }));
    } else {
      const points = outlinePoints(element).map((point) => ctx.S(point.x, point.y));
      group.append(svg('polygon', {
        points: points.map((point) => `${point.x},${point.y}`).join(' '),
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
    const extra = [];
    if (element.fill !== 'none') {
      extra.push(`fill=${ctx.color(element.fill)}`, `fill opacity=${element.fillOpacity}`);
    }
    const options = tikzStroke(element, ctx, extra);
    const lines = [];

    if (element.kind === 'circle') {
      lines.push(`\\draw[${options}] ${ctx.P(element.x, element.y)} circle (${round(element.width / 2, 3)});`);
    } else if (element.kind === 'ellipse') {
      const rotate = element.angle ? `[rotate=${round(element.angle)}] ` : '';
      lines.push(`\\draw[${options}] ${rotate}${ctx.P(element.x, element.y)} ellipse (${
        round(element.width / 2, 3)} and ${round(element.height / 2, 3)});`);
    } else {
      lines.push(`\\draw[${options}] ${
        outlinePoints(element).map((point) => ctx.P(point.x, point.y)).join(' -- ')} -- cycle;`);
    }

    if (element.label) {
      const spot = labelPointOf(element, ctx.byId);
      lines.push(`\\node at ${ctx.P(spot.x, spot.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* --------------------------- axis frame -------------------------- */

/** The three arm end points of a frame, 2D or in an oblique 3D view. */
function frameArms(element) {
  const base = element.angle;
  if (element.kind === '2d') {
    return [
      { name: element.xLabel, end: tip(element.x, element.y, element.size, base) },
      { name: element.yLabel, end: tip(element.x, element.y, element.size, base + 90) },
    ];
  }
  // An oblique projection: z goes up, x goes right, y recedes at 210 degrees.
  return [
    { name: element.xLabel, end: tip(element.x, element.y, element.size, base) },
    { name: element.yLabel, end: tip(element.x, element.y, element.size * 0.72, base + 210) },
    { name: element.zLabel, end: tip(element.x, element.y, element.size, base + 90) },
  ];
}

defineType({
  name: 'axis-frame',
  label: 'Coordinate frame',
  group: 'Common',
  hint: 'A two or three axis frame, for a reference direction or a body frame.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      kind: { type: 'string', enum: ['2d', '3d'], description: 'Two axes, or three in an oblique view.', default: '2d' },
      size: { type: 'number', description: 'The arm length in diagram units.', default: 1.6, minimum: 0.05 },
      angle: { type: 'number', description: 'The rotation of the whole frame in degrees.', default: 0, minimum: -180, maximum: 180 },
      xLabel: { type: 'string', description: 'The first axis label.', default: 'x' },
      yLabel: { type: 'string', description: 'The second axis label.', default: 'y' },
      zLabel: { type: 'string', description: 'The third axis label, used in the 3d view.', default: 'z' },
      ...STROKE,
      labelSize: { type: 'number', description: 'The axis label size in px.', default: 14, minimum: 6, maximum: 48 },
    },
    required: ['x', 'y', 'kind', 'size'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const origin = ctx.S(element.x, element.y);
    const group = svg('g');
    const paint = strokeAttrs(element);

    for (const arm of frameArms(element)) {
      const end = ctx.S(arm.end.x, arm.end.y);
      group.append(svg('line', {
        x1: origin.x, y1: origin.y, x2: end.x, y2: end.y,
        ...paint,
        'marker-end': ctx.arrow(element.color),
      }));
      if (arm.name) {
        // Push the label a little further along the same direction.
        const dx = end.x - origin.x;
        const dy = end.y - origin.y;
        const length = Math.hypot(dx, dy) || 1;
        group.append(ctx.text(arm.name, {
          x: end.x + (dx / length) * 12,
          y: end.y + (dy / length) * 12,
          size: element.labelSize, color: element.color,
        }));
      }
    }
    return group;
  },
  tikz(element, ctx) {
    const options = tikzStroke(element, ctx, ['->', '>=stealth']);
    const lines = [];
    for (const arm of frameArms(element)) {
      lines.push(`\\draw[${options}] ${ctx.P(element.x, element.y)} -- ${
        ctx.P(arm.end.x, arm.end.y)}${arm.name ? ` node[anchor=south west] {${ctx.math(arm.name)}}` : ''};`);
    }
    return lines;
  },
});
