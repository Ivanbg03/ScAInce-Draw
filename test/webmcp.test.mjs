/**
 * WebMCP contract checks.
 *
 * These run without a browser by providing a tiny fake modelContext. Browser
 * coverage still lives in browser.test.mjs; this file checks that the bridge
 * registers useful tools and routes them through the same store/export path.
 */

const registered = [];

globalThis.document = {
  modelContext: {
    async registerTool(tool) {
      registered.push(tool);
    },
  },
  getElementById() {
    return null;
  },
};

await import('../src/types/common.js');
await import('../src/types/annotation.js');
await import('../src/types/mechanics.js');
await import('../src/types/mechanics-parts.js');
await import('../src/types/plots.js');
await import('../src/types/plots-extra.js');
await import('../src/types/schematic.js');
await import('../src/types/optics.js');
await import('../src/types/optics-parts.js');
await import('../src/types/fields.js');
await import('../src/types/geometry.js');
await import('../src/types/circuit.js');

const { emptyDocument, store } = await import('../src/store.js');
const { allTypes } = await import('../src/registry.js');
const { diagnoseDiagram, registerWebMcp } = await import('../src/webmcp.js');

let failures = 0;
let checks = 0;

function check(label, condition, extra = '') {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  FAIL ${label}${extra ? ` - ${extra}` : ''}`);
}

console.log('\nWebMCP');

store.replaceDocument(emptyDocument(), { history: false });
const result = await registerWebMcp({});
const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]));

check('registers successfully', result.ok === true);
check('schema discovery covers every type',
  (await byName.list_element_types.execute({})).count === allTypes().length);
check('registers the full tool surface',
  registered.length === 32,
  `got ${registered.length}`);

// The geometry primitives must be reachable, not merely defined. Five of them
// shipped as dead code, so this asserts the wiring rather than the source.
for (const name of [
  'get_visual_bounds', 'get_anchor_points', 'add_vector', 'add_connector',
  'check_visual_layout', 'replace_diagram', 'auto_place_labels', 'fit_canvas_to_content', 'place_on_element', 'add_two_terminal', 'check_connections', 'place_in_axes',
]) {
  check(`${name} is registered`, typeof byName[name]?.execute === 'function');
}

const schema = await byName.get_element_schema.execute({ type: 'curve' });

const batch = await byName.apply_operations.execute({
  operations: [
    {
      action: 'add',
      type: 'axes',
      values: {
        id: 'test-axes',
        x: 2,
        y: 2,
        width: 8,
        height: 6,
        xMin: -2,
        xMax: 2,
        yMin: -2,
        yMax: 8,
        showGrid: true,
        xLabel: 'x',
        yLabel: 'y',
      },
    },
    {
      action: 'add',
      type: 'curve',
      values: {
        id: 'test-curve',
        axesId: 'test-axes',
        expression: 'x^3',
        from: -2,
        to: 2,
        label: 'x^3',
      },
    },
    {
      action: 'add',
      type: 'text-box',
      values: {
        id: 'agent-note',
        x: 10,
        y: 10,
        text: 'Created by WebMCP',
      },
    },
    { action: 'select', ids: ['test-curve'] },
  ],
});

const listed = await byName.list_elements.execute({ type: 'curve' });
const inspected = await byName.inspect_element.execute({ ids: ['test-curve'], includeSchema: true });
const snapshot = await byName.inspect_diagram.execute({ includeSource: true });
const diagnosis = await byName.diagnose_diagram.execute({});
const exportResult = await byName.export_tikz.execute({});
const duplicateValue = await byName.add_element.execute({
  type: 'resistor',
  values: { id: 'bad-resistor', x: 1, y: 1, length: 2, label: 'R_1', value: 'R_1' },
});

check('get_element_schema returns the curve contract',
  schema.schema.properties.expression.format === 'expression');
check('apply_operations creates a typed plot and note',
  batch.ok && store.byId('test-axes') && store.byId('test-curve') && store.byId('agent-note'));
check('list_elements returns compact existing elements',
  listed.count === 1 && listed.elements[0].id === 'test-curve' && !Object.hasOwn(listed.elements[0], 'element'));
check('inspect_element returns full data and guided schema',
  inspected.elements[0].element.expression === 'x^3' && inspected.elements[0].schema.properties.expression.description.includes('Math expression'));
check('inspect returns source when requested',
  snapshot.tikz.includes('tikzpicture') && snapshot.elements.length === 3);
check('diagnostics pass on a valid tool-created diagram',
  diagnosis.diagnostics[0].severity === 'ok',
  JSON.stringify(diagnosis.diagnostics));
check('export includes the cubic curve element',
  exportResult.source.includes('% test-curve (curve)') && exportResult.source.includes('plot coordinates'));
check('add_element prevents duplicate circuit label/value',
  duplicateValue.ok === false && duplicateValue.error.includes('same label and value'),
  JSON.stringify(duplicateValue));

store.updateElement('test-curve', { expression: 'constructor' });
const bad = diagnoseDiagram();
check('diagnostics catch unsafe expressions',
  bad.some((item) => item.title === 'Invalid expression'),
  JSON.stringify(bad));

/* ------------------------------------------------------------------ *
 * The geometry primitives. Each case is one complaint from the review:
 * arrows that float, junk hidden off the sheet, and diagnostics that call
 * a broken layout "Ready".
 * ------------------------------------------------------------------ */

// An Atwood machine: a block on a table, a pulley, a hanging block.
const rebuilt = await byName.replace_diagram.execute({
  title: 'Atwood machine',
  canvas: { width: 24, height: 16 },
  elements: [
    { type: 'surface', id: 'table', x: 3, y: 10, length: 9, angle: 0, side: 'below' },
    { type: 'body', id: 'm1', x: 7, y: 10.7, width: 2.2, height: 1.4, label: 'm_1' },
    { type: 'pulley', id: 'wheel', x: 12.6, y: 10.4, radius: 0.6 },
    { type: 'body', id: 'm2', x: 13.2, y: 6.5, width: 1.6, height: 1.6, label: 'm_2' },
  ],
});
check('replace_diagram builds the whole document in one call',
  rebuilt.ok === true && store.doc.elements.length === 4, JSON.stringify(rebuilt.error || ''));
check('replace_diagram sets the title', store.doc.title === 'Atwood machine');

// The action was advertised in the apply_operations enum but had no handler.
const viaBatch = await byName.apply_operations.execute({
  operations: [{
    action: 'replace-diagram',
    title: 'Atwood machine',
    elements: [
      { type: 'surface', id: 'table', x: 3, y: 10, length: 9, angle: 0, side: 'below' },
      { type: 'body', id: 'm1', x: 7, y: 10.7, width: 2.2, height: 1.4, label: 'm_1' },
      { type: 'pulley', id: 'wheel', x: 12.6, y: 10.4, radius: 0.6 },
      { type: 'body', id: 'm2', x: 13.2, y: 6.5, width: 1.6, height: 1.6, label: 'm_2' },
    ],
  }],
});
check('the replace-diagram batch action has a handler',
  viaBatch.ok === true, JSON.stringify(viaBatch.error || ''));

// Anchors, so an arrow is attached rather than invented.
const anchors = await byName.get_anchor_points.execute({ ids: ['wheel', 'm1'] });
const wheel = anchors.elements.find((entry) => entry.id === 'wheel');
const m1 = anchors.elements.find((entry) => entry.id === 'm1');
check('a pulley exposes rope tangent anchors',
  ['rope-left', 'rope-right'].every((name) => wheel.anchors.some((a) => a.name === name)),
  wheel.anchors.map((a) => a.name).join(','));
check('a body exposes edge and corner anchors',
  ['top', 'bottom', 'left', 'right', 'top-left'].every((name) => m1.anchors.some((a) => a.name === name)),
  m1.anchors.map((a) => a.name).join(','));
check('a body reports along and normal directions',
  Number.isFinite(m1.directions.along.x) && Number.isFinite(m1.directions.normal.y));

// Real bounds, not guesses.
const bounds = await byName.get_visual_bounds.execute({ ids: ['m1'] });
const box = bounds.elements[0].bounds;
check('bounds bracket the body they describe',
  box.minX < 7 && box.maxX > 7 && box.minY < 10.7 && box.maxY > 10.7,
  JSON.stringify(box));

// A weight drawn from the body centre, straight down, at the right length.
const weight = await byName.add_vector.execute({
  fromElementId: 'm2', fromAnchor: 'center', direction: 'down', length: 2.2, label: 'm_2g', id: 'w2',
});
check('add_vector starts on the anchor it was given',
  weight.ok && Math.abs(weight.start.x - 13.2) < 0.01 && Math.abs(weight.start.y - 6.5) < 0.01,
  JSON.stringify(weight.error || weight.start));
check('add_vector points where it was told',
  Math.abs(weight.end.x - 13.2) < 0.01 && Math.abs(weight.end.y - 4.3) < 0.01,
  JSON.stringify(weight.end));

// Normal force: perpendicular to the surface the block rests on.
const normal = await byName.add_vector.execute({
  fromElementId: 'm1', fromAnchor: 'bottom', direction: 'normal-element',
  referenceElementId: 'table', length: 1.8, label: 'N', id: 'n1',
});
check('add_vector can take its direction from another element',
  normal.ok && Math.abs(normal.direction.x) < 0.01 && normal.direction.y > 0.99,
  JSON.stringify(normal.error || normal.direction));

// The cord: block to tangent, over the wheel, down to the hanging mass.
const cord = await byName.add_connector.execute({
  fromElementId: 'm1', fromAnchor: 'right',
  toElementId: 'm2', toAnchor: 'top',
  via: [{ x: 12.6, y: 11 }, { x: 13.2, y: 10.4 }],
  id: 'cord',
});
check('add_connector runs anchor to anchor through its waypoints',
  cord.ok && cord.points.length === 4, JSON.stringify(cord.error || cord.points));

// The complaint: leftovers parked off the sheet, reported as Ready.
await byName.add_element.execute({ type: 'label', values: { id: 'junk', x: 40, y: 40, text: 'leftover' } });
const audit = await byName.check_visual_layout.execute({});
check('check_visual_layout catches an element parked off the sheet',
  audit.issues.some((issue) => issue.title === 'Off-canvas element' && issue.elementId === 'junk'),
  JSON.stringify(audit.issues));
check('check_visual_layout reports the sheet as unclean', audit.clean === false);
check('diagnose_diagram no longer calls a broken layout Ready',
  diagnoseDiagram().every((issue) => issue.title !== 'Ready'),
  JSON.stringify(diagnoseDiagram().map((i) => i.title)));

await byName.remove_elements.execute({ ids: ['junk'] });
check('diagnostics recover once the leftover is deleted',
  diagnoseDiagram().some((issue) => issue.title === 'Ready'),
  JSON.stringify(diagnoseDiagram().map((i) => i.title)));

// offset shifts the whole arrow sideways, which is the only way to clear a
// label whose shaft runs through the body it belongs to.
const shifted = await byName.add_vector.execute({
  fromElementId: 'm1', fromAnchor: 'bottom', direction: 'up',
  length: 1.5, offset: 0.9, label: 'N-shifted', id: 'n-off',
});
check('add_vector offset moves the shaft perpendicular to its direction',
  shifted.ok && Math.abs(shifted.start.x - (7 - 0.9)) < 0.01 && Math.abs(shifted.start.y - 10) < 0.01,
  JSON.stringify(shifted.error || shifted.start));
check('add_vector offset keeps the length and the direction',
  Math.abs(shifted.end.y - shifted.start.y - 1.5) < 0.01 && Math.abs(shifted.end.x - shifted.start.x) < 0.01);
check('add_vector reports the anchor it was asked for, not just the shifted tail',
  Math.abs(shifted.anchor.x - 7) < 0.01);

const gapped = await byName.add_vector.execute({
  fromElementId: 'm1', fromAnchor: 'center', direction: 'right',
  length: 1, gap: 2, label: 'g', id: 'n-gap',
});
check('add_vector gap starts the arrow away from the anchor',
  gapped.ok && Math.abs(gapped.start.x - 9) < 0.01, JSON.stringify(gapped.error || gapped.start));

await byName.remove_elements.execute({ ids: ['n-off', 'n-gap'] });

// Overlapping text moves the shortest distance that clears it.
await byName.add_element.execute({ type: 'label', values: { id: 'stacked', x: 7, y: 10.7, text: 'on top of m1' } });
const placed = await byName.auto_place_labels.execute({ ids: ['stacked'] });
const after = store.byId('stacked');
check('auto_place_labels moves a label off the object it covers',
  placed.ok && placed.moved.some((entry) => entry.id === 'stacked'),
  JSON.stringify(placed.stuck || placed.error));
check('auto_place_labels keeps the label on the sheet',
  after.x >= 0 && after.x <= 24 && after.y >= 0 && after.y <= 16,
  JSON.stringify({ x: after.x, y: after.y }));
check('auto_place_labels leaves settled labels alone',
  (await byName.auto_place_labels.execute({ ids: ['stacked'] })).moved.length === 0);
check('auto_place_labels always reports its flip and unresolved lists',
  Array.isArray(placed.flipped) && Array.isArray(placed.unresolved));

/* ------------------------------------------------------------------ *
 * Seating. A block buried halfway into an incline passed every check,
 * because add_element takes raw x and y and nothing measured the result.
 * ------------------------------------------------------------------ */

await byName.replace_diagram.execute({
  title: 'Block on an incline',
  canvas: { width: 16, height: 11 },
  elements: [
    { type: 'surface', id: 'slope', x: 1.5, y: 1.6, length: 9.5, angle: 28, side: 'below' },
    // Deliberately wrong: the hand-computed centre that sank the block.
    { type: 'body', id: 'blk', x: 5.6, y: 3.86, width: 2.3, height: 1.4, angle: 28 },
  ],
});

const buried = await byName.check_visual_layout.execute({});
check('the audit catches a solid buried in a surface',
  buried.issues.some((i) => i.title === 'Solid crosses a surface' && i.elementId === 'blk'),
  JSON.stringify(buried.issues.map((i) => i.title)));
check('a buried solid makes the sheet unclean', buried.clean === false);

const seated = await byName.place_on_element.execute({
  elementId: 'blk', hostId: 'slope', distance: 4.6,
});
check('place_on_element reports where it put the element',
  seated.ok && Number.isFinite(seated.placed.x) && Number.isFinite(seated.placed.y),
  JSON.stringify(seated.error || seated.placed));

// Resting on the surface means the near corners touch it and the far corners
// sit exactly one height away. Anything else is floating or buried.
check('the near corners touch the surface',
  Math.abs(seated.contact.nearest) < 1e-6, String(seated.contact.nearest));
check('the far corners sit one height above',
  Math.abs(seated.contact.furthest - 1.4) < 1e-6, String(seated.contact.furthest));
check('place_on_element matches the host angle',
  seated.placed.angle === 28, String(seated.placed.angle));
check('the placement is the value the trigonometry gives',
  Math.abs(seated.placed.x - 5.234) < 0.002 && Math.abs(seated.placed.y - 4.376) < 0.002,
  JSON.stringify(seated.placed));

const afterSeat = await byName.check_visual_layout.execute({});
check('the audit clears once the block is seated', afterSeat.clean === true,
  JSON.stringify(afterSeat.issues.map((i) => i.title)));

// A standoff of zero puts the centre on the line, so the solid straddles it.
await byName.place_on_element.execute({
  elementId: 'blk', hostId: 'slope', distance: 4.6, standoff: 0,
});
check('a zero standoff is reported as buried again',
  (await byName.check_visual_layout.execute({})).clean === false);
await byName.place_on_element.execute({ elementId: 'blk', hostId: 'slope', distance: 4.6 });

check('place_on_element rejects an unknown host',
  (await byName.place_on_element.execute({ elementId: 'blk', hostId: 'nope' })).ok === false);
check('place_on_element refuses to place an element on itself',
  (await byName.place_on_element.execute({ elementId: 'blk', hostId: 'blk' })).ok === false);

// A control character means the caller's own escaping went wrong.
await byName.add_element.execute({
  type: 'label',
  values: { id: 'tofu', x: 8, y: 9, text: 'm\u000bec{g}' },
});
const escaped = diagnoseDiagram();
check('a control character in a label is reported',
  escaped.some((i) => i.title === 'Control character in text' && i.elementId === 'tofu'),
  JSON.stringify(escaped.map((i) => i.title)));
check('a control character is an error, not a warning',
  escaped.find((i) => i.title === 'Control character in text').severity === 'error');
await byName.remove_elements.execute({ ids: ['tofu'] });
check('the diagram is clean once the bad label is gone',
  diagnoseDiagram().some((i) => i.title === 'Ready'),
  JSON.stringify(diagnoseDiagram().map((i) => i.title)));

/* ------------------------------------------------------------------ *
 * A body's own label, when every force leaves the centre of mass.
 * ------------------------------------------------------------------ */

await byName.replace_diagram.execute({
  title: 'Centre of mass crowding',
  canvas: { width: 14, height: 10 },
  elements: [
    { type: 'body', id: 'mass', x: 7, y: 5, width: 3, height: 2, label: 'm' },
    // Three arrows radiating from the centre, exactly as a free-body diagram
    // draws them. No two labels overlap; the shafts cross the letter m.
    { type: 'arrow', id: 'up', x1: 7, y1: 5, x2: 7, y2: 8, label: 'N' },
    { type: 'arrow', id: 'down', x1: 7, y1: 5, x2: 7, y2: 2, label: 'W' },
    { type: 'arrow', id: 'side', x1: 7, y1: 5, x2: 11, y2: 5, label: 'F' },
  ],
});

check('a body offers labelPlace',
  Array.isArray((await byName.get_element_schema.execute({ type: 'body' }))
    .schema.properties.labelPlace.enum));

const crowded = await byName.auto_place_labels.execute({ ids: ['mass'] });
check('the placer moves a label that arrows run through',
  crowded.ok && crowded.flipped.some((entry) => entry.id === 'mass' && entry.field === 'labelPlace'),
  JSON.stringify({ flipped: crowded.flipped, unresolved: crowded.unresolved }));
check('the label is no longer at the centre',
  store.byId('mass').labelPlace !== 'center', String(store.byId('mass').labelPlace));
check('the placer reports nothing unresolved for it',
  !crowded.unresolved.some((entry) => entry.id === 'mass'),
  JSON.stringify(crowded.unresolved));

// Running it again must be a no-op, not a wander.
const settled = await byName.auto_place_labels.execute({ ids: ['mass'] });
check('a settled label is left alone', settled.flipped.length === 0,
  JSON.stringify(settled.flipped));

/* ------------------------------------------------------------------ *
 * Circuit connectivity. A galvanometer written with `length: gap - 1.4`
 * left both leads 0.700 short of the bridge nodes, and nothing noticed.
 * ------------------------------------------------------------------ */

const A = { x: 2, y: 5 };
const B = { x: 6, y: 8 };
const C = { x: 10, y: 5 };
const D = { x: 6, y: 2 };

await byName.replace_diagram.execute({
  title: 'Bridge',
  canvas: { width: 14, height: 11 },
  elements: [],
});

for (const [id, from, to] of [['R1', A, B], ['R2', B, C], ['R3', A, D], ['R4', D, C]]) {
  const arm = await byName.add_two_terminal.execute({
    type: 'resistor', id, from, to, values: { label: id },
  });
  check(`${id} spans its two nodes`, arm.ok === true, JSON.stringify(arm.error || ''));
}

const built = await byName.add_two_terminal.execute({
  type: 'resistor', id: 'probe', from: A, to: B, values: { label: 'x' },
});
const probe = store.byId('probe');
check('the part is centred between its ends',
  Math.abs(probe.x - (A.x + B.x) / 2) < 0.01 && Math.abs(probe.y - (A.y + B.y) / 2) < 0.01,
  JSON.stringify({ x: probe.x, y: probe.y }));
check('its angle points from one end to the other',
  Math.abs(probe.angle - Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI) < 0.01,
  String(probe.angle));
check('add_two_terminal reports the span it computed',
  Math.abs(built.span - Math.hypot(B.x - A.x, B.y - A.y)) < 0.01, String(built.span));
check('both ends land on another terminal',
  built.joins.length === 2 && built.joins.every((j) => j.joinedTo !== null),
  JSON.stringify(built.joins));
await byName.remove_elements.execute({ ids: ['probe'] });

check('every joint is joined',
  (await byName.check_connections.execute({})).connected === true,
  JSON.stringify((await byName.check_connections.execute({})).dangling));

// The mistake, reproduced: a part shortened by hand.
const gap = Math.hypot(D.x - B.x, D.y - B.y);
await byName.add_element.execute({
  type: 'meter',
  values: {
    id: 'G', kind: 'galvanometer',
    x: (B.x + D.x) / 2, y: (B.y + D.y) / 2,
    length: gap - 1.4, angle: -90,
  },
});
const broken = await byName.check_connections.execute({});
check('a hand-shortened part is caught',
  broken.connected === false && broken.dangling.some((d) => d.id === 'G'),
  JSON.stringify(broken.dangling));
check('the gap is reported with its size',
  broken.dangling.filter((d) => d.id === 'G').every((d) => Math.abs(d.gap - 0.7) < 0.001),
  JSON.stringify(broken.dangling));
check('both of its leads are reported',
  broken.dangling.filter((d) => d.id === 'G').length === 2);
check('the audit reports it too',
  (await byName.check_visual_layout.execute({})).issues
    .some((i) => i.title === 'Terminal not connected'));
check('diagnose_diagram reports it too',
  diagnoseDiagram().some((i) => i.title === 'Terminal not connected'));

// The same part, built by the tool instead.
await byName.remove_elements.execute({ ids: ['G'] });
const fixed = await byName.add_two_terminal.execute({
  type: 'meter', id: 'G', from: B, to: D, values: { kind: 'galvanometer' },
});
check('the tool cannot produce the same mistake',
  fixed.ok === true && fixed.joins.every((j) => j.joinedTo !== null),
  JSON.stringify(fixed.error || fixed.joins));
check('the bridge is connected again',
  (await byName.check_connections.execute({})).connected === true);

// The negative control. An open end with nothing near it is a probe point,
// not a defect, and reporting it would train a caller to ignore the check.
await byName.add_element.execute({
  type: 'wire', values: { id: 'lead', points: '10,5 13,5' },
});
const open = await byName.check_connections.execute({});
check('a deliberate open end is not reported',
  open.connected === true, JSON.stringify(open.dangling));
check('the open end still counted as a target', open.targets > 10, String(open.targets));

// A wire corner is a junction, so a part may land on one.
await byName.add_element.execute({
  type: 'wire', values: { id: 'bend', points: '13,5 13,2 10,2' },
});
const corner = await byName.add_two_terminal.execute({
  type: 'capacitor', id: 'Cx', from: { x: 13, y: 5 }, to: { x: 13, y: 2 },
});
check('a part joining two wire vertices is connected',
  corner.ok === true && corner.joins.every((j) => j.joinedTo !== null),
  JSON.stringify(corner.error || corner.joins));

// The tool refuses what it computes, rather than ignoring it.
check('add_two_terminal refuses a length in values',
  (await byName.add_two_terminal.execute({
    type: 'resistor', from: A, to: C, values: { length: 3 },
  })).ok === false);
check('add_two_terminal refuses a non-circuit type',
  (await byName.add_two_terminal.execute({ type: 'body', from: A, to: C })).ok === false);
check('add_two_terminal refuses two identical ends',
  (await byName.add_two_terminal.execute({ type: 'resistor', from: A, to: A })).ok === false);

/* ------------------------------------------------------------------ *
 * Data coordinates, and a render failure that must not pass as clean.
 * ------------------------------------------------------------------ */

await byName.replace_diagram.execute({
  title: 'Plot annotations',
  canvas: { width: 15, height: 10 },
  elements: [
    // Deliberately anisotropic: 2 document units per x, 1 per y.
    { type: 'axes', id: 'ax', x: 1, y: 1, width: 8, height: 4, xMin: 0, xMax: 4, yMin: 0, yMax: 4 },
    { type: 'shape', id: 'box', kind: 'rect', x: 1, y: 1, width: 1, height: 1 },
    { type: 'shape', id: 'box2', kind: 'rect', x: 1, y: 1, width: 1, height: 1 },
  ],
});

const inPlot = await byName.place_in_axes.execute({
  axesId: 'ax', elementId: 'box', dataX: 2, dataY: 2, dataWidth: 1, dataHeight: 1,
});
check('place_in_axes reports the scale of each axis',
  inPlot.ok && inPlot.unitsPerDataX === 2 && inPlot.unitsPerDataY === 1,
  JSON.stringify(inPlot.error || { x: inPlot.unitsPerDataX, y: inPlot.unitsPerDataY }));
check('it notices the axes are not isotropic', inPlot.isotropic === false);

const plotBox = store.byId('box');
check('the position converts through the axes',
  Math.abs(plotBox.x - (1 + (2 / 4) * 8)) < 1e-6 && Math.abs(plotBox.y - (1 + (2 / 4) * 4)) < 1e-6,
  JSON.stringify({ x: plotBox.x, y: plotBox.y }));
check('width converts through the x axis, height through the y axis',
  Math.abs(plotBox.width - 2) < 1e-6 && Math.abs(plotBox.height - 1) < 1e-6,
  JSON.stringify({ w: plotBox.width, h: plotBox.height }));

const placedBatch = await byName.place_in_axes.execute({
  axesId: 'ax',
  elements: [
    { elementId: 'box', dataX: 1, dataY: 1 },
    { elementId: 'box2', dataX: 3, dataY: 3, dataWidth: 0.5, dataHeight: 2 },
  ],
});
check('a placedBatch places every element named', placedBatch.ok && placedBatch.placed.length === 2,
  JSON.stringify(placedBatch.error || placedBatch.placed));
check('the second element got its own data size',
  Math.abs(store.byId('box2').width - 1) < 1e-6 && Math.abs(store.byId('box2').height - 2) < 1e-6,
  JSON.stringify({ w: store.byId('box2').width, h: store.byId('box2').height }));

check('place_in_axes rejects an element that is not an axes',
  (await byName.place_in_axes.execute({ axesId: 'box', elementId: 'box2', dataX: 1, dataY: 1 })).ok === false);
check('place_in_axes rejects an unknown element',
  (await byName.place_in_axes.execute({ axesId: 'ax', elementId: 'nope', dataX: 1, dataY: 1 })).ok === false);
check('place_in_axes needs something to do',
  (await byName.place_in_axes.execute({ axesId: 'ax', elementId: 'box' })).ok === false);

// A render that throws used to leave the element out of the drawing with only
// a console warning. Four curves once vanished while the audit said clean.
const { defineType } = await import('../src/registry.js');
defineType({
  name: 'test-explodes',
  label: 'Explodes',
  group: 'Common',
  hint: 'A type whose render always throws. Used only by the tests.',
  schema: { type: 'object', properties: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 } }, required: [] },
  anchor: (element) => ({ x: element.x, y: element.y }),
  move: (element, dx, dy) => ({ x: element.x + dx, y: element.y + dy }),
  render() { throw new Error('deliberate'); },
  tikz: () => [],
});

// The report needs a render to have happened, which is true in the app and in
// the export path but not here: nothing has drawn, so the list is empty. The
// end-to-end assertion lives in browser.test.mjs, where the canvas is real.
const { renderFailures } = await import('../src/render.js');
check('render failures are exposed as a list', Array.isArray(renderFailures()));
check('a document that has not rendered reports none', renderFailures().length === 0);

await byName.add_element.execute({ type: 'test-explodes', values: { id: 'boom', x: 5, y: 5 } });
check('a broken type can still be added and removed',
  store.byId('boom') !== null);
await byName.remove_elements.execute({ ids: ['boom'] });
check('and the document is clean afterwards',
  diagnoseDiagram().some((i) => i.title === 'Ready'),
  JSON.stringify(diagnoseDiagram().map((i) => i.title)));

if (failures) {
  console.log(`\n${failures} of ${checks} WebMCP checks failed.`);
  process.exit(1);
}

console.log(`All ${checks} WebMCP checks passed.`);
