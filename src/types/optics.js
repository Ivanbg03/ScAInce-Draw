/** Optics and geometry types: optical axis, lens, mirror, ray. */

import { svg, round, DEG } from '../dom.js';
import { defineType, POSITION, STROKE, LABEL } from '../registry.js';
import { strokeAttrs, tikzStroke, parsePoints, formatPoints, tip } from './shared.js';

/* -------------------------- optical axis ------------------------- */

defineType({
  name: 'optical-axis',
  label: 'Optical axis',
  group: 'Optics',
  hint: 'The dashed reference line that the elements sit on.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      length: { type: 'number', description: 'The length in diagram units.', default: 12, minimum: 0.1 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'length'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const from = ctx.S(element.x, element.y);
    const to = ctx.S(element.x + element.length, element.y);
    const group = svg('g');
    group.append(svg('line', {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      ...strokeAttrs(element),
    }));
    if (element.label) {
      group.append(ctx.text(element.label, {
        x: to.x + 12, y: to.y, anchor: 'start', size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    return [`\\draw[${tikzStroke(element, ctx)}] ${ctx.P(element.x, element.y)} -- ${
      ctx.P(element.x + element.length, element.y)};`];
  },
});

/* ------------------------------ lens ----------------------------- */

defineType({
  name: 'lens',
  label: 'Lens',
  group: 'Optics',
  hint: 'A converging or diverging lens, with optional focal points.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      height: { type: 'number', description: 'The lens height in diagram units.', default: 3, minimum: 0.2 },
      kind: { type: 'string', enum: ['converging', 'diverging'], description: 'The lens type.', default: 'converging' },
      focal: { type: 'number', description: 'The focal length in diagram units.', default: 2, minimum: 0 },
      showFoci: { type: 'boolean', description: 'Mark F and F prime on the axis.', default: true },
      fill: { type: 'string', format: 'color', description: 'The glass fill colour.', default: '#bfdbfe' },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'height', 'kind'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const group = svg('g');
    const half = element.height / 2;
    const bulge = element.height * 0.11;
    const top = ctx.S(element.x, element.y + half);
    const bottom = ctx.S(element.x, element.y - half);
    const paint = strokeAttrs(element, { fill: element.fill, 'fill-opacity': 0.5 });
    const width = ctx.L(bulge);

    if (element.kind === 'converging') {
      group.append(svg('path', {
        d: `M${top.x} ${top.y} Q${top.x + width} ${(top.y + bottom.y) / 2} ${bottom.x} ${bottom.y} ` +
           `Q${top.x - width} ${(top.y + bottom.y) / 2} ${top.x} ${top.y} Z`,
        ...paint,
      }));
    } else {
      const inset = width * 0.9;
      group.append(svg('path', {
        d: `M${top.x - width} ${top.y} L${top.x + width} ${top.y} ` +
           `Q${top.x + width - inset} ${(top.y + bottom.y) / 2} ${bottom.x + width} ${bottom.y} ` +
           `L${bottom.x - width} ${bottom.y} ` +
           `Q${top.x - width + inset} ${(top.y + bottom.y) / 2} ${top.x - width} ${top.y} Z`,
        ...paint,
      }));
    }

    // The arrow tips that mark the lens type.
    const tipPaint = strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.9 });
    const arrowSize = ctx.L(element.height * 0.09);
    const sign = element.kind === 'converging' ? 1 : -1;
    for (const [end, direction] of [[top, 1], [bottom, -1]]) {
      group.append(svg('path', {
        d: `M${end.x - arrowSize} ${end.y + direction * sign * arrowSize} L${end.x} ${end.y} ` +
           `L${end.x + arrowSize} ${end.y + direction * sign * arrowSize}`,
        ...tipPaint,
      }));
    }

    if (element.showFoci && element.focal > 0) {
      for (const offset of [-element.focal, element.focal]) {
        const point = ctx.S(element.x + offset, element.y);
        group.append(svg('circle', { cx: point.x, cy: point.y, r: 3, fill: element.color }));
        group.append(ctx.text(offset < 0 ? 'F' : "F'", {
          x: point.x, y: point.y + 16, size: 13, color: element.color, baseline: 'hanging',
        }));
      }
    }

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: top.x, y: top.y - 14, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const half = element.height / 2;
    const bulge = element.height * 0.11;
    const options = tikzStroke(element, ctx, [`fill=${ctx.color(element.fill)}`, 'fill opacity=0.5']);
    const lines = [];

    if (element.kind === 'converging') {
      lines.push(
        `\\draw[${options}] ${ctx.P(element.x, element.y + half)} ` +
        `.. controls ${ctx.P(element.x + bulge * 1.6, element.y)} .. ${ctx.P(element.x, element.y - half)} ` +
        `.. controls ${ctx.P(element.x - bulge * 1.6, element.y)} .. cycle;`,
      );
    } else {
      lines.push(
        `\\draw[${options}] ${ctx.P(element.x - bulge, element.y + half)} -- ` +
        `${ctx.P(element.x + bulge, element.y + half)} .. controls ${ctx.P(element.x, element.y)} .. ` +
        `${ctx.P(element.x + bulge, element.y - half)} -- ${ctx.P(element.x - bulge, element.y - half)} ` +
        `.. controls ${ctx.P(element.x, element.y)} .. cycle;`,
      );
    }

    if (element.showFoci && element.focal > 0) {
      for (const [offset, name] of [[-element.focal, 'F'], [element.focal, "F'"]]) {
        lines.push(
          `\\filldraw[${ctx.color(element.color)}] ${ctx.P(element.x + offset, element.y)} ` +
          `circle (${ctx.px(3)}) node[below=3pt] {$${name}$};`,
        );
      }
    }
    if (element.label) {
      lines.push(`\\node[above] at ${ctx.P(element.x, element.y + half)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ----------------------------- mirror ---------------------------- */

defineType({
  name: 'mirror',
  label: 'Mirror',
  group: 'Optics',
  hint: 'A plane, concave or convex mirror with a hatched back.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      height: { type: 'number', description: 'The mirror height in diagram units.', default: 3, minimum: 0.2 },
      kind: { type: 'string', enum: ['plane', 'concave', 'convex'], description: 'The mirror shape.', default: 'plane' },
      curvature: { type: 'number', description: 'The bulge in diagram units. It is ignored for a plane mirror.', default: 0.6, minimum: 0 },
      angle: { type: 'number', description: 'The rotation in degrees.', default: 0, minimum: -180, maximum: 180 },
      ...STROKE,
      ...LABEL,
    },
    required: ['x', 'y', 'height', 'kind'],
  },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render(element, ctx) {
    const centre = ctx.S(element.x, element.y);
    const half = ctx.L(element.height / 2);
    const bulge = ctx.L(element.curvature) * (element.kind === 'convex' ? 1 : -1);
    const group = svg('g', {
      transform: element.angle ? `rotate(${-element.angle} ${centre.x} ${centre.y})` : null,
    });

    const path = element.kind === 'plane'
      ? `M${centre.x} ${centre.y - half} L${centre.x} ${centre.y + half}`
      : `M${centre.x} ${centre.y - half} Q${centre.x + bulge} ${centre.y} ${centre.x} ${centre.y + half}`;

    group.append(svg('path', { d: path, ...strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 1.4 }) }));

    // Short hatch strokes on the back face.
    const back = element.kind === 'convex' ? -1 : 1;
    const count = Math.max(2, Math.round(element.height * 3));
    const tickPaint = strokeAttrs(element, { 'stroke-width': (element.strokeWidth ?? 2) * 0.6, 'stroke-dasharray': null });
    for (let index = 0; index <= count; index++) {
      const t = index / count;
      const y = centre.y - half + t * half * 2;
      const curveX = element.kind === 'plane' ? centre.x : centre.x + bulge * 2 * t * (1 - t) * 2;
      group.append(svg('line', {
        x1: curveX, y1: y,
        x2: curveX + back * 8, y2: y - 8,
        ...tickPaint,
      }));
    }

    if (element.label) {
      group.append(ctx.text(element.label, {
        x: centre.x, y: centre.y - half - 14, size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const half = element.height / 2;
    const bulge = element.curvature * (element.kind === 'convex' ? 1 : -1);
    const options = tikzStroke(element, ctx);
    const top = { x: element.x, y: element.y + half };
    const bottom = { x: element.x, y: element.y - half };
    const lines = [];

    if (element.kind === 'plane') {
      lines.push(`\\draw[${options}] ${ctx.P(top.x, top.y)} -- ${ctx.P(bottom.x, bottom.y)};`);
    } else {
      lines.push(
        `\\draw[${options}] ${ctx.P(top.x, top.y)} .. controls ` +
        `${ctx.P(element.x + bulge * 1.4, element.y)} .. ${ctx.P(bottom.x, bottom.y)};`,
      );
    }
    if (element.label) {
      lines.push(`\\node[above] at ${ctx.P(top.x, top.y)} {${ctx.math(element.label)}};`);
    }
    return lines;
  },
});

/* ------------------------------ ray ------------------------------ */

defineType({
  name: 'ray',
  label: 'Light ray',
  group: 'Optics',
  hint: 'A ray path through a list of points, with an arrow along the way.',
  schema: {
    type: 'object',
    properties: {
      points: {
        type: 'string', format: 'points',
        description: 'Points as "x,y x,y x,y" in diagram units.',
        default: '0,2 5,2 10,0',
      },
      head: { type: 'string', enum: ['end', 'middle', 'none'], description: 'Where the arrowhead sits.', default: 'middle' },
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
      x: round(point.x + dx), y: round(point.y + dy),
    }));
    return { points: formatPoints(points) };
  },
  render(element, ctx) {
    const points = parsePoints(element.points);
    if (points.length < 2) return svg('g');
    const screen = points.map((point) => ctx.S(point.x, point.y));
    const group = svg('g');

    group.append(svg('path', {
      d: screen.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
      ...strokeAttrs(element),
      'marker-end': element.head === 'end' ? ctx.arrow(element.color) : null,
    }));

    // A mid-segment arrowhead reads better on a long ray than an end tip.
    if (element.head === 'middle') {
      const first = points[0];
      const second = points[1];
      const midway = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const at = ctx.S(midway.x, midway.y);
      const heading = Math.atan2(second.y - first.y, second.x - first.x) / DEG;
      const size = 8;
      // The wings point back along the ray. Screen y grows downward, so the
      // sine term is subtracted.
      const wing = (offset) => {
        const radians = (heading + 180 + offset) * DEG;
        return `${round(at.x + size * Math.cos(radians), 2)},${round(at.y - size * Math.sin(radians), 2)}`;
      };
      group.append(svg('path', {
        d: `M${wing(26)} L${round(at.x, 2)},${round(at.y, 2)} L${wing(-26)}`,
        stroke: element.color,
        'stroke-width': element.strokeWidth ?? 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        fill: 'none',
      }));
    }

    if (element.label) {
      const last = points[points.length - 1];
      const spot = ctx.S(last.x, last.y);
      group.append(ctx.text(element.label, {
        x: spot.x + 10, y: spot.y - 10, anchor: 'start',
        size: element.labelSize, color: element.color,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const points = parsePoints(element.points);
    if (points.length < 2) return [];
    const extra = element.head === 'end' ? ['->', '>=stealth']
      : element.head === 'middle' ? ['decoration={markings, mark=at position 0.25 with {\\arrow{stealth}}}', 'postaction={decorate}']
      : [];
    const options = tikzStroke(element, ctx, extra);
    const note = element.head === 'middle'
      ? ['% \\usetikzlibrary{decorations.markings}'] : [];
    return note.concat([
      `\\draw[${options}] ${points.map((point) => ctx.P(point.x, point.y)).join(' -- ')};`,
    ]);
  },
});

/* ------------------------- thin lens ray trace ------------------------- */

/**
 * Traces the three principal rays through a thin lens.
 *
 * The construction is the textbook one, written once so the drawing cannot
 * disagree with the arithmetic:
 *   parallel in  -> out through the far focal point
 *   through the centre -> straight on
 *   through the near focal point -> out parallel to the axis
 *
 * Sign convention: f > 0 converging, f < 0 diverging; a positive image
 * distance is a real image on the far side. The same formulae cover a virtual
 * image, which is why the diverging case needs no separate branch.
 */
export function traceLens(element, lookup) {
  // Bind to a real lens when one is named, otherwise stand on the element's
  // own position and focal length. A ray diagram that needs a second element
  // before it can draw anything is useless in the palette and useless the
  // moment it is dropped.
  const bound = lookup ? lookup(element.lensId) : null;
  const lens = bound && Number.isFinite(bound.x) && Number.isFinite(bound.y)
    ? bound
    : { x: element.x, y: element.y, focal: element.focal, height: element.lensHeight };
  if (!Number.isFinite(lens.x) || !Number.isFinite(lens.y)) return null;

  // The lens type stores focal as a magnitude and carries the sign in `kind`,
  // so reading focal alone made a diverging lens converge. An unbound trace
  // has no kind and may state a negative focal directly.
  const raw = Number(lens.focal);
  const f = lens.kind === 'diverging' ? -Math.abs(raw)
    : lens.kind === 'converging' ? Math.abs(raw)
      : raw;
  const d = Number(element.objectDistance);
  const h = Number(element.objectHeight);
  if (!Number.isFinite(f) || !Number.isFinite(d) || !Number.isFinite(h)) return null;
  if (!(d > 0) || f === 0) return null;

  const cx = lens.x;
  const cy = lens.y;
  const tip = { x: cx - d, y: cy + h };

  // At the focal object distance the rays leave parallel and there is no
  // image to draw. Everything else follows from 1/f = 1/d + 1/di.
  const focused = Math.abs(d - f) > 1e-6;
  const di = focused ? (d * f) / (d - f) : Infinity;
  const hi = focused ? (-h * f) / (d - f) : 0;
  const real = focused && di > 0;

  const halfHeight = (Number(lens.height) || 3) / 2;
  const reach = Number(element.rayLength) > 0
    ? Number(element.rayLength)
    : Math.max(focused ? Math.abs(di) * 1.25 : d, Math.abs(f) * 1.6, 1.5);

  // Where each ray meets the lens plane.
  const yParallel = cy + h;
  const yCentre = cy;
  const yFocal = focused ? cy + hi : cy;

  const along = (from, dir, distance) => ({
    x: from.x + dir.x * distance,
    y: from.y + dir.y * distance,
  });
  const unit = (dx, dy) => {
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  };

  // Out through the far focal point. For f < 0 the ray only appears to come
  // from it, so the direction is reversed; sign(f) covers both.
  const sign = f > 0 ? 1 : -1;
  const parallelOut = unit(sign * (cx + f - cx), sign * (cy - yParallel));
  const centreOut = unit(cx - tip.x, cy - tip.y);

  const rays = [
    { key: 'parallel', enter: { x: cx, y: yParallel }, dir: parallelOut },
    { key: 'centre', enter: { x: cx, y: yCentre }, dir: centreOut },
    { key: 'focal', enter: { x: cx, y: yFocal }, dir: { x: 1, y: 0 } },
  ].filter((ray) => Math.abs(ray.enter.y - cy) <= halfHeight + 1e-6);

  for (const ray of rays) {
    ray.incoming = [tip, ray.enter];
    ray.outgoing = [ray.enter, along(ray.enter, ray.dir, reach)];
  }

  const image = focused ? { x: cx + di, y: cy + hi } : null;

  // A virtual image sits where the outgoing rays only seem to start, so the
  // dashed back-extensions are what make the figure readable.
  const virtualLines = (!real && image)
    ? rays.map((ray) => [ray.enter, image])
    : [];

  return {
    lens, tip, image, real, focused,
    distance: d, focal: f, imageDistance: di, imageHeight: hi,
    magnification: focused ? -di / d : 0,
    rays, virtualLines,
  };
}

defineType({
  name: 'lens-rays',
  label: 'Lens ray diagram',
  group: 'Optics',
  hint: 'The three principal rays through a lens, and the image they form. Positions come from the thin lens equation, not from hand-placed lines.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      lensId: { type: 'string', format: 'elementRef', description: 'The id of a lens to trace through. Leave empty to trace from this element own position and focal length.', default: '' },
      focal: { type: 'number', description: 'Focal length used when no lens is referenced. Negative is a diverging lens.', default: 2.2 },
      lensHeight: { type: 'number', description: 'Aperture height used when no lens is referenced.', default: 4, minimum: 0.2 },
      objectDistance: { type: 'number', description: 'How far the object stands in front of the lens, in diagram units.', default: 5, minimum: 0.05 },
      objectHeight: { type: 'number', description: 'Object height above the axis. Negative points it below.', default: 1.6 },
      showObject: { type: 'boolean', description: 'Draw the object arrow.', default: true },
      showImage: { type: 'boolean', description: 'Draw the image arrow.', default: true },
      rayLength: { type: 'number', description: 'How far past the lens the rays run. 0 chooses a length that suits the image.', default: 0, minimum: 0 },
      objectColor: { type: 'string', format: 'color', description: 'Colour of the object arrow.', default: '#b91c1c' },
      imageColor: { type: 'string', format: 'color', description: 'Colour of the image arrow.', default: '#0f766e' },
      ...STROKE,
      ...LABEL,
    },
    required: ['objectDistance', 'objectHeight'],
  },
  // The lens plane, not the object tip: the tip already carries a drag
  // handle, and two grips on one point means neither can be grabbed.
  anchor: (element, lookup) => {
    const trace = traceLens(element, lookup);
    return trace ? { x: trace.lens.x, y: trace.lens.y } : null;
  },
  attachedTo: (element) => element.lensId || null,
  move: (element, dx, dy) => (element.lensId ? null : { x: element.x + dx, y: element.y + dy }),
  handles: (element, lookup) => {
    const trace = traceLens(element, lookup);
    if (!trace) return [];
    return [{
      x: trace.tip.x,
      y: trace.tip.y,
      set: (point) => ({
        objectDistance: Math.max(0.05, round(trace.lens.x - point.x, 2)),
        objectHeight: round(point.y - trace.lens.y, 2),
      }),
    }];
  },
  render(element, ctx) {
    const group = svg('g');
    const trace = traceLens(element, ctx.byId);
    if (!trace) return group;

    const paint = strokeAttrs(element);
    const dashed = strokeAttrs(element, {
      'stroke-dasharray': '5 4',
      'stroke-opacity': 0.75,
    });

    for (const ray of trace.rays) {
      const points = [...ray.incoming, ray.outgoing[1]]
        .map((point) => ctx.S(point.x, point.y));
      group.append(svg('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        fill: 'none',
        ...paint,
        'marker-end': ctx.arrow(element.color),
      }));
    }

    for (const line of trace.virtualLines) {
      const from = ctx.S(line[0].x, line[0].y);
      const to = ctx.S(line[1].x, line[1].y);
      group.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, fill: 'none', ...dashed }));
    }

    const arrow = (from, to, colour) => {
      const a = ctx.S(from.x, from.y);
      const b = ctx.S(to.x, to.y);
      group.append(svg('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        ...strokeAttrs(element, { stroke: colour, 'stroke-width': (element.strokeWidth ?? 2) * 1.4 }),
        'marker-end': ctx.arrow(colour),
      }));
    };

    if (element.showObject) {
      arrow({ x: trace.tip.x, y: trace.lens.y }, trace.tip, element.objectColor);
    }
    if (element.showImage && trace.image) {
      arrow({ x: trace.image.x, y: trace.lens.y }, trace.image, element.imageColor);
    }

    if (element.label && trace.image) {
      const at = ctx.S(trace.image.x, trace.image.y);
      group.append(ctx.text(element.label, {
        x: at.x + 8, y: at.y + (trace.imageHeight < 0 ? 14 : -14),
        anchor: 'start', size: element.labelSize, color: element.imageColor,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const trace = traceLens(element, ctx.byId);
    if (!trace) return [`% lens-rays "${element.id}" has no lens to trace through`];

    const options = tikzStroke(element, ctx);
    const lines = [];
    for (const ray of trace.rays) {
      const path = [...ray.incoming, ray.outgoing[1]]
        .map((point) => ctx.P(point.x, point.y)).join(' -- ');
      lines.push(`\\draw[${options}, ->] ${path};`);
    }
    for (const line of trace.virtualLines) {
      lines.push(`\\draw[${options}, dashed, opacity=0.75] ${ctx.P(line[0].x, line[0].y)} -- ${ctx.P(line[1].x, line[1].y)};`);
    }
    if (element.showObject) {
      lines.push(`\\draw[draw=${ctx.color(element.objectColor)}, line width=${round((element.strokeWidth ?? 2) * 1.4 * 0.4, 2)}pt, ->] ${ctx.P(trace.tip.x, trace.lens.y)} -- ${ctx.P(trace.tip.x, trace.tip.y)};`);
    }
    if (element.showImage && trace.image) {
      lines.push(`\\draw[draw=${ctx.color(element.imageColor)}, line width=${round((element.strokeWidth ?? 2) * 1.4 * 0.4, 2)}pt, ->] ${ctx.P(trace.image.x, trace.lens.y)} -- ${ctx.P(trace.image.x, trace.image.y)};`);
      if (element.label) {
        lines.push(`\\node[anchor=west, text=${ctx.color(element.imageColor)}] at ${ctx.P(trace.image.x + 0.2, trace.image.y)} {${ctx.math(element.label)}};`);
      }
    }
    return lines;
  },
});

/* ------------------------ curved mirror ray trace ---------------------- */

/**
 * Traces the three principal rays off a curved mirror.
 *
 * Same mirror equation as the lens, 1/f = 1/d + 1/di, with f = R/2. What
 * differs is that light comes back: every reflected ray travels back toward
 * the object side, so a real image forms in front of the mirror rather than
 * behind it.
 *
 * The `mirror` type stores a `curvature` and a `kind`, not a focal length, so
 * the sign convention is read from the kind: concave converges, convex
 * diverges. Reading curvature alone would make a convex mirror converge, which
 * is the same trap the lens tracer already had.
 */
export function traceMirror(element, lookup) {
  const bound = lookup ? lookup(element.mirrorId) : null;
  const mirror = bound && Number.isFinite(bound.x) && Number.isFinite(bound.y)
    ? bound
    : { x: element.x, y: element.y, kind: element.kind, height: element.mirrorHeight, curvature: element.focal * 2 };

  if (!Number.isFinite(mirror.x) || !Number.isFinite(mirror.y)) return null;

  // Focal length is always this element's own. The mirror type's `curvature`
  // is a drawing bulge, not a radius of curvature, so deriving a focal length
  // from it would invent a physical meaning the field does not carry. The
  // mirror supplies position, aperture and the sign of the convention.
  const focalOf = () => {
    const own = Math.abs(Number(element.focal));
    const kind = (bound ? bound.kind : element.kind) === 'convex' ? 'convex' : 'concave';
    return kind === 'convex' ? -own : own;
  };

  const f = focalOf();
  const d = Number(element.objectDistance);
  const h = Number(element.objectHeight);
  if (!Number.isFinite(f) || f === 0 || !(d > 0) || !Number.isFinite(h)) return null;

  // The mirror faces left, so distances in front of it grow to the left.
  const cx = mirror.x;
  const cy = mirror.y;
  const front = -1;

  const focused = Math.abs(d - f) > 1e-6;
  const di = focused ? (d * f) / (d - f) : Infinity;
  const hi = focused ? (-h * f) / (d - f) : 0;
  const real = focused && di > 0;

  const tip = { x: cx + front * d, y: cy + h };
  const focus = { x: cx + front * f, y: cy };
  const image = focused ? { x: cx + front * di, y: cy + hi } : null;

  const halfHeight = (Number(mirror.height) || 3) / 2;
  const reach = Number(element.rayLength) > 0
    ? Number(element.rayLength)
    : Math.max(focused ? Math.abs(di) * 1.2 : d, Math.abs(f) * 1.5, 1.5);

  const unit = (dx, dy) => {
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  };
  const along = (from, dir, distance) => ({ x: from.x + dir.x * distance, y: from.y + dir.y * distance });

  // Where each ray meets the mirror plane, and which way it leaves.
  const parallelHit = { x: cx, y: cy + h };
  const parallelOut = f > 0
    ? unit(focus.x - parallelHit.x, focus.y - parallelHit.y)
    : unit(parallelHit.x - focus.x, parallelHit.y - focus.y);

  const focalSlope = focused ? (focus.y - tip.y) / (focus.x - tip.x) : 0;
  const focalHit = { x: cx, y: tip.y + focalSlope * (cx - tip.x) };
  const focalOut = { x: front, y: 0 };

  const vertexHit = { x: cx, y: cy };
  const incoming = unit(vertexHit.x - tip.x, vertexHit.y - tip.y);
  const vertexOut = { x: -incoming.x, y: incoming.y };   // reflected about the axis

  const rays = [
    { key: 'parallel', enter: parallelHit, dir: parallelOut },
    { key: 'focal', enter: focalHit, dir: focalOut },
    { key: 'vertex', enter: vertexHit, dir: vertexOut },
  ].filter((ray) => Math.abs(ray.enter.y - cy) <= halfHeight + 1e-6);

  for (const ray of rays) {
    ray.incoming = [tip, ray.enter];
    ray.outgoing = [ray.enter, along(ray.enter, ray.dir, reach)];
  }

  const virtualLines = (!real && image) ? rays.map((ray) => [ray.enter, image]) : [];

  return {
    mirror, tip, focus, image, real, focused,
    distance: d, focal: f, imageDistance: di, imageHeight: hi,
    magnification: focused ? -di / d : 0,
    rays, virtualLines,
  };
}

defineType({
  name: 'mirror-rays',
  label: 'Mirror ray diagram',
  group: 'Optics',
  hint: 'The three principal rays off a curved mirror, and the image they form. Positions come from the mirror equation, not from hand-placed lines.',
  schema: {
    type: 'object',
    properties: {
      ...POSITION,
      mirrorId: { type: 'string', format: 'elementRef', description: 'The id of a mirror to trace off. Leave empty to trace from this element own position and focal length.', default: '' },
      focal: { type: 'number', description: 'Focal length used when no mirror is referenced. Half the radius of curvature.', default: 2.4 },
      kind: { type: 'string', enum: ['concave', 'convex'], description: 'Used when no mirror is referenced.', default: 'concave' },
      mirrorHeight: { type: 'number', description: 'Aperture height used when no mirror is referenced.', default: 5, minimum: 0.2 },
      objectDistance: { type: 'number', description: 'How far the object stands in front of the mirror.', default: 5, minimum: 0.05 },
      objectHeight: { type: 'number', description: 'Object height above the axis. Negative points it below.', default: 1.6 },
      showObject: { type: 'boolean', description: 'Draw the object arrow.', default: true },
      showImage: { type: 'boolean', description: 'Draw the image arrow.', default: true },
      rayLength: { type: 'number', description: 'How far the reflected rays run. 0 chooses a length that suits the image.', default: 0, minimum: 0 },
      objectColor: { type: 'string', format: 'color', description: 'Colour of the object arrow.', default: '#b91c1c' },
      imageColor: { type: 'string', format: 'color', description: 'Colour of the image arrow.', default: '#0f766e' },
      ...STROKE,
      ...LABEL,
    },
    required: ['objectDistance', 'objectHeight'],
  },
  anchor: (element, lookup) => {
    const trace = traceMirror(element, lookup);
    return trace ? { x: trace.mirror.x, y: trace.mirror.y } : null;
  },
  attachedTo: (element) => element.mirrorId || null,
  move: (element, dx, dy) => (element.mirrorId ? null : { x: element.x + dx, y: element.y + dy }),
  handles: (element, lookup) => {
    const trace = traceMirror(element, lookup);
    if (!trace) return [];
    return [{
      x: trace.tip.x,
      y: trace.tip.y,
      set: (point) => ({
        objectDistance: Math.max(0.05, round(trace.mirror.x - point.x, 2)),
        objectHeight: round(point.y - trace.mirror.y, 2),
      }),
    }];
  },
  render(element, ctx) {
    const group = svg('g');
    const trace = traceMirror(element, ctx.byId);
    if (!trace) return group;

    const paint = strokeAttrs(element);
    const dashed = strokeAttrs(element, { 'stroke-dasharray': '5 4', 'stroke-opacity': 0.75 });

    for (const ray of trace.rays) {
      const points = [...ray.incoming, ray.outgoing[1]].map((point) => ctx.S(point.x, point.y));
      group.append(svg('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        fill: 'none',
        ...paint,
        'marker-end': ctx.arrow(element.color),
      }));
    }

    for (const line of trace.virtualLines) {
      const from = ctx.S(line[0].x, line[0].y);
      const to = ctx.S(line[1].x, line[1].y);
      group.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, fill: 'none', ...dashed }));
    }

    const arrow = (from, to, colour) => {
      const a = ctx.S(from.x, from.y);
      const b = ctx.S(to.x, to.y);
      group.append(svg('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        ...strokeAttrs(element, { stroke: colour, 'stroke-width': (element.strokeWidth ?? 2) * 1.4 }),
        'marker-end': ctx.arrow(colour),
      }));
    };

    if (element.showObject) arrow({ x: trace.tip.x, y: trace.mirror.y }, trace.tip, element.objectColor);
    if (element.showImage && trace.image) {
      arrow({ x: trace.image.x, y: trace.mirror.y }, trace.image, element.imageColor);
    }

    if (element.label && trace.image) {
      const at = ctx.S(trace.image.x, trace.image.y);
      group.append(ctx.text(element.label, {
        x: at.x + 8, y: at.y + (trace.imageHeight < 0 ? 14 : -14),
        anchor: 'start', size: element.labelSize, color: element.imageColor,
      }));
    }
    return group;
  },
  tikz(element, ctx) {
    const trace = traceMirror(element, ctx.byId);
    if (!trace) return [`% mirror-rays "${element.id}" has no mirror to trace off`];

    const options = tikzStroke(element, ctx);
    const lines = [];
    for (const ray of trace.rays) {
      const path = [...ray.incoming, ray.outgoing[1]].map((point) => ctx.P(point.x, point.y)).join(' -- ');
      lines.push(`\\draw[${options}, ->] ${path};`);
    }
    for (const line of trace.virtualLines) {
      lines.push(`\\draw[${options}, dashed, opacity=0.75] ${ctx.P(line[0].x, line[0].y)} -- ${ctx.P(line[1].x, line[1].y)};`);
    }
    const weight = round((element.strokeWidth ?? 2) * 1.4 * 0.4, 2);
    if (element.showObject) {
      lines.push(`\\draw[draw=${ctx.color(element.objectColor)}, line width=${weight}pt, ->] ${ctx.P(trace.tip.x, trace.mirror.y)} -- ${ctx.P(trace.tip.x, trace.tip.y)};`);
    }
    if (element.showImage && trace.image) {
      lines.push(`\\draw[draw=${ctx.color(element.imageColor)}, line width=${weight}pt, ->] ${ctx.P(trace.image.x, trace.mirror.y)} -- ${ctx.P(trace.image.x, trace.image.y)};`);
      if (element.label) {
        lines.push(`\\node[anchor=west, text=${ctx.color(element.imageColor)}] at ${ctx.P(trace.image.x + 0.2, trace.image.y)} {${ctx.math(element.label)}};`);
      }
    }
    return lines;
  },
});
