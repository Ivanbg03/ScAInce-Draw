/**
 * WebMCP bridge.
 *
 * The GUI already has a single registry and a single store. This module exposes
 * those same contracts to ChatGPT instead of creating a parallel agent API.
 */

import { compile } from './expr.js';
import { emptyDocument, store } from './store.js';
import { allTypes, getType, GROUP_ORDER, validate, anchorsOf, boxCorners, wheelRuns } from './registry.js';
import { toSvgSource } from './export/svg.js';
import { toTikzSource } from './export/tikz.js';
import { alignSelection, boundsOf, distributeSelection } from './ui/arrange.js';
import { labelPointOf } from './types/shared.js';
import { measureText } from './mathtext.js';
import { curvePoint, curveTangent, axesMapper } from './types/plots.js';
import { renderFailures } from './render.js';

const controllers = [];
const TYPE_NAMES = () => allTypes().map((type) => type.name);
const GROUP_NAMES = () => GROUP_ORDER.filter((group) => allTypes().some((type) => type.group === group));
const ARRANGE_ACTIONS = [
  'align-left', 'align-centre-x', 'align-right',
  'align-top', 'align-centre-y', 'align-bottom',
  'distribute-x', 'distribute-y',
];
const OPERATION_ACTIONS = [
  'add', 'update', 'remove', 'select',
  'set-title', 'set-canvas',
  'duplicate-selection', 'arrange-selection',
  'clear-diagram', 'replace-diagram', 'fit-view',
];
const ANCHOR_NAMES = [
  'center', 'start', 'end', 'middle',
  'top', 'bottom', 'left', 'right',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
  'above', 'below', 'rope-left', 'rope-right',
];
const VECTOR_DIRECTIONS = [
  'angle', 'right', 'left', 'up', 'down',
  'along-element', 'opposite-along-element',
  'normal-element', 'opposite-normal-element',
  'towards-element', 'away-from-element',
  'tangent-curve', 'opposite-tangent-curve', 'normal-curve',
];
const CONNECTOR_ROUTES = ['direct', 'orthogonal'];

const CANVAS_SCHEMA = {
  width: { type: 'number', minimum: 1, description: 'Sheet width in diagram units. Increase this for more drawing room.' },
  height: { type: 'number', minimum: 1, description: 'Sheet height in diagram units. Increase this for more drawing room.' },
  grid: { type: 'number', minimum: 0.05, description: 'Grid step in diagram units.' },
  showGrid: { type: 'boolean', description: 'Whether the grid is visible on the canvas.' },
  snap: { type: 'boolean', description: 'Whether placement and drags snap to the grid.' },
};

const FIELD_GUIDANCE = {
  id: 'Stable identifier used by references. Keep it short and unique, for example R1 or plot-main.',
  label: 'Visible name or mathematical label for the object, for example R_1, \\vec{F}, or f(x). Do not put the measured physical value here when a separate value field exists.',
  value: 'Measured physical or electrical value only, for example 10\\,k\\Omega, 5\\,V, or 2\\,mH. Leave empty if the value is unknown. Never repeat the label.',
  text: 'Visible note text. Plain prose is allowed; short LaTeX-lite fragments are allowed for formulas.',
  title: 'Visible title text for this object.',
  axesId: 'Reference the id of an existing axes element. Use this to attach curves, markers, areas, and fields to the same coordinate system.',
  bodyId: 'Reference the id of an existing body element. Use this when a force should move with a body.',
  fromId: 'Reference the id of the source block. Use coordinates only when the link is not attached to a block.',
  toId: 'Reference the id of the target block. Use coordinates only when the link is not attached to a block.',
  points: 'Ordered document coordinates as x,y pairs such as "0,0 2,0 2,1". These are diagram units, not screen pixels.',
  expression: 'Math expression in x, for example x^3, sin(x), or exp(-x^2).',
  xExpression: 'Parametric x expression in t, for example 2*cos(t).',
  yExpression: 'Parametric y expression in t, for example 2*sin(t).',
  rExpression: 'Polar radius expression in t, for example 2*cos(3*t).',
  uExpression: 'Vector-field x component as an expression in x and y.',
  vExpression: 'Vector-field y component as an expression in x and y.',
  color: 'Stroke or text color as a CSS color. Prefer clear, high-contrast colors.',
  fill: 'Fill color as a CSS color, or "none" for no fill.',
  labelSide: 'Side where the label is drawn. Change this when labels collide.',
};

function modelContext() {
  return document.modelContext || navigator.modelContext || null;
}

function schemaClone(schema) {
  return JSON.parse(JSON.stringify(schema || { type: 'object', properties: {} }));
}

function fieldDescription(name, property = {}) {
  const parts = [];
  if (property.description) parts.push(property.description);
  if (FIELD_GUIDANCE[name]) parts.push(FIELD_GUIDANCE[name]);
  return [...new Set(parts)].join(' ');
}

function schemaWithGuidance(schema) {
  const next = schemaClone(schema);
  for (const [name, property] of Object.entries(next.properties || {})) {
    property.description = fieldDescription(name, property);
  }
  return next;
}

function elementInputSchema(type) {
  const schema = schemaWithGuidance(type.schema);
  schema.properties = {
    id: {
      type: 'string',
      description: FIELD_GUIDANCE.id,
      minLength: 1,
      maxLength: 80,
    },
    ...(schema.properties || {}),
  };
  schema.additionalProperties = false;
  return schema;
}

function typeSummary(type) {
  return {
    name: type.name,
    label: type.label,
    group: type.group,
    hint: type.hint || '',
    tool: 'add_element',
    batchTool: 'apply_operations',
    required: type.schema.required || [],
    fields: Object.entries(type.schema.properties || {}).map(([name, property]) => ({
      name,
      type: property.type,
      description: fieldDescription(name, property),
      default: property.default,
      enum: property.enum,
      format: property.format,
    })),
  };
}

function elementSummary(element) {
  const type = getType(element.type);
  return {
    id: element.id,
    type: element.type,
    label: type.label,
    group: type.group,
    text: element.label || element.text || element.title || '',
    element: structuredClone(element),
  };
}

function comparableText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function displayText(element) {
  return element.label || element.text || element.title || element.value || element.id;
}

function positionSummary(element) {
  if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
    return { x: element.x, y: element.y };
  }
  if (
    Number.isFinite(element.x1) && Number.isFinite(element.y1)
    && Number.isFinite(element.x2) && Number.isFinite(element.y2)
  ) {
    return { x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2 };
  }
  if (typeof element.points === 'string' && element.points.trim()) {
    return { points: element.points };
  }
  return {};
}

function referenceSummary(element, type) {
  return Object.entries(type.schema.properties || {})
    .filter(([, property]) => property.format === 'elementRef')
    .map(([field]) => ({ field, id: element[field] || '', exists: !element[field] || Boolean(store.byId(element[field])) }))
    .filter((reference) => reference.id);
}

function compactElement(element) {
  const type = getType(element.type);
  return {
    id: element.id,
    type: element.type,
    name: type.label,
    group: type.group,
    display: displayText(element),
    selected: store.selection.includes(element.id),
    ...positionSummary(element),
    label: typeof element.label === 'string' ? element.label : undefined,
    value: typeof element.value === 'string' ? element.value : undefined,
    text: typeof element.text === 'string' ? element.text : undefined,
    title: typeof element.title === 'string' ? element.title : undefined,
    references: referenceSummary(element, type),
  };
}

function listElements({ type, group, query = '', selectedOnly = false, limit = 200 } = {}) {
  const needle = query.trim().toLowerCase();
  const matches = (element) => {
    const definition = getType(element.type);
    if (type && element.type !== type) return false;
    if (group && definition.group !== group) return false;
    if (selectedOnly && !store.selection.includes(element.id)) return false;
    if (!needle) return true;
    const haystack = [
      element.id, element.type, definition.label, definition.group,
      element.label, element.value, element.text, element.title,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  };
  const elements = store.doc.elements.filter(matches).slice(0, limit).map(compactElement);
  return { count: elements.length, total: store.doc.elements.length, elements };
}

function inspectElements(ids, { includeSchema = false } = {}) {
  const elements = [];
  const missing = [];
  for (const id of ids) {
    const element = store.byId(id);
    if (!element) {
      missing.push(id);
      continue;
    }
    const type = getType(element.type);
    elements.push({
      ...compactElement(element),
      element: structuredClone(element),
      schema: includeSchema ? elementInputSchema(type) : undefined,
    });
  }
  return { count: elements.length, missing, elements, diagnostics: diagnoseDiagram() };
}

function roundCoord(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function hasPoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function point(x, y) {
  return { x: roundCoord(x), y: roundCoord(y) };
}

function addPoints(a, b) {
  return point(a.x + b.x, a.y + b.y);
}

function scalePoint(vector, scale) {
  return point(vector.x * scale, vector.y * scale);
}

function unit(angle) {
  const radians = Number(angle || 0) * Math.PI / 180;
  return point(Math.cos(radians), Math.sin(radians));
}

function normalOf(vector) {
  return point(-vector.y, vector.x);
}

function normalise(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 ? point(vector.x / length, vector.y / length) : point(1, 0);
}

function parsePointString(source) {
  if (typeof source !== 'string') return [];
  return source.trim().split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? point(x, y) : null;
    })
    .filter(Boolean);
}

function formatPointString(points) {
  return points.map((item) => `${roundCoord(item.x)},${roundCoord(item.y)}`).join(' ');
}

function boundsFromPoints(points, padding = 0) {
  const real = points.filter(hasPoint);
  if (!real.length) return null;
  return {
    minX: roundCoord(Math.min(...real.map((item) => item.x)) - padding),
    minY: roundCoord(Math.min(...real.map((item) => item.y)) - padding),
    maxX: roundCoord(Math.max(...real.map((item) => item.x)) + padding),
    maxY: roundCoord(Math.max(...real.map((item) => item.y)) + padding),
  };
}

// The registry owns this: it is the same maths the anchors use, and two
// copies drifted apart. One rounded its axis to three decimals, so a box
// seated on a surface measured 0.003 units into it instead of exactly zero.
function rotatedBoxPoints(element, width = element.width || 0.1, height = element.height || element.width || 0.1) {
  return boxCorners(element, width, height);
}

function handleMarks(element) {
  const type = getType(element.type);
  if (!type || typeof type.handles !== 'function') return [];
  try {
    return (type.handles(element, (id) => store.byId(id)) || [])
      .filter(hasPoint)
      .map((handle) => point(handle.x, handle.y));
  } catch {
    return [];
  }
}

function boxHolds(box, marks, slack = 0.2) {
  return marks.every((mark) => (
    mark.x >= box.minX - slack && mark.x <= box.maxX + slack
    && mark.y >= box.minY - slack && mark.y <= box.maxY + slack
  ));
}

function estimatedBounds(element) {
  if (!element) return null;

  if (
    Number.isFinite(element.x1) && Number.isFinite(element.y1)
    && Number.isFinite(element.x2) && Number.isFinite(element.y2)
  ) {
    return boundsFromPoints([point(element.x1, element.y1), point(element.x2, element.y2)], 0.08);
  }

  const parsed = parsePointString(element.points);
  if (parsed.length) return boundsFromPoints(parsed, 0.08);

  if (element.type === 'surface' && Number.isFinite(element.x) && Number.isFinite(element.y)) {
    const along = unit(element.angle || 0);
    return boundsFromPoints([point(element.x, element.y), addPoints(point(element.x, element.y), scalePoint(along, element.length || 0))], 0.25);
  }

  if (element.type === 'pulley' && Number.isFinite(element.x) && Number.isFinite(element.y)) {
    // Built from the same geometry the type draws. The old version assumed the
    // rope always hung straight down, so a run following an incline reached
    // outside the box the audit was measuring against.
    const runs = wheelRuns(element);
    const marks = [
      point(element.x - runs.radius, element.y - runs.radius),
      point(element.x + runs.radius, element.y + runs.radius),
    ];
    for (const run of [runs.left, runs.right]) {
      if (run.span > 0) marks.push(point(run.end.x, run.end.y));
    }
    if (element.showBracket && runs.mount.span > 0) {
      const bar = runs.radius * 1.15;
      const across = { x: -runs.mount.way.y * bar, y: runs.mount.way.x * bar };
      marks.push(point(runs.mount.end.x - across.x, runs.mount.end.y - across.y));
      marks.push(point(runs.mount.end.x + across.x, runs.mount.end.y + across.y));
    }
    return boundsFromPoints(marks, 0.05);
  }

  if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
    if (Number.isFinite(element.width) || Number.isFinite(element.height)) {
      // x,y is a centre for a body but a corner for axes, and guessing wrong
      // put an on-sheet plot half off the sheet. The type's own drag handles
      // settle it: keep whichever candidate box actually contains them.
      const centred = boundsFromPoints(rotatedBoxPoints(element), 0.1);
      const marks = handleMarks(element);
      if (!marks.length || boxHolds(centred, marks)) return centred;

      const wide = element.width || element.height || 0.1;
      const tall = element.height || element.width || 0.1;
      const corner = boundsFromPoints(
        [point(element.x, element.y), point(element.x + wide, element.y + tall)],
        0.1,
      );
      if (boxHolds(corner, marks)) return corner;
      return boundsFromPoints([...marks, ...rotatedBoxPoints(element)], 0.1);
    }
    if (Number.isFinite(element.radius)) {
      return {
        minX: roundCoord(element.x - element.radius),
        maxX: roundCoord(element.x + element.radius),
        minY: roundCoord(element.y - element.radius),
        maxY: roundCoord(element.y + element.radius),
      };
    }
    if (Number.isFinite(element.length) && Number.isFinite(element.angle)) {
      const along = unit(element.angle);
      const half = element.type === 'surface' ? element.length : element.length / 2;
      const start = element.type === 'surface'
        ? point(element.x, element.y)
        : addPoints(point(element.x, element.y), scalePoint(along, -half));
      const end = element.type === 'surface'
        ? addPoints(point(element.x, element.y), scalePoint(along, element.length))
        : addPoints(point(element.x, element.y), scalePoint(along, half));
      return boundsFromPoints([start, end], 0.25);
    }
    return boundsFromPoints([point(element.x, element.y)], 0.2);
  }

  return null;
}

function visualBoundsOf(id) {
  const element = store.byId(id);
  if (!element) return null;
  try {
    const box = boundsOf(id);
    if (box) return {
      minX: roundCoord(box.minX),
      minY: roundCoord(box.minY),
      maxX: roundCoord(box.maxX),
      maxY: roundCoord(box.maxY),
    };
  } catch { /* no live SVG; fall back to stored geometry */ }
  return estimatedBounds(element);
}

function addAnchor(anchors, name, value, description = '') {
  if (!hasPoint(value) || anchors.some((anchor) => anchor.name === name)) return;
  anchors.push({ name, x: roundCoord(value.x), y: roundCoord(value.y), description });
}

function centreOfBox(box) {
  return point((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
}

/**
 * Anchors for one element, plus the bounds-derived fallback.
 *
 * The shape-derived anchors now come from the registry, where they sit beside
 * render() and handles(). Only the fallback stays here, because it needs the
 * live SVG that the bridge has and the type does not.
 */
function anchorSet(element) {
  const { anchors, along, normal } = anchorsOf(element, (id) => store.byId(id));
  const list = anchors.map((entry) => ({
    name: entry.name,
    x: roundCoord(entry.x),
    y: roundCoord(entry.y),
    description: entry.description || '',
  }));

  // A type with no geometry of its own still needs somewhere to attach.
  if (list.length <= 1) {
    const box = visualBoundsOf(element.id);
    if (box) {
      const midY = (box.minY + box.maxY) / 2;
      const midX = (box.minX + box.maxX) / 2;
      addAnchor(list, 'center', centreOfBox(box), 'Centre of the rendered object.');
      addAnchor(list, 'left', point(box.minX, midY), 'Left edge of the rendered object.');
      addAnchor(list, 'right', point(box.maxX, midY), 'Right edge of the rendered object.');
      addAnchor(list, 'top', point(midX, box.maxY), 'Top edge of the rendered object.');
      addAnchor(list, 'bottom', point(midX, box.minY), 'Bottom edge of the rendered object.');
    }
  }

  // Exact, not rounded. A direction is intermediate maths; only a coordinate
  // stored in the document needs rounding. Rounding the axis to three
  // decimals put a box 0.002 units off a surface it was placed flush against,
  // because the corners were computed from the exact axis and measured
  // against the rounded one.
  return {
    anchors: list,
    directions: {
      along,
      oppositeAlong: { x: -along.x, y: -along.y },
      normal,
      oppositeNormal: { x: -normal.x, y: -normal.y },
    },
  };
}


function anchorsFor(ids = []) {
  const source = ids.length ? ids : store.doc.elements.map((element) => element.id);
  const elements = [];
  const missing = [];
  for (const id of source) {
    const element = store.byId(id);
    if (!element) {
      missing.push(id);
      continue;
    }
    const { anchors, directions } = anchorSet(element);
    elements.push({
      id,
      type: element.type,
      display: displayText(element),
      bounds: visualBoundsOf(id),
      anchors,
      directions,
    });
  }
  return { count: elements.length, missing, elements };
}

function anchorByName(element, anchorName = 'center') {
  const { anchors } = anchorSet(element);
  return anchors.find((anchor) => anchor.name === anchorName)
    || anchors.find((anchor) => anchor.name === 'center')
    || anchors[0]
    || null;
}

function resolveAnchor({ elementId = '', anchor = 'center', x, y } = {}) {
  if (Number.isFinite(x) && Number.isFinite(y)) return point(x, y);
  const element = store.byId(elementId);
  if (!element) throw new Error(`No element with the id "${elementId}".`);
  const resolved = anchorByName(element, anchor);
  if (!resolved) throw new Error(`Element "${elementId}" has no usable anchors.`);
  return point(resolved.x, resolved.y);
}

function directionFromInput(input, start) {
  const direction = input.direction || 'angle';
  if (direction === 'angle') return unit(input.angle || 0);
  if (direction === 'right') return point(1, 0);
  if (direction === 'left') return point(-1, 0);
  if (direction === 'up') return point(0, 1);
  if (direction === 'down') return point(0, -1);

  if (direction === 'towards-element' || direction === 'away-from-element') {
    const target = resolveAnchor({
      elementId: input.toElementId || input.referenceElementId,
      anchor: input.toAnchor || 'center',
    });
    const vector = normalise(point(target.x - start.x, target.y - start.y));
    return direction === 'away-from-element' ? scalePoint(vector, -1) : vector;
  }

  if (direction.endsWith('-curve')) {
    const curve = store.byId(input.referenceElementId || input.fromElementId);
    if (!curve) throw new Error(`${direction} requires referenceElementId naming a curve.`);
    if (!Number.isFinite(input.atX)) throw new Error(`${direction} requires atX, the data x to take the tangent at.`);
    const tangent = curveTangent(curve, store.byId(curve.axesId), Number(input.atX));
    if (!tangent) throw new Error(`The curve "${curve.id}" has no tangent at x = ${input.atX}.`);
    if (direction === 'tangent-curve') return tangent;
    if (direction === 'opposite-tangent-curve') return scalePoint(tangent, -1);
    return normalOf(tangent);
  }

  const reference = store.byId(input.referenceElementId || input.fromElementId);
  if (!reference) throw new Error(`${direction} requires referenceElementId or fromElementId.`);
  const basis = anchorSet(reference).directions;
  if (direction === 'along-element') return basis.along;
  if (direction === 'opposite-along-element') return basis.oppositeAlong;
  if (direction === 'normal-element') return basis.normal;
  if (direction === 'opposite-normal-element') return basis.oppositeNormal;
  throw new Error(`Unknown vector direction "${direction}".`);
}

function addVector(input = {}) {
  // A point on a curve cannot be a named anchor, because it depends on a data
  // coordinate. atX names it instead.
  const onCurve = Number.isFinite(input.atX) && input.fromElementId
    ? (() => {
      const curve = store.byId(input.fromElementId);
      if (!curve || !Object.hasOwn(getType(curve.type).schema.properties || {}, 'expression')) return null;
      return curvePoint(curve, store.byId(curve.axesId), Number(input.atX));
    })()
    : null;

  const start = onCurve || resolveAnchor({
    elementId: input.fromElementId,
    anchor: input.fromAnchor || 'center',
    x: input.x,
    y: input.y,
  });
  const direction = directionFromInput(input, start);
  const length = Number(input.length ?? 1.5);
  if (!(length > 0)) throw new Error('Vector length must be positive.');

  // An attached label is drawn at the shaft midpoint and its only other knob
  // is which side it sits on. When the shaft runs through the body, no side
  // clears the body's own label. Shifting the whole arrow is the fix, so the
  // tail moves sideways rather than the text.
  const offset = Number(input.offset ?? 0);
  const gap = Number(input.gap ?? 0);
  const sideways = normalOf(direction);
  const tail = addPoints(start, addPoints(scalePoint(direction, gap), scalePoint(sideways, offset)));
  const end = addPoints(tail, scalePoint(direction, length));
  const values = {
    id: input.id,
    x1: roundCoord(tail.x),
    y1: roundCoord(tail.y),
    x2: roundCoord(end.x),
    y2: roundCoord(end.y),
    head: input.head || 'end',
    color: input.color || '#1f2937',
    strokeWidth: input.strokeWidth ?? 2.2,
    style: input.style || 'solid',
    label: input.label || '',
    labelSide: input.labelSide || 'left',
    labelSize: input.labelSize ?? 15,
  };
  if (!values.id) delete values.id;
  const element = addElement('arrow', values);
  return { element: compactElement(element), start: tail, end, direction, anchor: start };
}

function addConnector(input = {}) {
  const start = resolveAnchor({
    elementId: input.fromElementId,
    anchor: input.fromAnchor || 'center',
    x: input.x1,
    y: input.y1,
  });
  const end = resolveAnchor({
    elementId: input.toElementId,
    anchor: input.toAnchor || 'center',
    x: input.x2,
    y: input.y2,
  });
  const via = Array.isArray(input.via)
    ? input.via.filter(hasPoint).map((item) => point(item.x, item.y))
    : [];
  const route = input.route || 'direct';
  const points = route === 'orthogonal' && !via.length
    ? [start, point(start.x, end.y), end]
    : [start, ...via, end];
  const values = {
    id: input.id,
    points: formatPointString(points),
    closed: false,
    head: input.head || 'none',
    fill: 'none',
    fillOpacity: 0.15,
    color: input.color || '#1f2937',
    strokeWidth: input.strokeWidth ?? 2,
    style: input.style || 'solid',
    label: input.label || '',
    labelSize: input.labelSize ?? 14,
  };
  if (!values.id) delete values.id;
  const element = addElement('polyline', values);
  return { element: compactElement(element), points };
}

function buildElementSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('Every element must be an object.');
  if (!spec.type) throw new Error('Every element requires a type.');
  if (!TYPE_NAMES().includes(spec.type)) throw new Error(`Unknown element type "${spec.type}".`);
  const { type, ...values } = spec;
  assertKnownFields(type, values, { includeId: true, context: 'values' });
  return { type, values };
}

function replaceDiagram({ title = 'Untitled diagram', canvas = {}, elements = [], selection = [], fitAfter = false } = {}, options = {}) {
  if (!Array.isArray(elements)) throw new Error('replace_diagram requires an elements array.');
  const seen = new Set();
  const specs = elements.map(buildElementSpec);
  for (const { type, values } of specs) {
    if (values.id) {
      if (seen.has(values.id)) throw new Error(`Duplicate element id "${values.id}".`);
      seen.add(values.id);
    }
    assertSemanticElement(type, { id: values.id || type, ...values });
  }

  assertCanvasFields(canvas);
  const beforeDoc = structuredClone(store.doc);
  const beforeSelection = structuredClone(store.selection);
  const beforeView = structuredClone(store.view);
  const created = [];

  try {
    store.transaction('agent replace diagram', () => {
      store.replaceDocument({ title: title.trim() || 'Untitled diagram', canvas: { ...emptyDocument().canvas, ...canvas }, elements: [] }, { history: false });
      for (const { type, values } of specs) {
        created.push(store.addElement(type, values));
      }
      store.select(selection.filter((id) => store.byId(id)));
    });
    if (fitAfter && options.fitToWindow) options.fitToWindow();
  } catch (error) {
    restoreState(beforeDoc, beforeSelection, beforeView);
    throw error;
  }

  return { ok: true, created: created.map(compactElement), diagnostics: diagnoseDiagram(), diagram: snapshot() };
}

function visualLayoutIssues() {
  const issues = [];
  const boxes = store.doc.elements
    .map((element) => ({ element, bounds: visualBoundsOf(element.id) }))
    .filter((entry) => entry.bounds);
  const { width, height } = store.doc.canvas;

  for (const { element, bounds } of boxes) {
    if (bounds.maxX < 0 || bounds.minX > width || bounds.maxY < 0 || bounds.minY > height) {
      issues.push(problem('warning', 'Off-canvas element', `${element.id} is outside the visible sheet. Delete it instead of hiding it off-canvas.`, element.id));
    } else if (bounds.minX < -0.05 || bounds.minY < -0.05 || bounds.maxX > width + 0.05 || bounds.maxY > height + 0.05) {
      issues.push(problem('warning', 'Clipped element', `${element.id} touches or crosses the sheet boundary.`, element.id));
    }
  }

  // Compare the drawn text itself. A label attached to an arrow or a body is
  // not an element of its own, so an element-box comparison misses every
  // collision that actually makes a diagram hard to read.
  const texts = allLabelBoxes();
  const reported = new Set();
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const first = texts[a];
      const second = texts[b];
      if (first.element.id === second.element.id) continue;
      // A negative pad, so text that merely touches is reported too. Two
      // labels sharing an edge are as hard to read as two that overlap.
      if (!boxesOverlap(first.box, second.box, -LABEL_GAP)) continue;
      const key = [first.element.id, second.element.id].sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      issues.push(problem(
        'warning',
        'Label collision',
        `The label on ${first.element.id} overlaps the label on ${second.element.id}. Flip a labelSide or move one of them.`,
        first.element.id,
      ));
    }
  }

  // A solid buried in a surface. The renderer draws exactly what it is told,
  // so a block sunk halfway into a table passed every check while being the
  // most obvious error in the figure.
  const surfaces = store.doc.elements.filter((element) => element.type === 'surface');
  for (const element of store.doc.elements) {
    if (!SOLID_TYPES.has(element.type)) continue;
    for (const host of surfaces) {
      const seated = straddleOf(element, host);
      if (!seated) continue;
      if (seated.min < -SURFACE_TOLERANCE && seated.max > SURFACE_TOLERANCE) {
        issues.push(problem(
          'warning',
          'Solid crosses a surface',
          `${element.id} is ${Math.abs(seated.min)} units inside ${host.id}. `
          + `Use place_on_element to seat it on the surface instead of setting x and y by hand.`,
          element.id,
        ));
      }
    }
  }

  // An element whose render threw. It is simply absent from the drawing, and
  // the only previous sign was a console warning nobody reads.
  for (const failure of renderFailures()) {
    issues.push(problem(
      'error',
      'Element failed to draw',
      `${failure.id} (${failure.type}) threw while rendering and is missing from the figure: ${failure.reason}`,
      failure.id,
    ));
  }

  // A circuit terminal that nearly touches another one.
  for (const dangling of danglingTerminals()) {
    issues.push(problem(
      'warning',
      'Terminal not connected',
      `${dangling.id}.${dangling.terminal} is ${dangling.gap} units from ${dangling.nearest} `
      + `but not joined to it. Use add_two_terminal so the part spans its two ends exactly, `
      + `instead of setting a length by hand.`,
      dangling.id,
    ));
  }

  // An angle arc sweeps counter-clockwise from `from` to `to`. Give them in
  // the wrong order and it takes the long way round, drawing a near-complete
  // circle that reads as a different element altogether.
  for (const element of store.doc.elements) {
    if (element.type !== 'angle') continue;
    const sweep = ((Number(element.to) - Number(element.from)) % 360 + 360) % 360;
    if (sweep > REFLEX_ARC) {
      issues.push(problem(
        'warning',
        'Reflex angle arc',
        `${element.id} sweeps ${roundCoord(sweep)} degrees counter-clockwise from `
        + `${element.from} to ${element.to}. Swap them for the ${roundCoord(360 - sweep)} degree arc.`,
        element.id,
      ));
    }
  }

  // There was a "text over an object" check here. It is gone on purpose.
  //
  // It existed because a label lying on a filled body used to be unreadable.
  // Labels now carry a white halo, so they are legible over any fill, and the
  // check began firing on correct figures: a point named inside a lightly
  // shaded circle is ordinary geometry, not a defect. A diagnostic that
  // reports good work teaches a caller to ignore diagnostics, so the honest
  // move once the halo landed was to withdraw the check rather than tune it.
  //
  // Text over *text* is still reported above, because no halo saves two
  // labels drawn on the same spot.

  if (!issues.length) issues.push(problem('ok', 'Layout ready', 'No off-canvas elements, clipped objects, or obvious label overlaps were detected.'));
  return issues;
}

const TEXT_TYPES = new Set(['label', 'text-box']);

// Clear space two labels must keep between them, in diagram units.
const LABEL_GAP = 0.06;

// How far a solid may cross a surface before it counts as buried in it.
const SURFACE_TOLERANCE = 0.05;

// An angle arc wider than this is reported. A real reflex angle is rare in a
// physics or geometry figure; a reversed from/to is not.
const REFLEX_ARC = 200;

// Two circuit terminals this close count as joined. It is the precision the
// geometry already lands on: a bridge built from node coordinates measures
// 0.000 at every joint.
const JOIN_TOLERANCE = 0.02;

// A lone terminal is only reported when another one sits this close. Further
// away is a deliberate open end: a probe point, an antenna, a symbol drawn on
// its own. Nearer is a connection that was meant to happen and did not.
const NEAR_MISS = 1;

// Anything below space except tab, newline and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// Shapes whose bounding box really is filled. Used by the surface check, which
// asks whether a solid is buried in a surface it should be resting on.
const SOLID_TYPES = new Set([
  'body', 'block', 'container', 'node', 'charge', 'shape', 'text-box', 'lamp', 'meter',
]);

function nextPaint() {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Measures each rendered text run on its own.
 *
 * boundsOf() returns one box for a whole element, so an arrow's label is
 * hidden inside the arrow's own box and a box-versus-box audit can never see
 * it. That is why "N" could sit on top of "m_1" and the layout still reported
 * clean. Headless callers get an empty list, because nothing has been drawn.
 */
function labelBoxesOf(id) {
  const host = typeof document !== 'undefined' && document.getElementById
    ? document.getElementById('canvas-host')
    : null;
  const ctx = host && host.__ctx;
  if (!ctx || typeof host.querySelector !== 'function') return [];

  const node = host.querySelector(`.element[data-id="${CSS.escape(id)}"]`);
  if (!node || typeof node.querySelectorAll !== 'function') return [];

  const boxes = [];
  for (const text of node.querySelectorAll('text')) {
    if (!String(text.textContent || '').trim()) continue;
    try {
      const box = text.getBBox();
      if (!(box.width > 0 && box.height > 0)) continue;
      const bottomLeft = ctx.D(box.x, box.y + box.height);
      const topRight = ctx.D(box.x + box.width, box.y);
      boxes.push({
        minX: roundCoord(bottomLeft.x), maxX: roundCoord(topRight.x),
        minY: roundCoord(bottomLeft.y), maxY: roundCoord(topRight.y),
      });
    } catch { /* detached node */ }
  }
  return boxes;
}

function allLabelBoxes() {
  return store.doc.elements.flatMap((element) => (
    labelBoxesOf(element.id).map((box) => ({ element, box }))
  ));
}

/**
 * The straight runs an element draws, in document units.
 *
 * Derived from the anchors, so an arrow, a rope, a wire and a surface all
 * report their geometry without a per-type branch.
 */
function segmentsOf(element) {
  if (hasPoint({ x: element.x1, y: element.y1 }) && hasPoint({ x: element.x2, y: element.y2 })) {
    return [[point(element.x1, element.y1), point(element.x2, element.y2)]];
  }

  const path = parsePointString(element.points);
  if (path.length > 1) {
    return path.slice(0, -1).map((from, index) => [from, path[index + 1]]);
  }

  const { anchors } = anchorsOf(element, (other) => store.byId(other));
  const start = anchors.find((a) => a.name === 'start');
  const end = anchors.find((a) => a.name === 'end');
  if (start && end) return [[point(start.x, start.y), point(end.x, end.y)]];
  return [];
}

/** Does a segment cross an axis-aligned box? Liang-Barsky clipping. */
function segmentHitsBox(from, to, box) {
  let t0 = 0;
  let t1 = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return clip(-dx, from.x - box.minX)
    && clip(dx, box.maxX - from.x)
    && clip(-dy, from.y - box.minY)
    && clip(dy, box.maxY - from.y);
}

/**
 * Lines drawn straight through a label, other than its own.
 *
 * This is what actually crowds a body's label in a free-body diagram: the
 * force arrows all leave the centre of mass, so the shafts cross the text
 * while no two labels overlap at all. Comparing labels to labels reported the
 * figure clean while three arrows ran through the letter m.
 */
function linesThroughLabel(id, boxes) {
  let count = 0;
  for (const element of store.doc.elements) {
    if (element.id === id) continue;
    for (const [from, to] of segmentsOf(element)) {
      for (const box of boxes) {
        if (segmentHitsBox(from, to, box)) count += 1;
      }
    }
  }
  return count;
}

/**
 * A label box worked out from the schema rather than measured.
 *
 * The measured path needs a rendered <text> node. Without one the placer had
 * nothing to compare and quietly did nothing, which is worse than an estimate:
 * a caller running headless got a silent no-op instead of a tidy diagram.
 *
 * The audit does not use this. It reports only what it measured, because a
 * warning built on an estimate is a warning a caller cannot trust. The placer
 * may act on an estimate, because its move is checked and reversible.
 */
function estimateLabelBox(element) {
  const source = String(element.label ?? element.text ?? '').trim();
  if (!source) return null;

  const size = Number(element.labelSize ?? element.size ?? 15);
  const scale = Number(store.view?.scale) || 30;
  const halfWide = measureText(source, size) / scale / 2;
  const halfTall = (size * 1.25) / scale / 2;

  const at = labelAnchorOf(element);
  if (!at) return null;
  return {
    minX: at.x - halfWide, maxX: at.x + halfWide,
    minY: at.y - halfTall, maxY: at.y + halfTall,
  };
}

/** Roughly where a type draws its label, in document units. */
function labelAnchorOf(element) {
  const properties = getType(element.type)?.schema?.properties || {};
  if (Object.hasOwn(properties, 'labelPlace')) return labelPointOf(element, (id) => store.byId(id));

  const runs = segmentsOf(element);
  if (runs.length) {
    const [from, to] = runs[Math.floor((runs.length - 1) / 2)];
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }

  if (hasPoint(element)) return point(element.x, element.y);
  return null;
}

/** Measured boxes when a renderer exists, estimates when it does not. */
function labelBoxesForPlacing() {
  const measured = allLabelBoxes();
  if (measured.length) return measured;
  return store.doc.elements
    .map((element) => ({ element, box: estimateLabelBox(element) }))
    .filter((entry) => entry.box);
}

function labelCollisions(id, texts = labelBoxesForPlacing()) {
  const mine = texts.filter((entry) => entry.element.id === id);
  const others = texts.filter((entry) => entry.element.id !== id);
  let count = 0;
  for (const one of mine) {
    for (const other of others) {
      if (boxesOverlap(one.box, other.box, -LABEL_GAP)) count += 1;
    }
  }
  return count + linesThroughLabel(id, mine.map((entry) => entry.box));
}

/**
 * Every way this element can move its own label.
 *
 * labelSide slides an attached label across its shaft. labelPlace moves a
 * shape's label off dead centre, which is the only escape when arrows radiate
 * from the centre of mass and the label has nowhere else to be.
 */
const LABEL_FIELDS = ['labelSide', 'labelPlace'];

function labelMoves(element) {
  const properties = getType(element.type)?.schema?.properties || {};
  const moves = [];
  for (const field of LABEL_FIELDS) {
    const values = properties[field]?.enum;
    if (Array.isArray(values) && values.length > 1) moves.push({ field, values });
  }
  return moves;
}

function boxesOverlap(a, b, pad = 0) {
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > pad
    && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > pad;
}

function shiftBox(box, dx, dy) {
  return { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
}

function insideSheet(box) {
  const { width, height } = store.doc.canvas;
  return box.minX >= 0 && box.minY >= 0 && box.maxX <= width && box.maxY <= height;
}

/**
 * Nudges overlapping text out of the way.
 *
 * The candidate offsets are tried nearest first, so a label moves the least
 * distance that clears it. Obstacle boxes are translated arithmetically rather
 * than re-measured, because the SVG has not repainted yet inside the loop.
 */
async function autoPlaceLabels({ ids = [], padding = 0.15, maxShift = 1, flipSides = true } = {}) {
  const entries = store.doc.elements
    .map((element) => ({ element, bounds: visualBoundsOf(element.id) }))
    .filter((entry) => entry.bounds);

  const wanted = ids.length ? new Set(ids) : null;
  const movable = entries.filter(({ element }) => (
    TEXT_TYPES.has(element.type)
    && Number.isFinite(element.x) && Number.isFinite(element.y)
    && (!wanted || wanted.has(element.id))
  ));

  const steps = [];
  const rings = 6;
  for (let ring = 1; ring <= rings; ring += 1) {
    const d = (maxShift / rings) * ring;
    steps.push(
      { dx: 0, dy: d }, { dx: 0, dy: -d }, { dx: d, dy: 0 }, { dx: -d, dy: 0 },
      { dx: d, dy: d }, { dx: -d, dy: d }, { dx: d, dy: -d }, { dx: -d, dy: -d },
    );
  }

  const settled = new Map();
  const boxFor = (entry) => settled.get(entry.element.id) || entry.bounds;
  const moved = [];
  const stuck = [];

  store.transaction('agent auto place labels', () => {
    for (const { element, bounds } of movable) {
      const obstacles = entries
        .filter((entry) => entry.element.id !== element.id)
        .map(boxFor);
      const clashes = (box) => obstacles.some((other) => boxesOverlap(box, other, padding));

      if (insideSheet(bounds) && !clashes(bounds)) continue;

      const found = steps.find((step) => {
        const box = shiftBox(bounds, step.dx, step.dy);
        return insideSheet(box) && !clashes(box);
      });

      if (!found) {
        stuck.push(element.id);
        continue;
      }

      const to = { x: roundCoord(element.x + found.dx), y: roundCoord(element.y + found.dy) };
      const from = { x: element.x, y: element.y };
      updateElement(element.id, to);
      settled.set(element.id, shiftBox(bounds, found.dx, found.dy));
      moved.push({ id: element.id, from, to });
    }
  });

  const flipped = [];
  const unresolved = [];
  if (flipSides) {
    // An attached label has no x,y to nudge. Its one degree of freedom is the
    // side of the shaft it sits on, so try the alternatives and keep the side
    // with the fewest collisions. Each trial needs a repaint before the text
    // can be measured again.
    await nextPaint();
    const wantedFlip = ids.length ? new Set(ids) : null;
    const candidates = store.doc.elements.filter((element) => (
      labelMoves(element).length > 0
      && String(element.label || '').trim()
      && (!wantedFlip || wantedFlip.has(element.id))
    ));

    for (const element of candidates) {
      let score = labelCollisions(element.id);
      if (score === 0) continue;

      // Each field is tried on its own, keeping whatever helped. Trying every
      // combination would be exponential for no gain: the fields move the
      // label in different directions, so improvements compose.
      for (const { field, values } of labelMoves(element)) {
        const original = store.byId(element.id)?.[field];
        let best = { value: original, score };

        for (const value of values) {
          if (value === original) continue;
          updateElement(element.id, { [field]: value });
          await nextPaint();
          const trial = labelCollisions(element.id);
          if (trial < best.score) best = { value, score: trial };
          if (trial === 0) break;
        }

        updateElement(element.id, { [field]: best.value });
        await nextPaint();
        score = best.score;
        if (best.value !== original) {
          flipped.push({ id: element.id, field, from: original, to: best.value });
        }
        if (score === 0) break;
      }

      // Say so when nothing helped. Silence here reads as "nothing was wrong",
      // and the caller then has no reason to move the objects apart.
      if (score > 0) unresolved.push({ id: element.id, collisions: score });
    }
  }

  return { checked: movable.length, moved, stuck, flipped, unresolved };
}

/**
 * Crops the sheet to what is actually drawn.
 *
 * A figure for a lecture note is placed in the page by its own size. A drawing
 * sitting in one corner of an oversized sheet exports with a wide band of
 * blank paper, and the reader sees a small figure with a lot of nothing.
 */
async function fitCanvasToContent({ padding = 0.8, minSize = 2 } = {}) {
  await nextPaint();

  const boxes = store.doc.elements
    .map((element) => visualBoundsOf(element.id))
    .filter(Boolean);
  if (!boxes.length) throw new Error('The diagram has no elements to fit the sheet to.');

  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const maxY = Math.max(...boxes.map((b) => b.maxY));

  const before = structuredClone(store.doc.canvas);
  const width = roundCoord(Math.max(minSize, (maxX - minX) + padding * 2));
  const height = roundCoord(Math.max(minSize, (maxY - minY) + padding * 2));
  const dx = roundCoord(padding - minX);
  const dy = roundCoord(padding - minY);

  store.transaction('agent fit canvas', () => {
    store.shiftAll(dx, dy);
    store.setCanvas({ width, height });
  });

  // Everything moved. Without a repaint the next caller measures the old
  // screen positions against the new sheet and reports phantom clipping.
  await nextPaint();

  return {
    canvas: structuredClone(store.doc.canvas),
    previousCanvas: before,
    movedBy: { dx, dy },
    contentBounds: { minX, minY, maxX, maxY },
  };
}

/** The host's start point and its along/normal axes. */
function hostFrame(host) {
  const { anchors, directions } = anchorSet(host);
  const origin = anchors.find((a) => a.name === 'start')
    || anchors.find((a) => a.name === 'center')
    || anchors[0];
  if (!origin) return null;
  return { origin: point(origin.x, origin.y), along: directions.along, normal: directions.normal };
}

/** How far an element's centre must sit off a surface for it to rest on it. */
function standoffFor(element) {
  if (Number.isFinite(element.height)) return Math.abs(element.height) / 2;
  if (Number.isFinite(element.radius)) return Math.abs(element.radius);
  if (Number.isFinite(element.width)) return Math.abs(element.width) / 2;
  return 0;
}

/** The four corners of a solid, in document units, rotation included. */
function solidCorners(element) {
  if (!Number.isFinite(element.x) || !Number.isFinite(element.y)) return [];
  const wide = Number.isFinite(element.width) ? element.width : null;
  const tall = Number.isFinite(element.height) ? element.height : wide;
  if (!(wide > 0) || !(tall > 0)) return [];
  return rotatedBoxPoints(element, wide, tall);
}

/**
 * Signed distance from a surface line, positive on the side its normal points
 * to. A body resting on the surface has its lower corners at zero.
 */
function straddleOf(element, host) {
  const frame = hostFrame(host);
  const corners = solidCorners(element);
  if (!frame || !corners.length) return null;

  const distance = (p) => (p.x - frame.origin.x) * frame.normal.x
    + (p.y - frame.origin.y) * frame.normal.y;
  const reach = (p) => (p.x - frame.origin.x) * frame.along.x
    + (p.y - frame.origin.y) * frame.along.y;

  const span = Number(host.length) || 0;
  const along = corners.map(reach);
  // Only a solid actually over the surface can be resting on it.
  if (span > 0 && (Math.max(...along) < -0.1 || Math.min(...along) > span + 0.1)) return null;

  const depths = corners.map(distance);
  return {
    min: roundCoord(Math.min(...depths)),
    max: roundCoord(Math.max(...depths)),
    depths: depths.map(roundCoord),
  };
}

/**
 * Positions and sizes elements in a plot's data coordinates.
 *
 * Only the plot types carry an axesId. Everything else lives in document
 * units, so a caller annotating a graph has to convert by hand — and the two
 * axes rarely share a scale. Eight rectangles for a Riemann sum, computed in
 * data units and handed straight to add_element, landed in a heap in the
 * corner of the sheet at a fraction of their intended size.
 *
 * Width and height convert through their own axis, which is what makes a
 * rectangle one data step wide and three data units tall come out right on a
 * plot that is stretched.
 */
async function placeInAxes({ axesId, elementId, dataX, dataY, dataWidth, dataHeight, elements } = {}) {
  const axes = store.byId(axesId);
  if (!axes) throw new Error(`No axes with the id "${axesId}".`);
  if (!Object.hasOwn(getType(axes.type).schema.properties || {}, 'xMin')) {
    throw new Error(`"${axesId}" is not an axes element.`);
  }

  const toDoc = axesMapper(axes).toDoc;
  const perX = axes.width / ((axes.xMax - axes.xMin) || 1);
  const perY = axes.height / ((axes.yMax - axes.yMin) || 1);

  const list = Array.isArray(elements) && elements.length
    ? elements
    : [{ elementId, dataX, dataY, dataWidth, dataHeight }];

  const placed = [];
  store.transaction('agent place in axes', () => {
    for (const spec of list) {
      const element = store.byId(spec.elementId);
      if (!element) throw new Error(`No element with the id "${spec.elementId}".`);

      const changes = {};
      if (Number.isFinite(spec.dataX) && Number.isFinite(spec.dataY)) {
        const at = toDoc(Number(spec.dataX), Number(spec.dataY));
        changes.x = roundCoord(at.x);
        changes.y = roundCoord(at.y);
      }
      if (Number.isFinite(spec.dataWidth)) changes.width = roundCoord(Math.abs(spec.dataWidth) * perX);
      if (Number.isFinite(spec.dataHeight)) changes.height = roundCoord(Math.abs(spec.dataHeight) * perY);

      if (!Object.keys(changes).length) {
        throw new Error(`Nothing to place for "${spec.elementId}": give dataX and dataY, or a data size.`);
      }
      updateElement(spec.elementId, changes);
      placed.push({ id: spec.elementId, ...changes });
    }
  });

  await nextPaint();
  return {
    axes: axesId,
    unitsPerDataX: roundCoord(perX),
    unitsPerDataY: roundCoord(perY),
    isotropic: Math.abs(perX - perY) < 1e-6,
    placed,
  };
}

/**
 * Adds a two-terminal circuit part spanning exactly two points.
 *
 * The centre, the length and the angle are derived here. A caller who computes
 * them writes `length: distance(from, to)` four times and then, once, writes
 * `distance(from, to) - 1.4` for cosmetic reasons and silently breaks the
 * circuit. Deriving them removes the chance.
 */
async function addTwoTerminal({ type, from, to, values = {}, id } = {}) {
  if (!type) throw new Error('add_two_terminal requires a part type.');
  const definition = getType(type);
  if (!definition) throw new Error(`Unknown element type "${type}".`);
  if (definition.group !== 'Circuit') {
    throw new Error(`"${type}" is not a circuit part. add_two_terminal covers the Circuit group.`);
  }
  const properties = definition.schema.properties || {};
  for (const field of ['length', 'angle', 'x', 'y']) {
    if (!Object.hasOwn(properties, field)) {
      throw new Error(`"${type}" has no ${field}, so it cannot span two points.`);
    }
  }

  const head = resolveAnchor(from || {});
  const tail = resolveAnchor(to || {});
  const span = Math.hypot(tail.x - head.x, tail.y - head.y);
  if (!(span > 0.05)) throw new Error('The two ends are the same point, so the part has no length.');

  assertKnownFields(type, values, { includeId: false, context: 'values' });
  const derived = ['x', 'y', 'length', 'angle'].filter((field) => Object.hasOwn(values, field));
  if (derived.length) {
    throw new Error(
      `add_two_terminal computes ${derived.join(', ')} from the two ends. `
      + 'Passing them would be ignored, which is how a part ends up not reaching its nodes. '
      + 'Move the ends instead.',
    );
  }
  const element = addElement(type, {
    ...values,
    ...(id ? { id } : {}),
    x: roundCoord((head.x + tail.x) / 2),
    y: roundCoord((head.y + tail.y) / 2),
    length: roundCoord(span),
    angle: roundCoord(Math.atan2(tail.y - head.y, tail.x - head.x) / DEG_PER_RAD),
  });

  await nextPaint();

  // Report whether each end actually landed on something, so a caller sees
  // the connection rather than assuming it.
  const model = circuitPoints();
  const joins = model.ends.filter((end) => end.id === element.id).map((end) => {
    const near = nearestJoin(end, model);
    return {
      terminal: end.name,
      at: { x: roundCoord(end.x), y: roundCoord(end.y) },
      joinedTo: near && near.gap <= JOIN_TOLERANCE ? near.label : null,
      nearestGap: near ? roundCoord(near.gap) : null,
    };
  });

  return { element: compactElement(element), span: roundCoord(span), joins };
}

const DEG_PER_RAD = Math.PI / 180;

/**
 * Seats an element on another, so the caller never does the trigonometry.
 *
 * add_element takes raw x and y, which means placing a block on an incline is
 * a sine and a cosine done by hand. That is how a block ended up buried
 * 0.63 units into a slope while every diagnostic reported the diagram clean.
 */
async function placeOnElement({
  elementId, hostId, distance, fraction = 0.5, standoff, side = 'above', align,
} = {}) {
  const element = store.byId(elementId);
  if (!element) throw new Error(`No element with the id "${elementId}".`);
  const host = store.byId(hostId);
  if (!host) throw new Error(`No host element with the id "${hostId}".`);
  if (element.id === host.id) throw new Error('An element cannot be placed on itself.');

  const frame = hostFrame(host);
  if (!frame) throw new Error(`Element "${hostId}" has no usable axis to place along.`);

  const span = Number(host.length);
  const reach = Number.isFinite(distance)
    ? Number(distance)
    : (Number.isFinite(span) ? span * fraction : 0);

  const lift = Number.isFinite(standoff) ? Number(standoff) : standoffFor(element);
  const sign = side === 'below' ? -1 : 1;

  const changes = {
    x: roundCoord(frame.origin.x + frame.along.x * reach + frame.normal.x * lift * sign),
    y: roundCoord(frame.origin.y + frame.along.y * reach + frame.normal.y * lift * sign),
  };

  // A block on a slope has to lie along it. Only set an angle the type owns.
  const wantsAngle = align === undefined
    ? Object.hasOwn(getType(element.type).schema.properties || {}, 'angle')
    : Boolean(align);
  if (wantsAngle && Object.hasOwn(getType(element.type).schema.properties || {}, 'angle')) {
    changes.angle = roundCoord(Number(host.angle) || 0);
  }

  updateElement(element.id, changes);
  await nextPaint();

  const seated = straddleOf(store.byId(element.id), host);
  return {
    placed: changes,
    standoff: roundCoord(lift),
    distanceAlong: roundCoord(reach),
    // Zero on the contact side is what "resting on it" means.
    contact: seated ? { nearest: seated.min, furthest: seated.max } : null,
  };
}

/**
 * The circuit connection model.
 *
 * Scoped to the Circuit group, and derived from the group rather than a list,
 * so a new part is covered the day it is defined. Outside circuits the same
 * rule would be noise: an arrow tip landing near a shape is ordinary.
 *
 * Two kinds of point, and the distinction matters:
 *
 *   ends      must connect to something. A part's two terminals, a wire's
 *             first and last vertex, a ground symbol's attachment point.
 *   targets   things an end may connect TO. All of the above, plus a wire's
 *             interior bends, plus any point along a wire segment.
 *
 * A wire's interior bend is already connected, to the rest of its own wire.
 * Treating it as an end reported every corner that happened to sit near a
 * component as a fault.
 */
function circuitPoints() {
  const ends = [];
  const targets = [];
  const segments = [];

  for (const element of store.doc.elements) {
    if (getType(element.type)?.group !== 'Circuit') continue;
    const id = element.id;

    if (element.type === 'wire') {
      const path = parsePointString(element.points);
      path.forEach((at, index) => {
        const spot = { id, name: `point ${index}`, x: at.x, y: at.y };
        targets.push(spot);
        if (index === 0 || index === path.length - 1) ends.push(spot);
      });
      for (let index = 0; index < path.length - 1; index += 1) {
        segments.push({ id, from: path[index], to: path[index + 1] });
      }
      continue;
    }

    const { anchors } = anchorsOf(element, (other) => store.byId(other));
    const start = anchors.find((a) => a.name === 'start');
    const finish = anchors.find((a) => a.name === 'end');
    if (start && finish) {
      for (const [name, at] of [['start', start], ['end', finish]]) {
        const spot = { id, name, x: at.x, y: at.y };
        ends.push(spot);
        targets.push(spot);
      }
      continue;
    }

    const centre = anchors.find((a) => a.name === 'center');
    if (centre) {
      const spot = { id, name: 'terminal', x: centre.x, y: centre.y };
      ends.push(spot);
      targets.push(spot);
    }
  }

  return { ends, targets, segments };
}

/** Distance from a point to a segment, and the closest point on it. */
function toSegment(at, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSquared))
    : 0;
  const closest = { x: from.x + dx * t, y: from.y + dy * t };
  return { gap: Math.hypot(at.x - closest.x, at.y - closest.y), at: closest };
}

/** The nearest thing a given end could join, excluding its own element. */
function nearestJoin(end, { targets, segments }) {
  let best = null;
  const consider = (gap, label) => {
    if (!best || gap < best.gap) best = { gap, label };
  };

  for (const target of targets) {
    if (target.id === end.id) continue;
    consider(Math.hypot(target.x - end.x, target.y - end.y), `${target.id}.${target.name}`);
  }
  for (const segment of segments) {
    if (segment.id === end.id) continue;
    consider(toSegment(end, segment.from, segment.to).gap, `${segment.id} (along its run)`);
  }
  return best;
}

/**
 * Ends that nearly touch something without joining it.
 *
 * This is the check that was missing when a galvanometer was written with
 * `length: distance - 1.4`, leaving both its leads 0.700 short of the bridge
 * nodes. Every other joint in that figure measured 0.000; nothing compared the
 * two, so the detector hung unwired and the audit called the diagram clean.
 *
 * An end with nothing near it is left alone. That is a probe point, an
 * antenna, or a symbol drawn on its own, and reporting it would teach a caller
 * to ignore the check.
 */
function danglingTerminals() {
  const model = circuitPoints();
  const found = [];
  const seen = new Set();

  for (const end of model.ends) {
    const near = nearestJoin(end, model);
    if (!near) continue;
    if (near.gap <= JOIN_TOLERANCE) continue;   // joined
    if (near.gap > NEAR_MISS) continue;         // deliberately open

    // One report per pair, not one per side.
    const key = [`${end.id}.${end.name}`, near.label].sort().join(' <-> ');
    if (seen.has(key)) continue;
    seen.add(key);

    found.push({
      id: end.id,
      terminal: end.name,
      nearest: near.label,
      gap: roundCoord(near.gap),
    });
  }
  return found;
}

function visibleStatus(text, ready = false) {
  const mount = document.getElementById('toolbar');
  if (!mount) return;

  let pill = document.getElementById('webmcp-status');
  if (!pill) {
    pill = document.createElement('span');
    pill.id = 'webmcp-status';
    pill.className = 'webmcp-pill';
    mount.append(pill);
  }
  pill.textContent = text;
  pill.classList.toggle('is-ready', ready);
}

function problem(severity, title, detail, elementId = '') {
  return { severity, title, detail, elementId };
}

function expressionVariables(key) {
  if (key === 'uExpression' || key === 'vExpression') return ['x', 'y'];
  if (key === 'xExpression' || key === 'yExpression' || key === 'rExpression') return 't';
  return 'x';
}

function balanced(source) {
  let braces = 0;
  let dollars = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{') braces += 1;
    if (char === '}') braces -= 1;
    if (char === '$') dollars += 1;
    if (braces < 0) return false;
  }
  return braces === 0 && dollars % 2 === 0;
}

export function diagnoseDiagram() {
  const issues = [];
  const ids = new Set();

  if (!store.doc.title || !store.doc.title.trim()) {
    issues.push(problem('warning', 'Missing title', 'The diagram title is empty.'));
  }

  if (!(store.doc.canvas.width > 0) || !(store.doc.canvas.height > 0)) {
    issues.push(problem('error', 'Invalid canvas', 'The canvas width and height must be positive.'));
  }

  for (const element of store.doc.elements) {
    if (ids.has(element.id)) {
      issues.push(problem('error', 'Duplicate id', `More than one element uses "${element.id}".`, element.id));
    }
    ids.add(element.id);

    let type;
    try {
      type = getType(element.type);
    } catch (error) {
      issues.push(problem('error', 'Unknown element type', error.message, element.id));
      continue;
    }

    for (const message of validate(type.schema, element)) {
      issues.push(problem('error', 'Schema mismatch', message, element.id));
    }

    const allowed = allowedFields(element.type, { includeId: true });
    allowed.add('type');
    for (const key of Object.keys(element)) {
      if (!allowed.has(key)) {
        issues.push(problem('warning', 'Unsupported field', `${element.id}.${key} is not part of the ${element.type} schema.`, element.id));
      }
    }

    if (
      type.schema.properties?.value
      && typeof element.label === 'string'
      && typeof element.value === 'string'
      && comparableText(element.label)
      && comparableText(element.label) === comparableText(element.value)
    ) {
      issues.push(problem(
        'warning',
        'Duplicate label and value',
        `${element.id} repeats "${element.label}" as both label and value. Keep the label as the component name and leave value empty unless it is a real measurement.`,
        element.id,
      ));
    }

    for (const [key, field] of Object.entries(type.schema.properties || {})) {
      const value = element[key];
      if (field.format === 'elementRef' && value && !store.byId(value)) {
        issues.push(problem('warning', 'Broken reference', `${element.id}.${key} points to missing element "${value}".`, element.id));
      }
      if (field.format === 'expression' && value) {
        const { error } = compile(value, expressionVariables(key));
        if (error) {
          issues.push(problem('error', 'Invalid expression', `${element.id}.${key}: ${error}`, element.id));
        }
      }
      if ((key === 'label' || key === 'text' || key === 'title') && typeof value === 'string' && !balanced(value)) {
        issues.push(problem('warning', 'Suspicious label', `${element.id}.${key} has unbalanced braces or dollar signs.`, element.id));
      }
      // A control character means the caller's own string escaping went
      // wrong: "m\vec{g}" written with one backslash becomes a vertical tab
      // and draws a tofu box, which is easy to miss in a screenshot.
      if (typeof value === 'string' && CONTROL_CHARS.test(value)) {
        issues.push(problem(
          'error',
          'Control character in text',
          `${element.id}.${key} contains a control character. A LaTeX command needs a literal backslash, so check the escaping in the calling code.`,
          element.id,
        ));
      }
    }
  }

  const source = toTikzSource(store.doc, store.view);
  if (/NaN|Infinity|undefined/.test(source)) {
    issues.push(problem('error', 'Bad TikZ output', 'The exported TikZ contains NaN, Infinity, or undefined.'));
  }

  // A document that exports cleanly can still look wrong. Reporting "Ready"
  // on a valid document with junk parked off the sheet tells the caller the
  // drawing is finished when it is not, so the visual audit runs here too.
  issues.push(...visualLayoutIssues().filter((issue) => issue.severity !== 'ok'));

  if (!issues.length) {
    issues.push(problem('ok', 'Ready', 'The diagram passes schema, reference, expression, TikZ export, and visual layout checks.'));
  }

  return issues;
}

function snapshot({ includeSource = false, includeSchemas = false, includeSvg = false } = {}) {
  return {
    title: store.doc.title,
    canvas: structuredClone(store.doc.canvas),
    view: structuredClone(store.view),
    selection: structuredClone(store.selection),
    elements: store.doc.elements.map(elementSummary),
    elementCount: store.doc.elements.length,
    typeCount: allTypes().length,
      types: includeSchemas
        ? allTypes().map(typeSummary)
        : allTypes().map((type) => ({
          name: type.name,
          label: type.label,
          group: type.group,
          tool: 'add_element',
          batchTool: 'apply_operations',
          hint: type.hint || '',
        })),
    diagnostics: diagnoseDiagram(),
    tikz: includeSource ? toTikzSource(store.doc, store.view) : undefined,
    svg: includeSvg ? toSvgSource(store.doc, store.view) : undefined,
  };
}

function allowedFields(typeName, { includeId = false } = {}) {
  const fields = new Set(Object.keys(getType(typeName).schema.properties || {}));
  if (includeId) fields.add('id');
  return fields;
}

function assertKnownFields(typeName, values = {}, { includeId = false, context = 'values' } = {}) {
  const fields = allowedFields(typeName, { includeId });
  const unknown = Object.keys(values).filter((key) => !fields.has(key));
  if (!unknown.length) return;
  throw new Error(
    `${context} for "${typeName}" include unsupported field${unknown.length === 1 ? '' : 's'}: ${
      unknown.join(', ')}. Use get_element_schema to see the allowed fields.`,
  );
}

function assertSemanticElement(typeName, element) {
  const schema = getType(typeName).schema.properties || {};
  if (
    schema.value
    && typeof element.label === 'string'
    && typeof element.value === 'string'
    && comparableText(element.label)
    && comparableText(element.label) === comparableText(element.value)
  ) {
    throw new Error(
      `"${element.id || typeName}" has the same label and value. Use label for the component name and value only for the measured value, or leave value empty.`,
    );
  }
}

function addElement(typeName, values = {}) {
  if (!TYPE_NAMES().includes(typeName)) throw new Error(`Unknown element type "${typeName}".`);
  if (values.id && store.byId(values.id)) throw new Error(`An element with the id "${values.id}" already exists.`);
  assertKnownFields(typeName, values, { includeId: true, context: 'values' });
  assertSemanticElement(typeName, { id: values.id || typeName, ...values });
  return store.addElement(typeName, values);
}

function updateElement(id, changes) {
  const element = store.byId(id);
  if (!element) throw new Error(`No element with the id "${id}".`);
  assertKnownFields(element.type, changes, { context: 'changes' });
  assertSemanticElement(element.type, { ...element, ...changes });
  return store.updateElement(id, changes);
}

function removeElements(ids) {
  const removed = [];
  store.transaction('agent delete', () => {
    for (const id of ids) {
      if (store.byId(id)) removed.push(store.removeElement(id));
    }
  });
  return removed;
}

function clearBrokenReferences() {
  let count = 0;
  store.transaction('agent repair references', () => {
    for (const element of store.doc.elements) {
      const type = getType(element.type);
      for (const [key, field] of Object.entries(type.schema.properties || {})) {
        if (field.format === 'elementRef' && element[key] && !store.byId(element[key])) {
          store.updateElement(element.id, { [key]: '' }, { history: false });
          count += 1;
        }
      }
    }
  });
  return count;
}

function clearDuplicateCircuitValues() {
  let count = 0;
  store.transaction('agent repair duplicate values', () => {
    for (const element of store.doc.elements) {
      const schema = getType(element.type).schema.properties || {};
      if (
        schema.value
        && typeof element.label === 'string'
        && typeof element.value === 'string'
        && comparableText(element.label)
        && comparableText(element.label) === comparableText(element.value)
      ) {
        store.updateElement(element.id, { value: '' }, { history: false });
        count += 1;
      }
    }
  });
  return count;
}

function fixCommonIssues({ clearRepeatedValues = false } = {}) {
  const changes = [];
  if (!store.doc.title || !store.doc.title.trim()) {
    store.setTitle('Untitled diagram');
    changes.push('Set a fallback title.');
  }
  if (!(store.doc.canvas.width > 0) || !(store.doc.canvas.height > 0)) {
    store.setCanvas({
      width: Math.max(1, Number(store.doc.canvas.width) || emptyDocument().canvas.width),
      height: Math.max(1, Number(store.doc.canvas.height) || emptyDocument().canvas.height),
    });
    changes.push('Repaired canvas size.');
  }
  const cleared = clearBrokenReferences();
  if (cleared) changes.push(`Cleared ${cleared} broken reference${cleared === 1 ? '' : 's'}.`);
  if (clearRepeatedValues) {
    const repeated = clearDuplicateCircuitValues();
    if (repeated) changes.push(`Cleared ${repeated} repeated circuit value${repeated === 1 ? '' : 's'}.`);
  }
  if (!store.selection.length && store.doc.elements[0]) {
    store.select([store.doc.elements[0].id]);
    changes.push('Selected the first element.');
  }
  return changes;
}

function runArrangeAction(action) {
  const map = {
    'align-left': () => alignSelection('left'),
    'align-centre-x': () => alignSelection('centreX'),
    'align-right': () => alignSelection('right'),
    'align-top': () => alignSelection('top'),
    'align-centre-y': () => alignSelection('centreY'),
    'align-bottom': () => alignSelection('bottom'),
    'distribute-x': () => distributeSelection('x'),
    'distribute-y': () => distributeSelection('y'),
  };
  if (!map[action]) throw new Error(`Unknown arrange action "${action}".`);
  map[action]();
}

function idsFromOperation(operation) {
  if (Array.isArray(operation.ids)) return operation.ids;
  if (operation.id) return [operation.id];
  return [];
}

function assertCanvasFields(changes = {}) {
  const allowed = new Set(Object.keys(CANVAS_SCHEMA));
  const unknown = Object.keys(changes).filter((key) => !allowed.has(key));
  if (!unknown.length) return;
  throw new Error(`Canvas changes include unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function restoreState(doc, selection, view) {
  store.replaceDocument(doc, { history: false });
  store.select(selection.filter((id) => store.byId(id)));
  Object.assign(store.view, view);
}

function applyOneOperation(operation, { fitToWindow } = {}) {
  if (!operation || typeof operation !== 'object') throw new Error('Every operation must be an object.');
  const { action } = operation;

  if (action === 'add') {
    if (!operation.type) throw new Error('Add operations require a type.');
    const element = addElement(operation.type, operation.values || {});
    return { action, created: [compactElement(element)] };
  }

  if (action === 'update') {
    if (!operation.id) throw new Error('Update operations require an id.');
    const element = updateElement(operation.id, operation.changes || {});
    return { action, updated: [compactElement(element)] };
  }

  if (action === 'remove') {
    const ids = idsFromOperation(operation);
    if (!ids.length) throw new Error('Remove operations require id or ids.');
    const removed = removeElements(ids);
    return { action, removed: removed.map(compactElement) };
  }

  if (action === 'select') {
    const ids = idsFromOperation(operation).filter((id) => store.byId(id));
    store.select(ids);
    return { action, selection: structuredClone(store.selection) };
  }

  if (action === 'set-title') {
    if (typeof operation.title !== 'string') throw new Error('set-title operations require a title string.');
    store.setTitle(operation.title.trim() || 'Untitled diagram');
    return { action, title: store.doc.title };
  }

  if (action === 'set-canvas') {
    const changes = operation.canvas || {};
    assertCanvasFields(changes);
    store.setCanvas(changes);
    return { action, canvas: structuredClone(store.doc.canvas) };
  }

  if (action === 'duplicate-selection') {
    return { action, created: store.duplicate().map(compactElement) };
  }

  if (action === 'arrange-selection') {
    runArrangeAction(operation.arrange);
    return { action, arrange: operation.arrange, selection: structuredClone(store.selection) };
  }

  if (action === 'clear-diagram') {
    const removedCount = store.doc.elements.length;
    store.clear();
    return { action, removedCount };
  }

  if (action === 'fit-view') {
    if (fitToWindow) fitToWindow();
    return { action, view: structuredClone(store.view) };
  }

  if (action === 'replace-diagram') {
    const result = replaceDiagram({
      title: operation.title ?? store.doc.title,
      canvas: operation.canvas || {},
      elements: operation.elements || [],
      selection: operation.selection || [],
    }, { fitToWindow });
    return { action, created: result.created };
  }

  throw new Error(`Unknown operation action "${action}".`);
}

function applyOperations({ operations = [], fitAfter = false } = {}, options = {}) {
  if (!Array.isArray(operations) || !operations.length) {
    throw new Error('apply_operations requires at least one operation.');
  }

  const beforeDoc = structuredClone(store.doc);
  const beforeSelection = structuredClone(store.selection);
  const beforeView = structuredClone(store.view);
  const results = [];

  try {
    store.transaction('agent operations', () => {
      operations.forEach((operation, index) => {
        results.push({ index, ...applyOneOperation(operation, options) });
      });
    });
    if (fitAfter && options.fitToWindow) options.fitToWindow();
  } catch (error) {
    restoreState(beforeDoc, beforeSelection, beforeView);
    throw error;
  }

  return { ok: true, results, diagnostics: diagnoseDiagram(), diagram: snapshot() };
}

async function register(model, tool) {
  const controller = new AbortController();
  controllers.push(controller);
  await model.registerTool(tool, { signal: controller.signal });
}

function publicError(error) {
  return { ok: false, error: error.message || String(error), diagnostics: diagnoseDiagram() };
}

export async function registerWebMcp({ showTikz, fitToWindow } = {}) {
  const model = modelContext();
  if (!model || typeof model.registerTool !== 'function') {
    visibleStatus('WebMCP unavailable');
    return { ok: false, registered: 0 };
  }

  controllers.splice(0).forEach((controller) => controller.abort());

  await register(model, {
    name: 'inspect_diagram',
    title: 'Inspect diagram',
    description: 'Read the current diagram document, selection, element list, available element types, diagnostics, and optionally generated source.',
    inputSchema: {
      type: 'object',
      properties: {
        includeSource: { type: 'boolean', default: false },
        includeSchemas: { type: 'boolean', default: false },
        includeSvg: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ includeSource = false, includeSchemas = false, includeSvg = false } = {}) => snapshot({ includeSource, includeSchemas, includeSvg }),
  });

  await register(model, {
    name: 'list_element_types',
    title: 'List element types',
    description: 'List every element type the editor can create, grouped by domain, with the generic tools used to create it.',
    inputSchema: {
      type: 'object',
      properties: { includeSchemas: { type: 'boolean', default: false } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ includeSchemas = false } = {}) => ({
      count: allTypes().length,
      types: includeSchemas ? allTypes().map(typeSummary) : allTypes().map((type) => ({
        name: type.name,
        label: type.label,
        group: type.group,
        tool: 'add_element',
        batchTool: 'apply_operations',
        hint: type.hint || '',
      })),
    }),
  });

  await register(model, {
    name: 'get_element_schema',
    title: 'Get element schema',
    description: 'Read the guided JSON Schema for one element type before creating or editing it. Use this before setting unfamiliar fields.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: TYPE_NAMES() } },
      required: ['type'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ type }) => ({ type, schema: elementInputSchema(getType(type)), summary: typeSummary(getType(type)) }),
  });

  await register(model, {
    name: 'list_elements',
    title: 'List elements',
    description: 'Return a compact list of objects currently on the canvas. Use this to find ids, labels, values, positions, selection state, and references without loading full schemas or export source.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TYPE_NAMES(), description: 'Only return elements of this type.' },
        group: { type: 'string', enum: GROUP_NAMES(), description: 'Only return elements in this palette group.' },
        query: { type: 'string', maxLength: 80, description: 'Case-insensitive search over id, type, group, label, value, title, and text.' },
        selectedOnly: { type: 'boolean', default: false, description: 'Only return the current selection.' },
        limit: { type: 'number', minimum: 1, maximum: 500, default: 200, description: 'Maximum number of compact element summaries to return.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input = {}) => listElements(input),
  });

  await register(model, {
    name: 'inspect_element',
    title: 'Inspect element',
    description: 'Return full stored fields for specific element ids, optionally with the guided schema. Use list_elements first when you need to discover ids.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'string' }, description: 'Element ids to inspect.' },
        includeSchema: { type: 'boolean', default: false, description: 'Also include each element type schema with field guidance.' },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ ids, includeSchema = false }) => inspectElements(ids, { includeSchema }),
  });

  await register(model, {
    name: 'add_element',
    title: 'Add element',
    description: 'Add one supported element by type. Use get_element_schema first for field meanings. The values object must use only fields from that schema. For circuit parts, label is the component name and value is only the measured value.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TYPE_NAMES() },
        values: { type: 'object', description: 'Element field values matching that type schema. Coordinates are diagram units, not screen pixels. Unknown fields are rejected.' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ type, values = {} }) => {
      try {
        const element = addElement(type, values);
        return { ok: true, element, diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'update_element',
    title: 'Update element',
    description: 'Update one existing element using the same validation as the properties panel. Changes must use only fields from that element type schema. Do not change id or type.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 80 },
        changes: { type: 'object', description: 'Fields to update on the element. Unknown fields are rejected.' },
      },
      required: ['id', 'changes'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ id, changes }) => {
      try {
        const element = updateElement(id, changes);
        return { ok: true, element, diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'select_elements',
    title: 'Select elements',
    description: 'Select one or more element ids in the editor so the canvas, outline, and properties panel focus together.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', minItems: 0, maxItems: 100, items: { type: 'string' } },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ ids }) => {
      store.select(ids.filter((id) => store.byId(id)));
      return { ok: true, selection: structuredClone(store.selection), diagram: snapshot() };
    },
  });

  await register(model, {
    name: 'remove_elements',
    title: 'Remove elements',
    description: 'Remove elements by id and clear references to removed elements.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string' } },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ ids }) => {
      try {
        return { ok: true, removed: removeElements(ids), diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'apply_operations',
    title: 'Apply operations',
    description: 'Apply a batch of generic diagram operations in order as one undoable edit. Use this for complex requests that add, update, remove, select, arrange, or resize several objects together. If any operation fails, the document is restored to its previous state.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          description: 'Ordered operations. Each operation has an action plus the fields needed by that action.',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: OPERATION_ACTIONS,
                description: 'add, update, remove, select, set-title, set-canvas, duplicate-selection, arrange-selection, clear-diagram, replace-diagram, or fit-view.',
              },
              type: { type: 'string', enum: TYPE_NAMES(), description: 'Element type for add operations.' },
              id: { type: 'string', minLength: 1, maxLength: 80, description: 'Target id for update/remove/select, or an optional single id.' },
              ids: {
                type: 'array',
                minItems: 0,
                maxItems: 100,
                items: { type: 'string' },
                description: 'Target ids for remove or select operations.',
              },
              values: {
                type: 'object',
                description: 'Fields for a new element. Must match get_element_schema for the chosen type. Use label for names and value only for measured values.',
              },
              changes: {
                type: 'object',
                description: 'Fields to change on an existing element. Unknown fields, id, and type are rejected.',
              },
              title: { type: 'string', minLength: 0, maxLength: 140, description: 'New diagram title for set-title.' },
              canvas: {
                type: 'object',
                properties: CANVAS_SCHEMA,
                additionalProperties: false,
                description: 'Canvas changes for set-canvas.',
              },
              arrange: {
                type: 'string',
                enum: ARRANGE_ACTIONS,
                description: 'Arrange command for arrange-selection.',
              },
              elements: {
                type: 'array',
                maxItems: 200,
                items: { type: 'object', properties: { type: { type: 'string', enum: TYPE_NAMES() } }, required: ['type'] },
                description: 'The complete element list for replace-diagram. Each item is a type plus its field values.',
              },
              selection: {
                type: 'array',
                maxItems: 100,
                items: { type: 'string' },
                description: 'Ids to select after replace-diagram.',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
        },
        fitAfter: { type: 'boolean', default: false, description: 'Fit the sheet in the visible canvas after all operations succeed.' },
      },
      required: ['operations'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      try {
        return applyOperations(input, { fitToWindow });
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'duplicate_selection',
    title: 'Duplicate selection',
    description: 'Duplicate the selected elements using the editor store, including reference remapping inside the copied set.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async () => ({ ok: true, created: store.duplicate(), diagram: snapshot() }),
  });

  await register(model, {
    name: 'arrange_selection',
    title: 'Arrange selection',
    description: 'Align or distribute the current selection using the same bounds-aware arrange commands as the properties panel.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['align-left', 'align-centre-x', 'align-right', 'align-top', 'align-centre-y', 'align-bottom', 'distribute-x', 'distribute-y'],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ action }) => {
      runArrangeAction(action);
      return { ok: true, action, diagram: snapshot() };
    },
  });

  await register(model, {
    name: 'set_title',
    title: 'Set diagram title',
    description: 'Set the diagram title used by the toolbar and exports.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', minLength: 1, maxLength: 140 } },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ title }) => {
      store.setTitle(title.trim() || 'Untitled diagram');
      return { ok: true, title: store.doc.title, diagram: snapshot() };
    },
  });

  await register(model, {
    name: 'set_canvas',
    title: 'Set canvas',
    description: 'Update canvas width, height, grid size, grid visibility, or snap setting.',
    inputSchema: {
      type: 'object',
      properties: CANVAS_SCHEMA,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (changes) => {
      try {
        assertCanvasFields(changes);
        store.setCanvas(changes);
        return { ok: true, canvas: structuredClone(store.doc.canvas), diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'clear_diagram',
    title: 'Clear diagram',
    description: 'Remove every element from the current diagram and keep the empty sheet. This is destructive but undoable.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async () => {
      const removedCount = store.doc.elements.length;
      store.clear();
      return { ok: true, removedCount, diagram: snapshot() };
    },
  });

  await register(model, {
    name: 'fit_view',
    title: 'Fit view',
    description: 'Fit the diagram sheet in the visible canvas, like the toolbar Fit button.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async () => {
      if (fitToWindow) fitToWindow();
      return { ok: true, view: structuredClone(store.view), diagram: snapshot() };
    },
  });

  await register(model, {
    name: 'diagnose_diagram',
    title: 'Diagnose diagram',
    description: 'Run schema, reference, expression, label, canvas, and TikZ export checks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => ({ diagnostics: diagnoseDiagram(), diagram: snapshot() }),
  });

  await register(model, {
    name: 'fix_common_issues',
    title: 'Fix common issues',
    description: 'Repair safe common issues: fallback title, positive canvas size, broken references, and empty selection. Optionally clear circuit values that merely repeat their labels.',
    inputSchema: {
      type: 'object',
      properties: {
        clearRepeatedValues: {
          type: 'boolean',
          default: false,
          description: 'When true, clear circuit value fields that exactly repeat the component label.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => ({ ok: true, changes: fixCommonIssues(input), diagnostics: diagnoseDiagram(), diagram: snapshot() }),
  });

  await register(model, {
    name: 'export_tikz',
    title: 'Export TikZ',
    description: 'Return TikZ source for the current document, plus diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        showDialog: { type: 'boolean', default: false, description: 'Also open the in-app TikZ dialog.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async ({ showDialog = false } = {}) => {
      const source = toTikzSource(store.doc, store.view);
      if (showDialog && showTikz) showTikz(source);
      return { ok: true, source, diagnostics: diagnoseDiagram() };
    },
  });

  await register(model, {
    name: 'export_svg',
    title: 'Export SVG',
    description: 'Return SVG source for the current document, plus diagnostics.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async () => ({ ok: true, source: toSvgSource(store.doc, store.view), diagnostics: diagnoseDiagram() }),
  });

  await register(model, {
    name: 'get_visual_bounds',
    title: 'Get visual bounds',
    description: 'Return the real rendered bounding box of each element in diagram units, measured from the live SVG where possible. Use this before placing anything, so positions are read rather than guessed.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', maxItems: 200, items: { type: 'string' }, description: 'Element ids. Omit for every element.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ ids = [] } = {}) => {
      const source = ids.length ? ids : store.doc.elements.map((element) => element.id);
      const elements = [];
      const missing = [];
      for (const id of source) {
        const element = store.byId(id);
        if (!element) {
          missing.push(id);
          continue;
        }
        elements.push({ id, type: element.type, display: displayText(element), bounds: visualBoundsOf(id) });
      }
      return { ok: true, count: elements.length, missing, canvas: structuredClone(store.doc.canvas), elements };
    },
  });

  await register(model, {
    name: 'get_anchor_points',
    title: 'Get anchor points',
    description: 'Return named attachment points for each element, such as center, top, bottom, left, right, start, end, surface contact and rope tangents, plus the along and normal direction vectors. Attach arrows and ropes to these instead of inventing coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', maxItems: 200, items: { type: 'string' }, description: 'Element ids. Omit for every element.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async ({ ids = [] } = {}) => ({ ok: true, anchorNames: ANCHOR_NAMES, ...anchorsFor(ids) }),
  });

  await register(model, {
    name: 'add_vector',
    title: 'Add vector',
    description: 'Draw an arrow from an element anchor in a named direction, for example along-element, normal-element, down, or towards-element. Give a length and a label. The endpoints are computed from real geometry, so the arrow stays attached to what it belongs to.',
    inputSchema: {
      type: 'object',
      properties: {
        fromElementId: { type: 'string', description: 'Element the vector starts on. Omit only when giving x and y.' },
        fromAnchor: { type: 'string', enum: ANCHOR_NAMES, default: 'center', description: 'Named anchor on that element.' },
        x: { type: 'number', description: 'Explicit start x, used instead of an anchor.' },
        y: { type: 'number', description: 'Explicit start y, used instead of an anchor.' },
        direction: { type: 'string', enum: VECTOR_DIRECTIONS, default: 'angle', description: 'How the direction is derived.' },
        angle: { type: 'number', description: 'Degrees, used when direction is angle. 0 is right, 90 is up. This is a heading on the page, not a slope in plot data.' },
        atX: { type: 'number', description: 'A data x on a curve. Use it with a curve as fromElementId to start on the curve, and with a tangent-curve direction to follow it. The plot axes rarely have equal scales, so a data slope is not a page angle.' },
        referenceElementId: { type: 'string', description: 'Element whose along/normal axes define the direction.' },
        toElementId: { type: 'string', description: 'Target element for towards-element and away-from-element.' },
        toAnchor: { type: 'string', enum: ANCHOR_NAMES, default: 'center', description: 'Anchor on the target element.' },
        length: { type: 'number', minimum: 0.05, default: 1.5, description: 'Arrow length in diagram units.' },
        offset: { type: 'number', default: 0, description: 'Shift the whole arrow sideways, perpendicular to its direction, in diagram units. Use this when the shaft would run through the object and put its label on top of another label.' },
        gap: { type: 'number', default: 0, description: 'Shift the tail along the direction, in diagram units. Positive values start the arrow away from the anchor.' },
        label: { type: 'string', description: 'LaTeX-lite label, for example T, m_2g, or f_k.' },
        labelSide: { type: 'string', enum: ['left', 'right'], default: 'left', description: 'Which side of the shaft the label sits on.' },
        labelSize: { type: 'number', description: 'Label size in pixels.' },
        color: { type: 'string', description: 'Stroke colour.' },
        strokeWidth: { type: 'number', description: 'Line width.' },
        style: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Line style.' },
        head: { type: 'string', enum: ['end', 'start', 'both', 'none'], default: 'end', description: 'Which ends carry an arrowhead.' },
        id: { type: 'string', description: 'Optional explicit id.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...addVector(input), diagnostics: diagnoseDiagram() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'add_connector',
    title: 'Add connector',
    description: 'Draw a rope, wire or link between two element anchors. Route direct or orthogonal, with optional waypoints. Use this for a cord over a pulley or a link between blocks, instead of a hand-placed polyline.',
    inputSchema: {
      type: 'object',
      properties: {
        fromElementId: { type: 'string', description: 'Element the connector starts on.' },
        fromAnchor: { type: 'string', enum: ANCHOR_NAMES, default: 'center', description: 'Anchor on the start element.' },
        toElementId: { type: 'string', description: 'Element the connector ends on.' },
        toAnchor: { type: 'string', enum: ANCHOR_NAMES, default: 'center', description: 'Anchor on the end element.' },
        x1: { type: 'number', description: 'Explicit start x, used instead of a start anchor.' },
        y1: { type: 'number', description: 'Explicit start y.' },
        x2: { type: 'number', description: 'Explicit end x, used instead of an end anchor.' },
        y2: { type: 'number', description: 'Explicit end y.' },
        via: {
          type: 'array',
          maxItems: 20,
          items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false },
          description: 'Waypoints between the two ends, for example the two tangent points on a pulley.',
        },
        route: { type: 'string', enum: CONNECTOR_ROUTES, default: 'direct', description: 'direct is a straight run. orthogonal turns one right angle.' },
        head: { type: 'string', enum: ['end', 'start', 'both', 'none'], default: 'none', description: 'Which ends carry an arrowhead.' },
        label: { type: 'string', description: 'Optional label on the connector.' },
        labelSize: { type: 'number', description: 'Label size in pixels.' },
        color: { type: 'string', description: 'Stroke colour.' },
        strokeWidth: { type: 'number', description: 'Line width.' },
        style: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Line style.' },
        id: { type: 'string', description: 'Optional explicit id.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...addConnector(input), diagnostics: diagnoseDiagram() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'check_visual_layout',
    title: 'Check visual layout',
    description: 'Audit how the diagram looks: elements off the sheet, elements clipped by the boundary, and text overlapping other objects. Schema validity alone does not mean the drawing reads well.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const issues = visualLayoutIssues();
      return {
        ok: true,
        clean: issues.every((issue) => issue.severity === 'ok'),
        issues,
        canvas: structuredClone(store.doc.canvas),
      };
    },
  });

  await register(model, {
    name: 'replace_diagram',
    title: 'Replace diagram',
    description: 'Replace the whole drawing in one undoable transaction: title, canvas and the complete element list. Use this instead of editing or hiding leftovers, because nothing from the old diagram survives.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 140, description: 'Diagram title.' },
        canvas: { type: 'object', properties: CANVAS_SCHEMA, additionalProperties: false, description: 'Canvas settings. Omitted fields take the defaults.' },
        elements: {
          type: 'array',
          maxItems: 200,
          items: { type: 'object', properties: { type: { type: 'string', enum: TYPE_NAMES() } }, required: ['type'] },
          description: 'The complete new element list. Each item is a type plus its field values, matching get_element_schema.',
        },
        selection: { type: 'array', maxItems: 100, items: { type: 'string' }, description: 'Ids to select afterwards.' },
        fitAfter: { type: 'boolean', default: false, description: 'Fit the sheet in the visible canvas when done.' },
      },
      required: ['elements'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return replaceDiagram(input, { fitToWindow });
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'auto_place_labels',
    title: 'Auto place labels',
    description: 'Tidy the text. Standalone labels move the shortest distance that clears everything; an attached label is slid along its shaft or moved off the centre of its shape, whichever the type allows. Run this after the geometry is settled. Anything reported under unresolved needs the objects themselves moved apart.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', maxItems: 100, items: { type: 'string' }, description: 'Label ids to place. Omit for every label.' },
        padding: { type: 'number', minimum: 0, default: 0.15, description: 'Clear space to keep around each label, in diagram units.' },
        maxShift: { type: 'number', minimum: 0.1, default: 1, description: 'Furthest a standalone label may move, in diagram units. Keep it small: a vertex label carried two units away no longer names the point it belongs to.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...(await autoPlaceLabels(input)), diagnostics: diagnoseDiagram(), diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'fit_canvas_to_content',
    title: 'Fit canvas to content',
    description: 'Shrink or grow the sheet so it wraps the drawing with an even margin, and move the drawing to sit inside it. Run this last, so the exported figure has no band of blank paper down one side.',
    inputSchema: {
      type: 'object',
      properties: {
        padding: { type: 'number', minimum: 0, default: 0.8, description: 'Margin to leave on every side, in diagram units.' },
        minSize: { type: 'number', minimum: 0.5, default: 2, description: 'Smallest sheet the fit will produce, in diagram units.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...(await fitCanvasToContent(input)), diagnostics: diagnoseDiagram(), diagram: snapshot() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'place_on_element',
    title: 'Place on element',
    description: 'Seat one element on another: a block on an incline, a mass on a table, a component along a wire. Give a distance along the host and the element lands touching it, rotated to match. Use this instead of computing x and y with a sine and a cosine.',
    inputSchema: {
      type: 'object',
      properties: {
        elementId: { type: 'string', minLength: 1, description: 'The element to move.' },
        hostId: { type: 'string', minLength: 1, description: 'The surface, line or body to place it on.' },
        distance: { type: 'number', description: 'How far along the host, from its start, in diagram units.' },
        fraction: { type: 'number', minimum: 0, maximum: 1, default: 0.5, description: 'Position along the host as a fraction of its length. Used when distance is omitted.' },
        standoff: { type: 'number', description: 'Gap from the host along its normal. Omit and half the element height is used, which makes it rest on the surface.' },
        side: { type: 'string', enum: ['above', 'below'], default: 'above', description: 'Which side of the host to sit on.' },
        align: { type: 'boolean', description: 'Rotate the element to match the host angle. Defaults to true for any type that has an angle.' },
      },
      required: ['elementId', 'hostId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...(await placeOnElement(input)), diagnostics: diagnoseDiagram() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'add_two_terminal',
    title: 'Add a two-terminal part',
    description: 'Add a resistor, capacitor, inductor, source, switch, diode, lamp or meter spanning exactly two points. The centre, length and angle are computed, so the part always reaches both ends. Prefer this over add_element for any circuit part that joins two nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'The circuit part type.' },
        from: {
          type: 'object',
          properties: {
            elementId: { type: 'string', description: 'Take the point from this element.' },
            anchor: { type: 'string', enum: ANCHOR_NAMES, description: 'Which anchor on it.' },
            x: { type: 'number' }, y: { type: 'number' },
          },
          additionalProperties: false,
          description: 'One end: an element anchor, or explicit x and y.',
        },
        to: {
          type: 'object',
          properties: {
            elementId: { type: 'string', description: 'Take the point from this element.' },
            anchor: { type: 'string', enum: ANCHOR_NAMES, description: 'Which anchor on it.' },
            x: { type: 'number' }, y: { type: 'number' },
          },
          additionalProperties: false,
          description: 'The other end.',
        },
        values: { type: 'object', description: 'Everything else about the part: label, value, labelSide, colour. Do not pass x, y, length or angle; they are computed.' },
        id: { type: 'string', description: 'Optional explicit id.' },
      },
      required: ['type', 'from', 'to'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...(await addTwoTerminal(input)), diagnostics: diagnoseDiagram() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  await register(model, {
    name: 'check_connections',
    title: 'Check connections',
    description: 'Report circuit terminals that nearly touch another terminal without joining it. A terminal with nothing close is treated as a deliberate open end and is not reported.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const model = circuitPoints();
      const dangling = danglingTerminals();
      return {
        ok: true,
        connected: dangling.length === 0,
        ends: model.ends.length,
        targets: model.targets.length,
        joinTolerance: JOIN_TOLERANCE,
        nearMiss: NEAR_MISS,
        dangling,
      };
    },
  });

  await register(model, {
    name: 'place_in_axes',
    title: 'Place in a plot',
    description: 'Position and size any element in a plot\'s data coordinates. Only plot types carry an axesId, so anything else annotating a graph would otherwise need converting by hand, once per axis, because the two axes rarely share a scale.',
    inputSchema: {
      type: 'object',
      properties: {
        axesId: { type: 'string', minLength: 1, description: 'The axes whose data coordinates to use.' },
        elementId: { type: 'string', description: 'The element to place. Use elements for several at once.' },
        dataX: { type: 'number', description: 'Where its anchor goes, in data x.' },
        dataY: { type: 'number', description: 'Where its anchor goes, in data y.' },
        dataWidth: { type: 'number', description: 'Width in data units, converted through the x axis.' },
        dataHeight: { type: 'number', description: 'Height in data units, converted through the y axis.' },
        elements: {
          type: 'array',
          maxItems: 400,
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'string', minLength: 1 },
              dataX: { type: 'number' }, dataY: { type: 'number' },
              dataWidth: { type: 'number' }, dataHeight: { type: 'number' },
            },
            required: ['elementId'],
            additionalProperties: false,
          },
          description: 'Several placements in one undoable edit, for a series of bars or markers.',
        },
      },
      required: ['axesId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}) => {
      try {
        return { ok: true, ...(await placeInAxes(input)), diagnostics: diagnoseDiagram() };
      } catch (error) {
        return publicError(error);
      }
    },
  });

  visibleStatus(`${controllers.length} WebMCP tools ready`, true);
  return { ok: true, registered: controllers.length };
}
