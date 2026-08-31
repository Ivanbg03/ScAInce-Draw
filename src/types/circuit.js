/**
 * Circuit schematic symbols.
 *
 * Every two-terminal part shares one geometry: a centre, a total lead-to-lead
 * length and an angle. The symbol sits in the middle and the leads fill the
 * rest, so parts chain together cleanly on a grid.
 *
 * The TikZ export emits circuitikz — `\draw (a) to[R, l=$R_1$] (b);` — rather
 * than hand-drawn paths. That is how a circuit is written in LaTeX, and the
 * printed symbol then follows the package's own conventions. The consequence
 * is honest but worth knowing: on screen the symbol size follows the "size"
 * field, while in the PDF circuitikz decides it.
 */

import { svg, DEG, round } from '../dom.js';
import { MATH_FONT } from '../mathtext.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, tip, parsePoints, formatPoints } from './shared.js';

const CIRCUITIKZ = '% \\usepackage{circuitikz}';

/* --------------------------- geometry ---------------------------- */

/** A local frame: along the wire, and across it. */
function frame(element) {
  const cos = Math.cos(element.angle * DEG);
  const sin = Math.sin(element.angle * DEG);
  const at = (along, across = 0) => ({
    x: element.x + along * cos - across * sin,
    y: element.y + along * sin + across * cos,
  });
  const half = element.length / 2;
  const bodyHalf = Math.min(half * 0.85, element.size * 0.75);
  return { at, half, bodyHalf };
}

/** The shared schema of a two-terminal part. */
function twoTerminal(extra = {}) {
  return {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The lead-to-lead length in diagram units.', default: 3, minimum: 0.4 },
      angle: { type: 'number', description: 'The direction in degrees.', default: 0, minimum: -360, maximum: 360 },
      size: { type: 'number', description: 'The symbol size across the wire.', default: 0.7, minimum: 0.1, maximum: 4 },
      ...extra,
      ...STROKE,
      ...LABEL,
      value: { type: 'string', description: 'A measured value shown opposite the label, for example 10\\,k\\Omega. Leave empty if unknown; do not repeat the label.', default: '' },
      labelSide: { type: 'string', enum: ['left', 'right'], description: 'Which side of the wire the label sits on.', default: 'left' },
    },
    required: ['x', 'y', 'length'],
  };
}

const twoTerminalAnchor = (element) => ({ x: element.x, y: element.y });
const twoTerminalMove = (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy });

function twoTerminalHandles(element) {
  const end = tip(element.x, element.y, element.length / 2, element.angle);
  return [{
    x: end.x,
    y: end.y,
    set: (target) => ({
      length: round(Math.hypot(target.x - element.x, target.y - element.y) * 2, 2) || 0.4,
      angle: round(Math.atan2(target.y - element.y, target.x - element.x) / DEG, 1),
    }),
  }];
}

/** Draws a path through document points. */
function pathOf(points, ctx, attrs) {
  const screen = points.map((point) => ctx.S(point.x, point.y));
  return svg('path', {
    d: screen.map((point, index) => `${index ? 'L' : 'M'}${round(point.x, 2)} ${round(point.y, 2)}`).join(' '),
    ...attrs,
  });
}

/** The two lead wires either side of the symbol body. */
function leads(element, ctx, group) {
  const { at, half, bodyHalf } = frame(element);
  const paint = strokeAttrs(element);
  group.append(pathOf([at(-half), at(-bodyHalf)], ctx, paint));
  group.append(pathOf([at(bodyHalf), at(half)], ctx, paint));
}

/** The label above the part and the value below it. */
function annotate(element, ctx, group) {
  const { at } = frame(element);
  const side = element.labelSide === 'right' ? -1 : 1;
  const gap = element.size * 0.55 + 0.35;

  if (element.label) {
    const spot = at(0, gap * side);
    const point = ctx.S(spot.x, spot.y);
    group.append(ctx.text(element.label, {
      x: point.x, y: point.y, size: element.labelSize, color: element.color,
    }));
  }
  if (element.value) {
    const spot = at(0, -gap * side);
    const point = ctx.S(spot.x, spot.y);
    group.append(ctx.text(element.value, {
      x: point.x, y: point.y, size: element.labelSize * 0.9, color: element.color,
    }));
  }
}

/** The circuitikz line for a two-terminal part. */
function bipole(element, ctx, component) {
  const { at, half } = frame(element);
  const start = at(-half);
  const end = at(half);
  // The label and the value are braced. Without braces a comma or an equals
  // sign inside a label would be read as another circuitikz option.
  const options = [component];
  if (element.label) options.push(`l={${ctx.math(element.label)}}`);
  if (element.value) options.push(`a={${ctx.math(element.value)}}`);
  if (element.labelSide === 'right') options.push('mirror');

  return [
    CIRCUITIKZ,
    `\\draw[${tikzStroke(element, ctx)}] ${ctx.P(start.x, start.y)} to[${
      options.join(', ')}] ${ctx.P(end.x, end.y)};`,
  ];
}

/** Boilerplate shared by every two-terminal definition. */
function bipoleType(definition) {
  return defineType({
    group: 'Circuit',
    anchor: twoTerminalAnchor,
    move: twoTerminalMove,
    handles: twoTerminalHandles,
    ...definition,
  });
}

/* ---------------------------- resistor --------------------------- */

bipoleType({
  name: 'resistor',
  label: 'Resistor',
  hint: 'A resistor, as a zigzag or as an IEC box.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['zigzag', 'box'], description: 'The symbol style.', default: 'zigzag' },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, bodyHalf } = frame(element);
    const amplitude = element.size / 2;
    leads(element, ctx, group);

    if (element.kind === 'box') {
      const corners = [
        at(-bodyHalf, amplitude), at(bodyHalf, amplitude),
        at(bodyHalf, -amplitude), at(-bodyHalf, -amplitude), at(-bodyHalf, amplitude),
      ];
      group.append(pathOf(corners, ctx, strokeAttrs(element, { fill: '#ffffff' })));
    } else {
      const zigs = 6;
      const points = [at(-bodyHalf)];
      for (let index = 0; index < zigs; index++) {
        const along = -bodyHalf + ((index + 0.5) / zigs) * bodyHalf * 2;
        points.push(at(along, (index % 2 ? -1 : 1) * amplitude));
      }
      points.push(at(bodyHalf));
      group.append(pathOf(points, ctx, strokeAttrs(element)));
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx, element.kind === 'box' ? 'R' : 'R'),
});

/* --------------------------- capacitor --------------------------- */

bipoleType({
  name: 'capacitor',
  label: 'Capacitor',
  hint: 'A capacitor: plain, polarised or variable.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['plain', 'polarised', 'variable'], description: 'The symbol style.', default: 'plain' },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, half } = frame(element);
    const gap = Math.min(element.size * 0.35, element.length * 0.2);
    const plate = element.size / 2;
    const paint = strokeAttrs(element);

    group.append(pathOf([at(-half), at(-gap)], ctx, paint));
    group.append(pathOf([at(gap), at(half)], ctx, paint));
    group.append(pathOf([at(-gap, plate), at(-gap, -plate)], ctx, paint));

    if (element.kind === 'polarised') {
      // The positive plate is a shallow arc bowing away from the gap.
      const a = ctx.S(at(gap, plate).x, at(gap, plate).y);
      const b = ctx.S(at(gap, -plate).x, at(gap, -plate).y);
      const bulge = ctx.L(gap * 1.2);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const nx = (b.y - a.y);
      const ny = -(b.x - a.x);
      const length = Math.hypot(nx, ny) || 1;
      group.append(svg('path', {
        d: `M${a.x} ${a.y} Q${midX + (nx / length) * bulge} ${midY + (ny / length) * bulge} ${b.x} ${b.y}`,
        ...paint,
      }));
      const plus = at(-gap * 2.4, plate * 1.1);
      const point = ctx.S(plus.x, plus.y);
      group.append(ctx.text('+', { x: point.x, y: point.y, size: element.labelSize, color: element.color }));
    } else {
      group.append(pathOf([at(gap, plate), at(gap, -plate)], ctx, paint));
    }

    if (element.kind === 'variable') {
      const from = at(-element.size * 0.9, -element.size * 0.8);
      const to = at(element.size * 0.9, element.size * 0.8);
      const a = ctx.S(from.x, from.y);
      const b = ctx.S(to.x, to.y);
      group.append(svg('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        ...strokeAttrs(element), 'marker-end': ctx.arrow(element.color),
      }));
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx,
    { plain: 'C', polarised: 'eC', variable: 'vC' }[element.kind]),
});

/* ---------------------------- inductor --------------------------- */

bipoleType({
  name: 'inductor',
  label: 'Inductor',
  hint: 'A coil, drawn as a row of half loops.',
  schema: twoTerminal({
    loops: { type: 'number', description: 'The number of half loops.', default: 4, minimum: 1, maximum: 12 },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, bodyHalf } = frame(element);
    leads(element, ctx, group);

    const loops = Math.max(1, Math.round(element.loops));
    const span = (bodyHalf * 2) / loops;
    const radius = ctx.L(span / 2);
    const parts = [];

    for (let index = 0; index < loops; index++) {
      const start = at(-bodyHalf + index * span);
      const end = at(-bodyHalf + (index + 1) * span);
      const a = ctx.S(start.x, start.y);
      const b = ctx.S(end.x, end.y);
      parts.push(`${index === 0 ? `M${a.x} ${a.y} ` : ''}A${radius} ${radius} 0 0 1 ${b.x} ${b.y}`);
    }

    group.append(svg('path', { d: parts.join(' '), ...strokeAttrs(element) }));
    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx, 'L'),
});

/* ----------------------------- source ---------------------------- */

const SOURCE_TIKZ = { battery: 'battery1', dc: 'V', ac: 'sV', current: 'I' };

bipoleType({
  name: 'source',
  label: 'Source',
  hint: 'A battery, a DC or AC voltage source, or a current source.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['battery', 'dc', 'ac', 'current'], description: 'The kind of source.', default: 'battery' },
    cells: { type: 'number', description: 'The number of cells in a battery.', default: 2, minimum: 1, maximum: 6 },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, half, bodyHalf } = frame(element);
    const paint = strokeAttrs(element);

    if (element.kind === 'battery') {
      group.append(pathOf([at(-half), at(-bodyHalf)], ctx, paint));
      group.append(pathOf([at(bodyHalf), at(half)], ctx, paint));

      const cells = Math.max(1, Math.round(element.cells));
      const bars = cells * 2;
      const step = (bodyHalf * 2) / (bars - 1 || 1);
      for (let index = 0; index < bars; index++) {
        const along = -bodyHalf + index * step;
        // A long bar is the positive plate, a short bar the negative one.
        const reach = (index % 2 === 0) ? element.size * 0.5 : element.size * 0.25;
        group.append(pathOf([at(along, reach), at(along, -reach)], ctx,
          strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * (index % 2 === 0 ? 1 : 1.4) })));
      }
    } else {
      const radius = element.size * 0.75;
      const centre = ctx.S(element.x, element.y);
      group.append(pathOf([at(-half), at(-radius)], ctx, paint));
      group.append(pathOf([at(radius), at(half)], ctx, paint));
      group.append(svg('circle', {
        cx: centre.x, cy: centre.y, r: ctx.L(radius),
        ...strokeAttrs(element, { fill: '#ffffff' }),
      }));

      if (element.kind === 'dc') {
        const plus = ctx.S(at(radius * 0.45).x, at(radius * 0.45).y);
        const minus = ctx.S(at(-radius * 0.45).x, at(-radius * 0.45).y);
        for (const [point, glyph] of [[plus, '+'], [minus, '−']]) {
          group.append(ctx.text(glyph, {
            x: point.x, y: point.y, size: element.labelSize, color: element.color,
          }));
        }
      } else if (element.kind === 'ac') {
        const wave = [];
        const steps = 24;
        for (let index = 0; index <= steps; index++) {
          const along = -radius * 0.6 + (index / steps) * radius * 1.2;
          const across = Math.sin((index / steps) * Math.PI * 2) * radius * 0.32;
          wave.push(at(along, across));
        }
        group.append(pathOf(wave, ctx, strokeAttrs(element)));
      } else {
        const from = at(-radius * 0.55);
        const to = at(radius * 0.55);
        const a = ctx.S(from.x, from.y);
        const b = ctx.S(to.x, to.y);
        group.append(svg('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          ...paint, 'marker-end': ctx.arrow(element.color),
        }));
      }
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx, SOURCE_TIKZ[element.kind]),
});

/* ----------------------------- switch ---------------------------- */

bipoleType({
  name: 'switch',
  label: 'Switch',
  hint: 'An open, closed or push-button switch.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['open', 'closed', 'push'], description: 'The switch state.', default: 'open' },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, bodyHalf } = frame(element);
    const paint = strokeAttrs(element);
    leads(element, ctx, group);

    const dotRadius = Math.max(2, ctx.L(element.size * 0.09));
    for (const along of [-bodyHalf, bodyHalf]) {
      const point = ctx.S(at(along).x, at(along).y);
      group.append(svg('circle', { cx: point.x, cy: point.y, r: dotRadius, fill: element.color }));
    }

    // The lever pivots on the left contact.
    const lift = element.kind === 'closed' ? 0 : element.size * 0.8;
    group.append(pathOf([at(-bodyHalf), at(bodyHalf * 0.9, lift)], ctx, paint));

    if (element.kind === 'push') {
      const bar = element.size * 0.5;
      group.append(pathOf([at(-bar, lift * 1.35), at(bar, lift * 1.35)], ctx, paint));
      group.append(pathOf([at(0, lift * 1.35), at(0, lift * 0.95)], ctx, paint));
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx,
    { open: 'nos', closed: 'ncs', push: 'push button' }[element.kind]),
});

/* ----------------------------- diode ----------------------------- */

bipoleType({
  name: 'diode',
  label: 'Diode',
  hint: 'A diode, a light emitting diode or a Zener diode.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['diode', 'led', 'zener'], description: 'The diode type.', default: 'diode' },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, bodyHalf } = frame(element);
    const paint = strokeAttrs(element);
    const reach = element.size / 2;
    leads(element, ctx, group);

    group.append(pathOf(
      [at(-bodyHalf, reach), at(bodyHalf), at(-bodyHalf, -reach), at(-bodyHalf, reach)],
      ctx, strokeAttrs(element, { fill: element.color }),
    ));

    if (element.kind === 'zener') {
      group.append(pathOf(
        [at(bodyHalf - reach * 0.4, reach), at(bodyHalf, reach), at(bodyHalf, -reach), at(bodyHalf + reach * 0.4, -reach)],
        ctx, paint,
      ));
    } else {
      group.append(pathOf([at(bodyHalf, reach), at(bodyHalf, -reach)], ctx, paint));
    }

    if (element.kind === 'led') {
      for (const offset of [-0.3, 0.3]) {
        const from = at(offset * element.size, reach * 1.1);
        const to = at(offset * element.size + element.size * 0.4, reach * 1.9);
        const a = ctx.S(from.x, from.y);
        const b = ctx.S(to.x, to.y);
        group.append(svg('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          ...strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.8 }),
          'marker-end': ctx.arrow(element.color),
        }));
      }
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx,
    { diode: 'D', led: 'leD', zener: 'zD' }[element.kind]),
});

/* ------------------------------ lamp ----------------------------- */

bipoleType({
  name: 'lamp',
  label: 'Lamp',
  hint: 'A filament lamp: a circle with a cross.',
  schema: twoTerminal(),
  render(element, ctx) {
    const group = svg('g');
    const { at, half } = frame(element);
    const radius = element.size * 0.7;
    const centre = ctx.S(element.x, element.y);
    const paint = strokeAttrs(element);

    group.append(pathOf([at(-half), at(-radius)], ctx, paint));
    group.append(pathOf([at(radius), at(half)], ctx, paint));
    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: ctx.L(radius),
      ...strokeAttrs(element, { fill: '#ffffff' }),
    }));

    const reach = radius * 0.72;
    for (const rotation of [45, -45]) {
      const from = tip(element.x, element.y, reach, element.angle + rotation + 180);
      const to = tip(element.x, element.y, reach, element.angle + rotation);
      const a = ctx.S(from.x, from.y);
      const b = ctx.S(to.x, to.y);
      group.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...paint }));
    }

    annotate(element, ctx, group);
    return group;
  },
  tikz: (element, ctx) => bipole(element, ctx, 'lamp'),
});

/* ------------------------------ meter ---------------------------- */

const METER_GLYPH = { ammeter: 'A', voltmeter: 'V', ohmmeter: 'Ω', galvanometer: 'G' };

bipoleType({
  name: 'meter',
  label: 'Meter',
  hint: 'An ammeter, a voltmeter, an ohmmeter or a galvanometer.',
  schema: twoTerminal({
    kind: { type: 'string', enum: ['ammeter', 'voltmeter', 'ohmmeter', 'galvanometer'], description: 'What the meter reads. A galvanometer is the null detector in a bridge.', default: 'ammeter' },
  }),
  render(element, ctx) {
    const group = svg('g');
    const { at, half } = frame(element);
    const radius = element.size * 0.75;
    const centre = ctx.S(element.x, element.y);
    const paint = strokeAttrs(element);

    group.append(pathOf([at(-half), at(-radius)], ctx, paint));
    group.append(pathOf([at(radius), at(half)], ctx, paint));
    group.append(svg('circle', {
      cx: centre.x, cy: centre.y, r: ctx.L(radius),
      ...strokeAttrs(element, { fill: '#ffffff' }),
    }));

    const glyph = svg('text', {
      x: centre.x, y: centre.y,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': ctx.L(radius) * 1.1,
      fill: element.color,
      'font-family': MATH_FONT,
    });
    glyph.textContent = METER_GLYPH[element.kind];
    group.append(glyph);

    annotate(element, ctx, group);
    return group;
  },
  // circuitikz has no galvanometer, so it is a round meter lettered G.
  tikz: (element, ctx) => bipole(element, ctx,
    element.kind === 'galvanometer' ? 'rmeter, t=G' : element.kind),
});

/* ----------------------------- ground ---------------------------- */

defineType({
  name: 'ground',
  label: 'Ground',
  group: 'Circuit',
  hint: 'An earth, chassis or signal ground symbol.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      kind: { type: 'string', enum: ['earth', 'chassis', 'signal'], description: 'The ground symbol.', default: 'earth' },
      size: { type: 'number', description: 'The symbol size in diagram units.', default: 0.7, minimum: 0.1 },
      angle: { type: 'number', description: 'The rotation in degrees. 0 points the stem up.', default: 0, minimum: -180, maximum: 180 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'kind'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const group = svg('g');
    const paint = strokeAttrs(element);
    // The connection point is at the top. "down" runs away from it along the
    // stem, "across" runs sideways.
    const cos = Math.cos(element.angle * DEG);
    const sin = Math.sin(element.angle * DEG);
    const at = (down, across = 0) => {
      const along = across * element.size;
      const away = -down * element.size;
      return {
        x: element.x + along * cos - away * sin,
        y: element.y + along * sin + away * cos,
      };
    };

    group.append(pathOf([at(0), at(0.55)], ctx, paint));

    if (element.kind === 'signal') {
      group.append(pathOf([at(0.55, -0.55), at(0.55, 0.55), at(1.35), at(0.55, -0.55)], ctx,
        strokeAttrs(element, { fill: element.color })));
    } else if (element.kind === 'chassis') {
      group.append(pathOf([at(0.55, -0.55), at(0.55, 0.55)], ctx, paint));
      for (const across of [-0.45, 0, 0.45]) {
        group.append(pathOf([at(0.55, across), at(1.15, across - 0.3)], ctx, paint));
      }
    } else {
      const bars = [[0.55, 0.6], [0.8, 0.38], [1.05, 0.17]];
      for (const [down, reach] of bars) {
        group.append(pathOf([at(down, -reach), at(down, reach)], ctx, paint));
      }
    }

    if (element.label) {
      const spot = at(1.5);
      const point = ctx.S(spot.x, spot.y);
      group.append(ctx.text(element.label, {
        x: point.x, y: point.y, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const node = { earth: 'ground', chassis: 'rground', signal: 'sground' }[element.kind];
    const lines = [
      CIRCUITIKZ,
      `\\draw ${ctx.P(element.x, element.y)} node[${node}${
        element.angle ? `, rotate=${round(element.angle)}` : ''}] {};`,
    ];
    if (element.label) {
      lines.push(`\\node[below] at ${ctx.P(element.x, element.y - element.size * 1.5)} {${
        ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ wire ----------------------------- */

/** Right-angle waypoints between the given corners. */
function routeWire(points, route) {
  if (route === 'direct' || points.length < 2) return points;
  const routed = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const from = routed[routed.length - 1];
    const to = points[index];
    if (from.x !== to.x && from.y !== to.y) routed.push({ x: to.x, y: from.y });
    routed.push(to);
  }
  return routed;
}

defineType({
  name: 'wire',
  label: 'Wire',
  group: 'Circuit',
  hint: 'A connecting wire, routed at right angles, with optional solder dots.',
  schema: {
    type: 'object',
    properties: {
      points: {
        type: 'string', format: 'points',
        description: 'The corners as "x,y x,y x,y" in diagram units.',
        default: '0,0 4,0 4,3',
      },
      route: { type: 'string', enum: ['orthogonal', 'direct'], description: 'Right angles, or straight between corners.', default: 'orthogonal' },
      dots: { type: 'string', enum: ['none', 'ends', 'corners'], description: 'Where to draw a solder dot.', default: 'none' },
      dotSize: { type: 'number', description: 'The solder dot radius in px.', default: 3.5, minimum: 1, maximum: 12 },
      ...STROKE,
      ...LABEL,
    },
    required: ['points'],
  },
  anchor(element) {
    return parsePoints(element.points)[0] || { x: 0, y: 0 };
  },
  move(element, dx, dy) {
    const points = parsePoints(element.points).map((point) => ({
      x: round(point.x + dx, 3), y: round(point.y + dy, 3),
    }));
    return { points: formatPoints(points) };
  },
  render(element, ctx) {
    const corners = parsePoints(element.points);
    if (corners.length < 2) return svg('g');
    const routed = routeWire(corners, element.route);

    const group = svg('g');
    group.append(pathOf(routed, ctx, strokeAttrs(element)));

    if (element.dots !== 'none') {
      const marked = element.dots === 'ends'
        ? [corners[0], corners[corners.length - 1]]
        : corners;
      for (const corner of marked) {
        const point = ctx.S(corner.x, corner.y);
        group.append(svg('circle', {
          cx: point.x, cy: point.y, r: element.dotSize, fill: element.color,
        }));
      }
    }

    if (element.label) {
      const last = routed[routed.length - 1];
      const point = ctx.S(last.x, last.y);
      group.append(ctx.text(element.label, {
        x: point.x + 10, y: point.y - 10, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const corners = parsePoints(element.points);
    if (corners.length < 2) return [];
    const routed = routeWire(corners, element.route);
    const lines = [
      `\\draw[${tikzStroke(element, ctx)}] ${
        routed.map((point) => ctx.P(point.x, point.y)).join(' -- ')};`,
    ];
    if (element.dots !== 'none') {
      const marked = element.dots === 'ends'
        ? [corners[0], corners[corners.length - 1]]
        : corners;
      for (const corner of marked) {
        lines.push(`\\fill[${ctx.color(element.color)}] ${ctx.P(corner.x, corner.y)} circle (${
          ctx.px(element.dotSize)});`);
      }
    }
    return lines;
  },
});
