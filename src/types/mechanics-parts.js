/** Machine parts for a free-body diagram: spring, damper, support, pulley. */

import { svg, DEG, round } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL, wheelAnchors, wheelRuns } from '../registry.js';
import { strokeAttrs, tikzStroke, tip, angleBetween, distance } from './shared.js';

/** A local-to-document mapper for a part placed at x,y and turned by angle. */
function placer(element) {
  const cos = Math.cos((element.angle || 0) * DEG);
  const sin = Math.sin((element.angle || 0) * DEG);
  return (along, across) => ({
    x: element.x + along * cos - across * sin,
    y: element.y + along * sin + across * cos,
  });
}

/** A length-and-angle drag handle shared by the spring and the damper. */
function endHandle(element) {
  const end = tip(element.x, element.y, element.length, element.angle);
  return [{
    x: end.x,
    y: end.y,
    set: (target) => ({
      length: round(Math.hypot(target.x - element.x, target.y - element.y), 2) || 0.2,
      angle: round(Math.atan2(target.y - element.y, target.x - element.x) / DEG, 1),
    }),
  }];
}

/** Draws a path through document points. */
function pathOf(points, ctx, attrs) {
  const screen = points.map((point) => ctx.S(point.x, point.y));
  return svg('path', {
    d: screen.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
    ...attrs,
  });
}

/* ----------------------------- spring ---------------------------- */

function coilPoints(element) {
  const at = placer(element);
  const lead = Math.min(0.4, element.length * 0.18);
  const body = Math.max(0.05, element.length - lead * 2);
  const steps = Math.max(2, Math.round(element.coils) * 2);

  const points = [at(0, 0), at(lead, 0)];
  for (let index = 1; index <= steps; index++) {
    const along = lead + (index - 0.5) * (body / steps);
    points.push(at(along, (index % 2 ? 1 : -1) * element.amplitude));
  }
  points.push(at(lead + body, 0), at(element.length, 0));
  return points;
}

defineType({
  name: 'spring',
  label: 'Spring',
  group: 'Mechanics',
  hint: 'A coil spring between two points, for a stiffness k.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The length in diagram units.', default: 3, minimum: 0.2 },
      angle: { type: 'number', description: 'The direction in degrees.', default: 0, minimum: -360, maximum: 360 },
      coils: { type: 'number', description: 'The number of coils.', default: 6, minimum: 1, maximum: 40 },
      amplitude: { type: 'number', description: 'The coil half height in diagram units.', default: 0.3, minimum: 0.02 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: endHandle,
  render(element, ctx) {
    const group = svg('g');
    group.append(pathOf(coilPoints(element), ctx, strokeAttrs(element)));
    if (element.label) {
      const at = placer(element);
      const spot = at(element.length / 2, element.amplitude);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y - 12, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const points = coilPoints(element);
    const lines = [`\\draw[${tikzStroke(element, ctx)}] ${
      points.map((point) => ctx.P(point.x, point.y)).join(' -- ')};`];
    if (element.label) {
      const at = placer(element);
      const spot = at(element.length / 2, element.amplitude);
      lines.push(`\\node[above] at ${ctx.P(spot.x, spot.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- damper ---------------------------- */

function damperParts(element) {
  const at = placer(element);
  const cupStart = element.length * 0.35;
  const cupEnd = element.length * 0.8;
  const piston = element.length * 0.62;
  const size = element.size;

  return {
    strokes: [
      [at(0, 0), at(piston, 0)],
      [at(cupEnd, 0), at(element.length, 0)],
      [at(cupEnd, size), at(cupStart, size), at(cupStart, -size), at(cupEnd, -size)],
      [at(piston, size * 0.82), at(piston, -size * 0.82)],
    ],
    top: at(element.length / 2, size),
  };
}

defineType({
  name: 'damper',
  label: 'Damper',
  group: 'Mechanics',
  hint: 'A dashpot for a viscous damping coefficient c.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The length in diagram units.', default: 3, minimum: 0.2 },
      angle: { type: 'number', description: 'The direction in degrees.', default: 0, minimum: -360, maximum: 360 },
      size: { type: 'number', description: 'The cup half height in diagram units.', default: 0.35, minimum: 0.02 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  handles: endHandle,
  render(element, ctx) {
    const parts = damperParts(element);
    const group = svg('g');
    const paint = strokeAttrs(element);
    for (const stroke of parts.strokes) group.append(pathOf(stroke, ctx, paint));

    if (element.label) {
      const point = ctx.S(parts.top.x, parts.top.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y - 12, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const parts = damperParts(element);
    const options = tikzStroke(element, ctx);
    const lines = parts.strokes.map((stroke) =>
      `\\draw[${options}] ${stroke.map((point) => ctx.P(point.x, point.y)).join(' -- ')};`);
    if (element.label) {
      lines.push(`\\node[above] at ${ctx.P(parts.top.x, parts.top.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- support --------------------------- */

defineType({
  name: 'support',
  label: 'Support',
  group: 'Mechanics',
  hint: 'A pin, a roller or a fixed support with a hatched ground.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      kind: { type: 'string', enum: ['pin', 'roller', 'fixed'], description: 'The support type.', default: 'pin' },
      size: { type: 'number', description: 'The symbol size in diagram units.', default: 0.7, minimum: 0.05 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      fill: { type: 'string', format: 'color', description: 'The fill colour.', default: '#e2e8f0' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'kind'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const at = placer(element);
    const size = element.size;
    const group = svg('g');
    const paint = strokeAttrs(element, { fill: element.fill });
    const wheel = element.kind === 'roller' ? size * 0.22 : 0;
    const baseAcross = -size;
    const groundAcross = baseAcross - wheel * 2;

    if (element.kind === 'fixed') {
      group.append(pathOf([at(-size, 0), at(size, 0)], ctx,
        strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 1.4 })));
    } else {
      group.append(pathOf(
        [at(0, 0), at(-size * 0.8, baseAcross), at(size * 0.8, baseAcross), at(0, 0)],
        ctx, paint,
      ));
    }

    if (element.kind === 'roller') {
      for (const offset of [-0.45, 0.45]) {
        const centre = at(size * offset, baseAcross - wheel);
        const point = ctx.S(centre.x, centre.y);
        group.append(svg('circle', { cx: point.x, cy: point.y, r: ctx.L(wheel), ...paint }));
      }
    }

    // The ground line and its hatch strokes.
    const half = element.kind === 'fixed' ? size : size * 1.05;
    const groundLevel = element.kind === 'fixed' ? 0 : groundAcross;
    group.append(pathOf([at(-half, groundLevel), at(half, groundLevel)], ctx, strokeAttrs(element)));

    const ticks = 6;
    const tickPaint = strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.6 });
    for (let index = 0; index <= ticks; index++) {
      const along = -half + (index / ticks) * half * 2;
      group.append(pathOf(
        [at(along, groundLevel), at(along - size * 0.28, groundLevel - size * 0.28)],
        ctx, tickPaint,
      ));
    }

    if (element.label) {
      const spot = at(0, groundLevel - size * 0.45);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y, baseline: 'hanging', size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const at = placer(element);
    const size = element.size;
    const options = tikzStroke(element, ctx, [`fill=${ctx.color(element.fill)}`]);
    const wheel = element.kind === 'roller' ? size * 0.22 : 0;
    const baseAcross = -size;
    const groundLevel = element.kind === 'fixed' ? 0 : baseAcross - wheel * 2;
    const half = element.kind === 'fixed' ? size : size * 1.05;
    const lines = [];

    if (element.kind === 'fixed') {
      const a = at(-size, 0);
      const b = at(size, 0);
      lines.push(`\\draw[${tikzStroke(element, ctx)}] ${ctx.P(a.x, a.y)} -- ${ctx.P(b.x, b.y)};`);
    } else {
      const apex = at(0, 0);
      const left = at(-size * 0.8, baseAcross);
      const right = at(size * 0.8, baseAcross);
      lines.push(`\\draw[${options}] ${ctx.P(apex.x, apex.y)} -- ${ctx.P(left.x, left.y)} -- ${
        ctx.P(right.x, right.y)} -- cycle;`);
    }

    if (element.kind === 'roller') {
      for (const offset of [-0.45, 0.45]) {
        const centre = at(size * offset, baseAcross - wheel);
        lines.push(`\\draw[${options}] ${ctx.P(centre.x, centre.y)} circle (${round(wheel, 3)});`);
      }
    }

    const left = at(-half, groundLevel);
    const right = at(half, groundLevel);
    lines.push(
      '% \\usetikzlibrary{patterns}',
      `\\path[pattern=north east lines, pattern color=${ctx.color(element.color)}] ${
        ctx.P(left.x, left.y)} rectangle ${ctx.P(right.x, right.y - size * 0.3)};`,
      `\\draw[${tikzStroke(element, ctx)}] ${ctx.P(left.x, left.y)} -- ${ctx.P(right.x, right.y)};`,
    );

    if (element.label) {
      const spot = at(0, groundLevel - size * 0.45);
      lines.push(`\\node[below] at ${ctx.P(spot.x, spot.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- pulley ---------------------------- */

defineType({
  name: 'pulley',
  label: 'Pulley',
  group: 'Mechanics',
  hint: 'A wheel with a rope run leaving each side. Each run has its own direction, so the rope can follow an incline instead of only hanging.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      radius: { type: 'number', description: 'The wheel radius in diagram units.', default: 0.6, minimum: 0.05 },

      ropeLeft: { type: 'number', description: 'Length of the left rope run. Zero draws none.', default: 2.5, minimum: 0 },
      ropeLeftAngle: { type: 'number', description: 'Direction the left run travels away from the wheel, in degrees. 270 hangs straight down; use the incline angle plus 180 to follow a slope.', default: 270, minimum: -360, maximum: 360 },
      ropeRight: { type: 'number', description: 'Length of the right rope run. Zero draws none.', default: 2.5, minimum: 0 },
      ropeRightAngle: { type: 'number', description: 'Direction the right run travels away from the wheel, in degrees. 270 hangs straight down.', default: 270, minimum: -360, maximum: 360 },

      showBracket: { type: 'boolean', description: 'Draw the mount that fixes the wheel to its support.', default: true },
      mountAngle: { type: 'number', description: 'Direction of the mount, in degrees. 90 points straight up to a ceiling.', default: 90, minimum: -360, maximum: 360 },
      mountLength: { type: 'number', description: 'Length of the mount in diagram units, independent of the wheel size.', default: 1.3, minimum: 0 },

      fill: { type: 'string', format: 'color', description: 'The wheel fill colour.', default: '#e2e8f0' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'radius'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  anchors: (element) => wheelAnchors(element),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),

  // Four grips, so the wheel is editable by dragging rather than by typing
  // four numbers. The radius grip sits off the axes to keep clear of the two
  // rope touch points.
  handles: (element) => {
    const runs = wheelRuns(element);
    const diagonal = Math.SQRT1_2;
    const spun = (from, to) => round(angleBetween(from, to), 1);
    const away = (from, to) => round(distance(from, to), 2);

    const grips = [{
      x: element.x + runs.radius * diagonal,
      y: element.y + runs.radius * diagonal,
      set: (point) => ({ radius: Math.max(0.05, away({ x: element.x, y: element.y }, point)) }),
    }];

    if (runs.left.span > 0) {
      grips.push({
        x: runs.left.end.x,
        y: runs.left.end.y,
        set: (point) => ({
          ropeLeft: Math.max(0, away(runs.left.touch, point)),
          ropeLeftAngle: spun(runs.left.touch, point),
        }),
      });
    }
    if (runs.right.span > 0) {
      grips.push({
        x: runs.right.end.x,
        y: runs.right.end.y,
        set: (point) => ({
          ropeRight: Math.max(0, away(runs.right.touch, point)),
          ropeRightAngle: spun(runs.right.touch, point),
        }),
      });
    }
    if (element.showBracket && runs.mount.span > 0) {
      grips.push({
        x: runs.mount.end.x,
        y: runs.mount.end.y,
        set: (point) => ({
          mountLength: Math.max(0, away({ x: element.x, y: element.y }, point)),
          mountAngle: spun({ x: element.x, y: element.y }, point),
        }),
      });
    }
    return grips;
  },

  render(element, ctx) {
    const runs = wheelRuns(element);
    const centre = ctx.S(element.x, element.y);
    const radius = ctx.L(runs.radius);
    const group = svg('g');
    const paint = strokeAttrs(element);

    // The mount is drawn first, so the wheel sits over the stalk.
    if (element.showBracket && runs.mount.span > 0) {
      const end = ctx.S(runs.mount.end.x, runs.mount.end.y);
      const bar = runs.radius * 1.15;
      const across = { x: -runs.mount.way.y * bar, y: runs.mount.way.x * bar };
      const barA = ctx.S(runs.mount.end.x - across.x, runs.mount.end.y - across.y);
      const barB = ctx.S(runs.mount.end.x + across.x, runs.mount.end.y + across.y);
      group.append(svg('line', { x1: centre.x, y1: centre.y, x2: end.x, y2: end.y, ...paint }));
      group.append(svg('line', { x1: barA.x, y1: barA.y, x2: barB.x, y2: barB.y, ...paint }));

      // Hatching on the support, the same way a fixed surface is drawn.
      const ticks = 4;
      for (let index = 0; index <= ticks; index += 1) {
        const t = index / ticks;
        const base = {
          x: runs.mount.end.x - across.x + across.x * 2 * t,
          y: runs.mount.end.y - across.y + across.y * 2 * t,
        };
        const from = ctx.S(base.x, base.y);
        const to = ctx.S(
          base.x + runs.mount.way.x * runs.radius * 0.45 - across.x * 0.28,
          base.y + runs.mount.way.y * runs.radius * 0.45 - across.y * 0.28,
        );
        group.append(svg('line', {
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
          ...strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.6 }),
        }));
      }
    }

    // Each run starts where it touches the wheel, not at the wheel's side.
    for (const run of [runs.left, runs.right]) {
      if (run.span <= 0) continue;
      const from = ctx.S(run.touch.x, run.touch.y);
      const to = ctx.S(run.end.x, run.end.y);
      group.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, ...paint }));
    }

    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: radius, ...strokeAttrs(element, { fill: element.fill }),
    }));
    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: Math.max(1.5, radius * 0.12), fill: element.color,
    }));

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: centre.x + radius + 10, y: centre.y, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },

  tikz(element, ctx) {
    const runs = wheelRuns(element);
    const options = tikzStroke(element, ctx);
    const lines = [];

    if (element.showBracket && runs.mount.span > 0) {
      const bar = runs.radius * 1.15;
      const across = { x: -runs.mount.way.y * bar, y: runs.mount.way.x * bar };
      lines.push(
        `\\draw[${options}] ${ctx.P(element.x, element.y)} -- ${ctx.P(runs.mount.end.x, runs.mount.end.y)};`,
        `\\draw[${options}] ${ctx.P(runs.mount.end.x - across.x, runs.mount.end.y - across.y)} -- ${
          ctx.P(runs.mount.end.x + across.x, runs.mount.end.y + across.y)};`,
      );
    }

    for (const run of [runs.left, runs.right]) {
      if (run.span <= 0) continue;
      lines.push(`\\draw[${options}] ${ctx.P(run.touch.x, run.touch.y)} -- ${ctx.P(run.end.x, run.end.y)};`);
    }

    lines.push(
      `\\draw[${tikzStroke(element, ctx, [`fill=${ctx.color(element.fill)}`])}] ${
        ctx.P(element.x, element.y)} circle (${round(runs.radius, 3)});`,
      `\\filldraw[${ctx.color(element.color)}] ${ctx.P(element.x, element.y)} circle (${
        round(runs.radius * 0.12, 3)});`,
    );

    if (element.label) {
      lines.push(`\\node[right] at ${ctx.P(element.x + runs.radius, element.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});
