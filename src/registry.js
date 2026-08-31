/**
 * The element type registry.
 *
 * One definition drives four things:
 *   1. the SVG render          -> render(element, ctx)
 *   2. the properties panel    -> generated from schema
 *   3. the TikZ export         -> tikz(element, ctx)
 *   4. the WebMCP tool (later) -> schema becomes inputSchema
 *
 * The schema is JSON Schema. WebMCP validates a tool call against exactly this
 * shape, so the editor and the agent share one contract. The extra "format"
 * values ("color", "expression", "elementRef") are UI hints. JSON Schema allows
 * unknown keywords, so a validator ignores them.
 */

const types = new Map();

/**
 * definition = {
 *   name, label, group, hint,
 *   schema,                 // JSON Schema, type "object"
 *   render(element, ctx),   // -> SVGElement
 *   tikz(element, ctx),     // -> string[] of TikZ lines
 *   anchor(element),        // -> {x, y} the drag origin, in document units
 *   move(element, dx, dy),  // applies a drag, in document units
 *   handles(element),       // optional -> [{ x, y, set(point) }]
 * }
 */
export function defineType(definition) {
  if (types.has(definition.name)) {
    throw new Error(`The type "${definition.name}" is already defined.`);
  }
  types.set(definition.name, definition);
  return definition;
}

export function getType(name) {
  const type = types.get(name);
  if (!type) throw new Error(`Unknown element type "${name}".`);
  return type;
}

export function hasType(name) {
  return types.has(name);
}

export function allTypes() {
  return [...types.values()];
}

/** The palette order. A group not listed here goes to the end, alphabetically. */
export const GROUP_ORDER = ['Common', 'Mechanics', 'Plots', 'Fields', 'Circuit', 'Schematic', 'Optics'];

export function typesByGroup() {
  const groups = new Map();
  for (const type of types.values()) {
    if (!groups.has(type.group)) groups.set(type.group, []);
    groups.get(type.group).push(type);
  }

  // Import order must not decide how the palette reads.
  const rank = (name) => {
    const index = GROUP_ORDER.indexOf(name);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  const ordered = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  return new Map(ordered.map((name) => [name, groups.get(name)]));
}

/** Reads the default values out of a schema. */
export function defaultsFor(schema) {
  const values = {};
  for (const [key, property] of Object.entries(schema.properties || {})) {
    if ('default' in property) values[key] = structuredClone(property.default);
    else if (property.type === 'number') values[key] = 0;
    else if (property.type === 'boolean') values[key] = false;
    else if (property.type === 'array') values[key] = [];
    else values[key] = '';
  }
  return values;
}

let counter = 0;

/** Generates a stable, readable id such as "force-3". */
export function nextId(typeName, taken = new Set()) {
  let id;
  do {
    id = `${typeName}-${++counter}`;
  } while (taken.has(id));
  return id;
}

/** Builds a new element with the schema defaults plus any overrides. */
export function createElement(typeName, overrides = {}, taken = new Set()) {
  const type = getType(typeName);
  return {
    id: overrides.id || nextId(typeName, taken),
    type: typeName,
    ...defaultsFor(type.schema),
    ...overrides,
  };
}

/**
 * Checks a value object against a schema.
 * The browser does this for a WebMCP tool call. The editor does it for a
 * pasted or restored document. Returns a list of messages, empty when valid.
 */
export function validate(schema, value) {
  const problems = [];
  const properties = schema.properties || {};

  for (const key of schema.required || []) {
    if (value[key] === undefined || value[key] === '') {
      problems.push(`"${key}" is required.`);
    }
  }

  for (const [key, property] of Object.entries(properties)) {
    const item = value[key];
    if (item === undefined) continue;

    // Number.isFinite, not typeof: NaN and Infinity are both "number" and
    // would otherwise reach the renderer and the export as literal text.
    if (property.type === 'number' && !Number.isFinite(item)) {
      problems.push(`"${key}" must be a finite number.`);
    }
    if (property.type === 'string' && typeof item !== 'string') {
      problems.push(`"${key}" must be a string.`);
    }
    if (property.type === 'boolean' && typeof item !== 'boolean') {
      problems.push(`"${key}" must be true or false.`);
    }
    if (property.enum && !property.enum.includes(item)) {
      problems.push(`"${key}" must be one of: ${property.enum.join(', ')}.`);
    }
    if (property.minimum !== undefined && item < property.minimum) {
      problems.push(`"${key}" must be at least ${property.minimum}.`);
    }
    if (property.maximum !== undefined && item > property.maximum) {
      problems.push(`"${key}" must be at most ${property.maximum}.`);
    }
  }

  return problems;
}

/* ------------------ field presentation ------------------- */

/** Names that a camelCase split would render badly. */
const FIELD_NAMES = {
  x: 'X', y: 'Y', r: 'Radius',
  x1: 'Start X', y1: 'Start Y', x2: 'End X', y2: 'End Y',
  dataX: 'Data X', dataY: 'Data Y',
  bodyId: 'Acts on body', axesId: 'On axes', fromId: 'From', toId: 'To',
  strokeWidth: 'Line width', fillOpacity: 'Fill opacity',
  labelSize: 'Label size', labelSide: 'Label side', labelPlace: 'Label at',
  tMin: 'From t', tMax: 'To t', xMin: 'X from', xMax: 'X to',
  yMin: 'Y from', yMax: 'Y to', tickX: 'X tick step', tickY: 'Y tick step',
  xExpression: 'x(t)', yExpression: 'y(t)', rExpression: 'r(t)',
  uExpression: 'u(x,y)', vExpression: 'v(x,y)',
  ropeLeft: 'Rope left', ropeRight: 'Rope right',
  autoLength: 'Show length', showGuides: 'Guide lines',
  showFoci: 'Show focal points', showBracket: 'Ceiling bracket',
  showGrid: 'Grid', showLeader: 'Leader line',
  leaderX: 'Leader X', leaderY: 'Leader Y',
  hatchStep: 'Hatch spacing', arrowScale: 'Arrow length',
  normalise: 'Same length arrows', rightAngle: 'Right angle mark',
  dotSize: 'Dot size', value: 'Value', cells: 'Cells', loops: 'Loops',
  route: 'Routing', dots: 'Solder dots',
};

/** Turns a schema key into a readable label. */
export function fieldName(key) {
  if (Object.hasOwn(FIELD_NAMES, key)) return FIELD_NAMES[key];
  const words = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Which section of the properties panel a field belongs to.
 * A flat list of twenty fields is unreadable. Four short groups are not.
 */
const SECTION_KEYS = {
  Links: ['bodyId', 'axesId', 'fromId', 'toId'],
  Style: ['color', 'strokeWidth', 'style', 'fill', 'fillOpacity', 'size', 'head'],
  Label: ['label', 'labelSize', 'labelSide', 'labelPlace', 'text', 'title',
    'xLabel', 'yLabel', 'zLabel', 'autoLength', 'value'],
};

export const SECTION_ORDER = ['Links', 'Geometry', 'Style', 'Label'];

export function fieldSection(key) {
  for (const [section, keys] of Object.entries(SECTION_KEYS)) {
    if (keys.includes(key)) return section;
  }
  return 'Geometry';
}

/** Groups a schema's properties into sections, keeping the schema order. */
export function sectionsFor(schema) {
  const sections = new Map(SECTION_ORDER.map((name) => [name, []]));
  for (const [key, property] of Object.entries(schema.properties || {})) {
    sections.get(fieldSection(key)).push([key, property]);
  }
  return [...sections].filter(([, fields]) => fields.length > 0);
}

/* ---------------- shared schema fragments ---------------- */

export const POSITION = {
  x: { type: 'number', description: 'The x position in diagram units.', default: 0 },
  y: { type: 'number', description: 'The y position in diagram units.', default: 0 },
};

export const STROKE = {
  color: { type: 'string', format: 'color', description: 'The line colour.', default: '#1f2937' },
  strokeWidth: { type: 'number', description: 'The line width in px.', default: 2, minimum: 0.25, maximum: 12 },
  style: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'The line style.', default: 'solid' },
};

export const LABEL = {
  label: { type: 'string', description: 'A LaTeX-lite label, for example \\vec{F}_{1}.', default: '' },
  labelSize: { type: 'number', description: 'The label size in px.', default: 15, minimum: 6, maximum: 48 },
};

/* ------------------------------- anchors ------------------------------- */

/**
 * Named attachment points on a shape, in document units.
 *
 * These describe the shape, so they belong beside render() and handles(). They
 * used to live in the WebMCP bridge, which put shape knowledge on the wrong
 * side of the seam: the renderer could not reach it to place a label, and the
 * inspector could not show it.
 *
 * A type may declare its own anchors(element, lookup). Most do not need to:
 * whatever geometry fields the element carries are enough to derive them.
 */

const ORIGIN = { x: 0, y: 0 };

function vec(x, y) { return { x, y }; }
function add(a, b) { return vec(a.x + b.x, a.y + b.y); }
function mul(a, k) { return vec(a.x * k, a.y * k); }
function perp(a) { return vec(-a.y, a.x); }
function unitAt(degrees) {
  const r = (degrees || 0) * Math.PI / 180;
  return vec(Math.cos(r), Math.sin(r));
}
function norm(a) {
  const length = Math.hypot(a.x, a.y);
  return length > 1e-9 ? vec(a.x / length, a.y / length) : vec(1, 0);
}
function finite(value) { return Number.isFinite(value); }
function isPoint(p) { return p && finite(p.x) && finite(p.y); }

/** "1,2 3,4" -> [{x,y}, {x,y}]. Kept here so anchors need no type helpers. */
function readPoints(source) {
  return String(source ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(finite))
    .map(([x, y]) => vec(x, y));
}

function named(list, name, at, description = '') {
  if (!isPoint(at) || list.some((entry) => entry.name === name)) return;
  list.push({ name, x: at.x, y: at.y, description });
}

/**
 * The generic derivation: the same rules for every type that has not opted
 * out. Returns { anchors, along } with along being the shape's own long axis.
 */
function derivedAnchors(element) {
  const list = [];

  if (finite(element.x1) && finite(element.y1) && finite(element.x2) && finite(element.y2)) {
    const start = vec(element.x1, element.y1);
    const end = vec(element.x2, element.y2);
    named(list, 'start', start, 'Line or arrow start.');
    named(list, 'end', end, 'Line or arrow end.');
    named(list, 'middle', mul(add(start, end), 0.5), 'Line or arrow midpoint.');
    return { anchors: list, along: norm(vec(end.x - start.x, end.y - start.y)) };
  }

  const points = readPoints(element.points);
  if (points.length) {
    const first = points[0];
    const last = points[points.length - 1];
    named(list, 'start', first, 'First point of the path.');
    named(list, 'end', last, 'Last point of the path.');
    named(list, 'middle', points[Math.floor((points.length - 1) / 2)], 'Middle point of the path.');
    return {
      anchors: list,
      along: points.length > 1 ? norm(vec(last.x - first.x, last.y - first.y)) : vec(1, 0),
    };
  }

  if (finite(element.x) && finite(element.y) && finite(element.length) && finite(element.angle)) {
    const along = unitAt(element.angle);
    const centre = vec(element.x, element.y);
    const half = element.length / 2;
    named(list, 'start', add(centre, mul(along, -half)), 'Start terminal.');
    named(list, 'end', add(centre, mul(along, half)), 'End terminal.');
    return { anchors: list, along };
  }

  return { anchors: list, along: unitAt(element.angle) };
}

/**
 * Anchors for one element: the type's own if it declares them, else derived.
 * `center` is always present when the type has an anchor point.
 */
export function anchorsOf(element, lookup = () => null) {
  if (!element) return { anchors: [], along: vec(1, 0), normal: vec(0, 1) };
  const type = getType(element.type);

  const own = typeof type.anchors === 'function' ? type.anchors(element, lookup) : null;
  const { anchors, along } = own && Array.isArray(own.anchors)
    ? { anchors: own.anchors.slice(), along: own.along || unitAt(element.angle) }
    : derivedAnchors(element);

  const centre = typeof type.anchor === 'function' ? type.anchor(element, lookup) : null;
  const list = [];
  named(list, 'center', isPoint(centre) ? centre : null, 'Main object centre or drag anchor.');
  for (const entry of anchors) named(list, entry.name, entry, entry.description || '');

  return { anchors: list, along, normal: perp(along) };
}

/** The four corners of a rotated box, in document units. */
export function boxCorners(element, width = element.width, height = element.height) {
  const along = unitAt(element.angle);
  const up = perp(along);
  const centre = vec(element.x, element.y);
  const hw = (Number(width) || 0) / 2;
  const hh = (Number(height ?? width) || 0) / 2;
  return [
    add(add(centre, mul(along, -hw)), mul(up, -hh)),
    add(add(centre, mul(along, hw)), mul(up, -hh)),
    add(add(centre, mul(along, hw)), mul(up, hh)),
    add(add(centre, mul(along, -hw)), mul(up, hh)),
  ];
}

/** Anchors for a rotated box, in its own frame. Used by body, block, shape. */
export function boxAnchors(element) {
  const along = unitAt(element.angle);
  const up = perp(along);
  const centre = vec(element.x, element.y);
  const hw = (Number(element.width) || 0.1) / 2;
  const hh = (Number(element.height ?? element.width) || 0.1) / 2;
  const corners = boxCorners(element);
  const list = [];
  named(list, 'right', add(centre, mul(along, hw)), 'Right edge in the local frame.');
  named(list, 'left', add(centre, mul(along, -hw)), 'Left edge in the local frame.');
  named(list, 'top', add(centre, mul(up, hh)), 'Top edge in the local frame.');
  named(list, 'bottom', add(centre, mul(up, -hh)), 'Bottom edge in the local frame.');
  named(list, 'bottom-left', corners[0], 'Lower-left corner in the local frame.');
  named(list, 'bottom-right', corners[1], 'Lower-right corner in the local frame.');
  named(list, 'top-right', corners[2], 'Upper-right corner in the local frame.');
  named(list, 'top-left', corners[3], 'Upper-left corner in the local frame.');
  return { anchors: list, along };
}

/** Anchors along a straight surface: its span plus a point either side. */
export function surfaceAnchors(element) {
  const along = unitAt(element.angle);
  const up = perp(along);
  const start = vec(element.x, element.y);
  const span = Number(element.length) || 0;
  const end = add(start, mul(along, span));
  const middle = add(start, mul(along, span / 2));
  const list = [];
  named(list, 'start', start, 'Start of the surface.');
  named(list, 'end', end, 'End of the surface.');
  named(list, 'middle', middle, 'Midpoint of the surface.');
  named(list, 'above', add(middle, mul(up, 0.8)), 'Point above the surface.');
  named(list, 'below', add(middle, mul(up, -0.8)), 'Point below the surface.');
  return { anchors: list, along };
}

function turnMinus90(a) { return vec(a.y, -a.x); }

/**
 * Where each rope run leaves a wheel, and where it ends.
 *
 * A rope run is a direction, not a vertical drop. The straight part is tangent
 * to the wheel, so the radius to the touch point is perpendicular to the run:
 * the left run turns one way and the right run the other, which is what makes
 * the rope wrap over the top rather than cut through the wheel.
 *
 * A run pointing straight down gives back the plain left and right points, so
 * an ordinary hanging pulley is unchanged.
 */
export function wheelRuns(element) {
  const r = Math.abs(Number(element.radius)) || 0.1;
  const centre = vec(element.x, element.y);

  const leftWay = unitAt(element.ropeLeftAngle ?? 270);
  const rightWay = unitAt(element.ropeRightAngle ?? 270);

  const leftTouch = add(centre, mul(turnMinus90(leftWay), r));
  const rightTouch = add(centre, mul(perp(rightWay), r));

  const leftSpan = Math.max(0, Number(element.ropeLeft) || 0);
  const rightSpan = Math.max(0, Number(element.ropeRight) || 0);

  const mountWay = unitAt(element.mountAngle ?? 90);
  const mountSpan = Math.max(0, Number(element.mountLength) || 0);

  return {
    centre,
    radius: r,
    left: { touch: leftTouch, way: leftWay, span: leftSpan, end: add(leftTouch, mul(leftWay, leftSpan)) },
    right: { touch: rightTouch, way: rightWay, span: rightSpan, end: add(rightTouch, mul(rightWay, rightSpan)) },
    mount: { way: mountWay, span: mountSpan, end: add(centre, mul(mountWay, mountSpan)) },
  };
}

/** Tangent points on a wheel, where a cord leaves it. */
export function wheelAnchors(element) {
  const runs = wheelRuns(element);
  const r = runs.radius;
  const list = [];
  named(list, 'top', vec(element.x, element.y + r), 'Top of the wheel.');
  named(list, 'bottom', vec(element.x, element.y - r), 'Bottom of the wheel.');
  named(list, 'left', vec(element.x - r, element.y), 'Left of the wheel.');
  named(list, 'right', vec(element.x + r, element.y), 'Right of the wheel.');
  named(list, 'rope-left', runs.left.touch, 'Where the left rope run touches the wheel.');
  named(list, 'rope-right', runs.right.touch, 'Where the right rope run touches the wheel.');
  named(list, 'rope-left-end', runs.left.end, 'Far end of the left rope run.');
  named(list, 'rope-right-end', runs.right.end, 'Far end of the right rope run.');
  named(list, 'mount', runs.mount.end, 'Where the mount meets its support.');
  return { anchors: list, along: vec(1, 0) };
}

/** Where a label sits when a type lets it move off the centre. */
export const LABEL_PLACE_NAMES = [
  'center', 'left', 'right', 'top', 'bottom',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
];

/**
 * The shared fragment for a type whose label would otherwise sit dead centre.
 *
 * A free-body diagram puts every force at the centre of mass, so the body's
 * own label competes with every arrow tail for one point and nothing could
 * separate them.
 */
export const LABEL_PLACE = {
  labelPlace: {
    type: 'string',
    enum: LABEL_PLACE_NAMES,
    description: 'Where the label sits inside the shape. Move it off center when arrows crowd the middle.',
    default: 'center',
  },
};

/** Maps a style name to an SVG dash array. */
export function dashArray(style, width = 2) {
  if (style === 'dashed') return `${width * 3} ${width * 2}`;
  if (style === 'dotted') return `${width * 0.1} ${width * 2}`;
  return null;
}
