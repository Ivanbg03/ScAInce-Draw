/**
 * Smoke test for the SVG render path.
 *
 * A tiny DOM stub lets Node execute every type's render() function. This
 * catches an undefined reference, a bad attribute and a NaN coordinate, none
 * of which `node --check` or the TikZ tests would find.
 */

class StubNode {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.children = [];
    this.text = '';
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  append(...nodes) { for (const node of nodes) if (node) this.children.push(node); }
  set textContent(value) { this.text = String(value); }
  get textContent() { return this.text; }
}

globalThis.document = {
  createElementNS: (namespace, tag) => new StubNode(tag),
  createElement: (tag) => new StubNode(tag),
};

const { renderDocument } = await import('../src/render.js');
const { allTypes, createElement } = await import('../src/registry.js');
const { sampleDocument } = await import('../src/sample.js');
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

let failures = 0;
let checks = 0;
const check = (label, condition, extra = '') => {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
};

/** Walks the tree and collects every attribute value and text run. */
function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function inspect(root, label) {
  const bad = [];
  let nodes = 0;
  walk(root, (node) => {
    nodes++;
    for (const [name, value] of Object.entries(node.attributes)) {
      if (/NaN|undefined|Infinity|\[object/.test(value)) {
        bad.push(`<${node.tagName} ${name}="${value}">`);
      }
    }
  });
  check(`${label}: no broken attribute`, bad.length === 0, bad.slice(0, 3).join(' '));
  return nodes;
}

const view = { scale: 40, panX: 0, panY: 0 };

/* 1. The sample document renders. */
console.log('\nsample document');
{
  const sample = sampleDocument();
  const { root } = renderDocument(sample, view, { selection: ['block'], interactive: true });
  const nodes = inspect(root, 'sample');
  check('the tree has content', nodes > 30, `${nodes} nodes`);

  // Every element must appear with its data-id.
  const seen = new Set();
  walk(root, (node) => { if (node.attributes['data-id']) seen.add(node.attributes['data-id']); });
  for (const element of sample.elements) {
    check(`sample renders ${element.id}`, seen.has(element.id));
  }

  // The selected element gets the handle layer.
  let handles = 0;
  walk(root, (node) => { if (node.attributes.class && node.attributes.class.includes('handle')) handles++; });
  check('a selection draws at least one handle', handles >= 1, `${handles}`);
}

/* 2. Every registered type renders on its defaults. */
console.log('\nevery type on its defaults');
{
  const taken = new Set();
  for (const type of allTypes()) {
    const element = createElement(type.name, {}, taken);
    taken.add(element.id);
    const doc = {
      title: type.name,
      canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
      elements: [element],
    };
    let root;
    try {
      ({ root } = renderDocument(doc, view, { selection: [element.id], interactive: true }));
    } catch (error) {
      check(`${type.name} renders`, false, error.message);
      continue;
    }
    check(`${type.name} renders`, true);
    inspect(root, type.name);
  }
}

/* 3. Awkward inputs must not produce broken geometry. */
console.log('\nawkward inputs');
{
  const cases = [
    ['a curve with a bad expression', 'curve', { expression: 'wobble(x)' }],
    ['a curve with a pole', 'curve', { expression: '1/x', from: -2, to: 2 }],
    ['a curve with an empty range', 'curve', { expression: 'x', from: 1, to: 1 }],
    ['a polyline with one point', 'polyline', { points: '1,1' }],
    ['a polyline with no points', 'polyline', { points: '' }],
    ['a polyline with rubbish', 'polyline', { points: 'a,b c' }],
    ['a ray with no points', 'ray', { points: '' }],
    ['a force with a dangling body reference', 'force', { bodyId: 'ghost-9' }],
    ['a link with dangling ends', 'link', { fromId: 'ghost-1', toId: 'ghost-2' }],
    ['a curve on a missing axes', 'curve', { axesId: 'ghost-3' }],
    ['an axes with a zero span', 'axes', { xMin: 2, xMax: 2, yMin: 0, yMax: 0 }],
    ['an angle of zero width', 'angle', { from: 45, to: 45 }],
    ['a body with a tiny size', 'body', { width: 0.1, height: 0.1 }],
    ['a surface with a fine hatch', 'surface', { length: 0.2, hatchStep: 0.05 }],
    ['an area with a reversed range', 'area', { from: 3, to: 0 }],
  ];

  for (const [label, typeName, overrides] of cases) {
    const element = createElement(typeName, overrides, new Set());
    const doc = {
      title: label,
      canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
      elements: [element],
    };
    try {
      const { root } = renderDocument(doc, view, { selection: [element.id], interactive: true });
      check(`${label} renders`, true);
      inspect(root, label);
    } catch (error) {
      check(`${label} renders`, false, error.message);
    }
  }
}

/* 3b. Every palette icon renders on its small canvas. */
console.log('\npalette icons');
{
  const { iconFor } = await import('../src/icons.js');

  for (const type of allTypes()) {
    const icon = iconFor(type.name);
    const scale = Math.min(48 / icon.w, 34 / icon.h);

    // The palette builds the same element list: the framing extras first, then
    // the shape itself. A plot type needs its faint axes to have coordinates.
    const taken = new Set();
    const elements = icon.extra.map((entry) => {
      const extra = createElement(entry.type, { id: entry.id, ...entry.values }, taken);
      taken.add(extra.id);
      return extra;
    });
    elements.push(createElement(type.name, icon.values, taken));

    const doc = {
      title: '',
      canvas: { width: icon.w, height: icon.h, grid: 1, showGrid: false, snap: false },
      elements,
    };
    try {
      const { root } = renderDocument(doc, { scale }, { selection: [], interactive: false, margin: 3 });
      let drawn = 0;
      walk(root, (node) => { if (/^(path|line|rect|circle|polygon|text)$/.test(node.tagName)) drawn++; });
      check(`${type.name} icon draws something`, drawn > 0, `${drawn} shapes`);
      inspect(root, `${type.name} icon`);
    } catch (error) {
      check(`${type.name} icon renders`, false, error.message);
    }
  }
}

/* 3c. Label baselines must balance. */
console.log('\nlabel baselines');
{
  const { mathText } = await import('../src/mathtext.js');
  const size = 16;

  const dyOf = (source) => mathText(source, { size }).children
    .map((span) => Number(span.attributes.dy));

  check('a plain label has no shift', dyOf('abc').every((value) => value === 0));

  // After each run the cumulative shift must equal that run's own level: zero
  // on the baseline, down for a subscript, up for a superscript. An em value
  // would break this, because the script tspan carries a smaller font-size and
  // em resolves against that, so the way back up would fall short.
  const { toRuns } = await import('../src/mathtext.js');
  const LEVEL = { base: 0, sub: 0.28, sup: -0.45 };

  for (const source of ['x_1y', 'a^2b', 'F_1 + F_2', 'v_{max}w', 'a_1b^2c']) {
    const shifts = dyOf(source);
    const runs = toRuns(source);
    check(`"${source}" emits one span per run`, shifts.length === runs.length,
      `${shifts.length} vs ${runs.length}`);

    let cumulative = 0;
    let correct = true;
    runs.forEach((run, index) => {
      cumulative += shifts[index];
      if (Math.abs(cumulative - LEVEL[run.shift] * size) > 1e-6) correct = false;
    });
    check(`"${source}" keeps every run on its own level`, correct, JSON.stringify(shifts));
  }

  const subscript = mathText('F_1', { size });
  check('a subscript is smaller than the base',
    Number(subscript.children[1].attributes['font-size']) < size,
    subscript.children[1].attributes['font-size']);
  check('a subscript moves down',
    Number(subscript.children[1].attributes.dy) > 0,
    subscript.children[1].attributes.dy);
  check('a superscript moves up',
    Number(mathText('x^2', { size }).children[1].attributes.dy) < 0);
}

/* 4. The export mode drops the interactive layers. */
console.log('\nexport mode');
{
  const sample = sampleDocument();
  const { root } = renderDocument(sample, view, { selection: ['block'], interactive: false, background: '#ffffff' });
  let grid = 0;
  let handles = 0;
  walk(root, (node) => {
    if (node.attributes['data-layer'] === 'grid') grid++;
    if (node.attributes['data-layer'] === 'handles') handles++;
  });
  check('an export carries no grid layer', grid === 0);
  check('an export carries no handle layer', handles === 0);
  check('an export paints a background', root.children.some((child) => child.tagName === 'rect'));
}

/* The exports must not follow the screen zoom. */
console.log('');
console.log('exports ignore the screen zoom');
{
  // toSvgSource serialises, which Node has no XMLSerializer for.
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      if (!node.tagName) return String(node.text || '');
      const attrs = Object.entries(node.attributes)
        .map(([name, value]) => ` ${name}="${value}"`).join('');
      const kids = node.children.map((child) => this.serializeToString(child)).join('');
      return `<${node.tagName}${attrs}>${node.text || ''}${kids}</${node.tagName}>`;
    }
  };

  const { toSvgSource } = await import('../src/export/svg.js');
  const { toTikzSource } = await import('../src/export/tikz.js');
  const { EXPORT_SCALE } = await import('../src/render.js');
  const doc = sampleDocument();

  const zoomedOut = { scale: 12, panX: 0, panY: 0 };
  const zoomedIn = { scale: 120, panX: 0, panY: 0 };

  // Marker ids carry a per-render sequence number, so they differ by design.
  const stable = (source) => source.replace(/arrow-[0-9]+-/g, 'arrow-N-');
  const svgOut = toSvgSource(doc, zoomedOut);
  const svgIn = toSvgSource(doc, zoomedIn);
  check('the SVG export is identical at every zoom', stable(svgOut) === stable(svgIn),
    `${svgOut.length} vs ${svgIn.length} chars`);

  // 24 units wide, plus the 24px margin on each side.
  const expected = doc.canvas.width * EXPORT_SCALE + 48;
  const measured = Number(/ width="([0-9.]+)"/.exec(svgOut)?.[1]);
  check('the SVG export renders at EXPORT_SCALE', measured === expected,
    `${measured} != ${expected}`);

  check('an explicit scale still overrides it',
    Number(/ width="([0-9.]+)"/.exec(toSvgSource(doc, zoomedIn, { scale: 10 }))?.[1])
      === doc.canvas.width * 10 + 48);

  check('the TikZ export is identical at every zoom',
    toTikzSource(doc, zoomedOut) === toTikzSource(doc, zoomedIn));

  // The default zoom is a view setting, so it may differ from EXPORT_SCALE.
  const { emptyDocument } = await import('../src/store.js');
  check('a blank document keeps the finer grid', emptyDocument().canvas.grid === 0.5,
    String(emptyDocument().canvas.grid));
}

console.log(
  failures === 0
    ? `\nAll ${checks} render checks passed.`
    : `\n${failures} of ${checks} render checks failed.`,
);
process.exit(failures === 0 ? 0 : 1);
