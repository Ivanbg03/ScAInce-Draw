/**
 * Robustness: the bug classes the other suites do not reach.
 *
 * The render and export suites ask "does the happy path work". This one asks
 * "what happens when it does not": corrupt saved data, dangling references,
 * hostile numbers, a deep undo history, a fuzzed expression, a large document.
 * Every check here exists because the failure it guards against would be
 * silent — a NaN in an export, an id collision, a reference to nothing.
 */

import { compile } from '../src/expr.js';
import { toTikz, plain, toRuns } from '../src/mathtext.js';
import {
  allTypes, createElement, defaultsFor, getType, nextId, validate,
} from '../src/registry.js';
import { toTikzSource } from '../src/export/tikz.js';
import { store, emptyDocument } from '../src/store.js';
import { lintTex } from './texlint.mjs';

import '../src/types/common.js';
import '../src/types/annotation.js';
import '../src/types/mechanics.js';
import '../src/types/mechanics-parts.js';
import '../src/types/plots.js';
import '../src/types/plots-extra.js';
import '../src/types/schematic.js';
import '../src/types/optics.js';
import '../src/types/optics-parts.js';
import '../src/types/fields.js';
import '../src/types/geometry.js';
import '../src/types/circuit.js';

let failures = 0;
let checks = 0;

function check(label, condition, extra = '') {
  checks++;
  if (condition) return true;
  failures++;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  return false;
}

function section(name) { console.log(`\n${name}`); }

const view = { scale: 40, panX: 0, panY: 0 };

function blankDoc(elements = []) {
  return {
    title: 'test',
    canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
    elements,
  };
}

/* ==================================================================
   1. Hostile and corrupt saved documents
   ================================================================== */

section('corrupt documents');
{
  const cases = [
    ['not JSON at all', 'this is not json'],
    ['JSON null', 'null'],
    ['a bare number', '42'],
    ['an array', '[1,2,3]'],
    ['an object with no elements', '{"title":"x"}'],
    ['elements not an array', '{"elements":"nope"}'],
    ['elements holding nulls', '{"elements":[null,null]}'],
    ['an element with no type', '{"elements":[{"id":"a"}]}'],
    ['an element of an unknown type', '{"elements":[{"id":"a","type":"wormhole"}]}'],
    ['a canvas that is not an object', '{"elements":[],"canvas":7}'],
    ['a deeply nested object', `{"elements":[],"canvas":${'{"a":'.repeat(40)}1${'}'.repeat(40)}}`],
  ];

  for (const [label, raw] of cases) {
    let threw = null;
    try {
      // restore() reads localStorage, which Node does not have, so the parse
      // path is exercised directly through replaceDocument.
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      store.replaceDocument(parsed && typeof parsed === 'object' ? parsed : emptyDocument(),
        { history: false });
      // A render-free sanity pass: the export must survive whatever came in.
      toTikzSource(store.doc, view, {});
    } catch (error) {
      threw = error.message;
    }
    check(`survives ${label}`, threw === null, threw || '');
    check(`${label} leaves a usable document`,
      Array.isArray(store.doc.elements) && typeof store.doc.canvas === 'object',
      JSON.stringify(store.doc.canvas));
  }

  // An element of an unknown type must be dropped, not kept to crash later.
  store.replaceDocument(blankDoc([
    { id: 'ghost', type: 'wormhole' },
    createElement('body', { id: 'real' }, new Set()),
  ]), { history: false });
  let exported = '';
  let threw = null;
  try { exported = toTikzSource(store.doc, view, {}); } catch (error) { threw = error.message; }
  check('an unknown type does not break the export', threw === null, threw || '');
  check('the unknown type is reported, not silently drawn',
    exported.includes('% ghost') === false || exported.includes('failed'),
    exported.split('\n').find((l) => l.includes('ghost')) || '');
}

/* ==================================================================
   2. Dangling references
   ================================================================== */

section('dangling references');
{
  store.replaceDocument(blankDoc(), { history: false });
  const axes = store.addElement('axes', { x: 2, y: 2 });
  const curve = store.addElement('curve', { axesId: axes.id });
  const body = store.addElement('body', { x: 10, y: 8 });
  const force = store.addElement('force', { bodyId: body.id });

  store.removeElement(axes.id);
  check('deleting an axes clears the curve reference',
    store.byId(curve.id).axesId === '', store.byId(curve.id).axesId);

  store.removeElement(body.id);
  check('deleting a body clears the force reference',
    store.byId(force.id).bodyId === '', store.byId(force.id).bodyId);

  let threw = null;
  try { toTikzSource(store.doc, view, {}); } catch (error) { threw = error.message; }
  check('orphans still export', threw === null, threw || '');

  // A reference to an id that never existed.
  store.replaceDocument(blankDoc([
    createElement('curve', { id: 'c1', axesId: 'never-existed' }, new Set()),
    createElement('force', { id: 'f1', bodyId: 'never-existed' }, new Set()),
    createElement('link', { id: 'l1', fromId: 'never-existed', toId: 'also-not' }, new Set()),
  ]), { history: false });
  threw = null;
  try { toTikzSource(store.doc, view, {}); } catch (error) { threw = error.message; }
  check('a reference to nothing exports cleanly', threw === null, threw || '');

  // A link whose two ends are the same block.
  const block = createElement('block', { id: 'b1', x: 5, y: 5 }, new Set());
  store.replaceDocument(blankDoc([
    block,
    createElement('link', { id: 'l2', fromId: 'b1', toId: 'b1' }, new Set()),
  ]), { history: false });
  threw = null;
  let output = '';
  try { output = toTikzSource(store.doc, view, {}); } catch (error) { threw = error.message; }
  check('a self-linking block does not hang or throw', threw === null, threw || '');
  check('a self-link emits no NaN', !output.includes('NaN'),
    output.split('\n').find((l) => l.includes('NaN')) || '');
}

/* ==================================================================
   3. Hostile numbers
   ================================================================== */

section('hostile numbers');
{
  const poison = [NaN, Infinity, -Infinity];
  const rejected = [];

  for (const type of allTypes()) {
    const defaults = defaultsFor(type.schema);
    for (const [key, property] of Object.entries(type.schema.properties)) {
      if (property.type !== 'number') continue;
      for (const value of poison) {
        const problems = validate(type.schema, { ...defaults, [key]: value });
        if (problems.length === 0) rejected.push(`${type.name}.${key}=${value}`);
      }
    }
  }
  check('every numeric field rejects NaN and Infinity', rejected.length === 0,
    rejected.slice(0, 5).join(', '));

  // updateElement must refuse it too, not merely validate().
  store.replaceDocument(blankDoc(), { history: false });
  const body = store.addElement('body', { x: 4, y: 4 });
  let refused = false;
  try { store.updateElement(body.id, { width: NaN }); } catch { refused = true; }
  check('the store refuses a NaN width', refused);
  check('the refused value did not stick', Number.isFinite(store.byId(body.id).width));

  // Extreme but finite values must still export without producing rubbish.
  store.replaceDocument(blankDoc([
    createElement('body', { id: 'huge', x: 1e6, y: -1e6, width: 1e5, height: 1e5 }, new Set()),
    createElement('arrow', { id: 'tiny', x1: 1e-9, y1: 1e-9, x2: 2e-9, y2: 2e-9 }, new Set()),
  ]), { history: false });
  const extreme = toTikzSource(store.doc, view, {});
  check('extreme coordinates export without NaN', !extreme.includes('NaN'));
  check('extreme coordinates export without Infinity', !extreme.includes('Infinity'));
  check('extreme coordinates export without exponent notation',
    !/\d[eE][+-]\d/.test(extreme),
    extreme.split('\n').find((l) => /\d[eE][+-]\d/.test(l)) || '');
}

/* ==================================================================
   4. Identity: ids must stay unique
   ================================================================== */

section('identity');
{
  // A restored document may hold ids the counter has never issued.
  store.replaceDocument(blankDoc([
    createElement('body', { id: 'body-999999' }, new Set()),
    createElement('force', { id: 'force-999999' }, new Set()),
  ]), { history: false });

  const fresh = [];
  for (let index = 0; index < 50; index++) fresh.push(store.addElement('body', {}).id);
  const all = store.doc.elements.map((element) => element.id);
  check('no id collides after restoring high ids',
    new Set(all).size === all.length,
    `${all.length} elements, ${new Set(all).size} distinct`);

  // nextId must respect the taken set it is given.
  const taken = new Set(['body-1', 'body-2', 'body-3']);
  const generated = nextId('body', taken);
  check('nextId avoids ids already taken', !taken.has(generated), generated);

  // Duplicating repeatedly must never repeat an id.
  store.replaceDocument(blankDoc(), { history: false });
  const seed = store.addElement('body', { x: 5, y: 5 });
  store.select([seed.id]);
  for (let index = 0; index < 30; index++) {
    store.select(store.duplicate().map((element) => element.id));
  }
  const cloned = store.doc.elements.map((element) => element.id);
  check('thirty duplications produce unique ids',
    new Set(cloned).size === cloned.length,
    `${cloned.length} vs ${new Set(cloned).size}`);
}

/* ==================================================================
   5. Undo and redo
   ================================================================== */

section('undo and redo');
{
  store.replaceDocument(blankDoc(), { history: false });
  const ids = [];
  for (let index = 0; index < 20; index++) ids.push(store.addElement('body', { x: index, y: 1 }).id);

  check('twenty additions are on the sheet', store.doc.elements.length === 20);
  for (let index = 0; index < 20; index++) store.undo();
  check('twenty undos empty the sheet', store.doc.elements.length === 0,
    String(store.doc.elements.length));
  for (let index = 0; index < 20; index++) store.redo();
  check('twenty redos restore every one', store.doc.elements.length === 20,
    String(store.doc.elements.length));
  check('redo restores the same ids',
    store.doc.elements.map((e) => e.id).join() === ids.join());

  // A new action must clear the redo stack.
  store.undo();
  check('there is something to redo', store.canRedo());
  store.addElement('body', { x: 99, y: 1 });
  check('a new action clears the redo stack', !store.canRedo());

  // The history is bounded, and undoing past the end is harmless.
  store.replaceDocument(blankDoc(), { history: false });
  for (let index = 0; index < 150; index++) store.addElement('body', { x: 1, y: 1 });
  let undone = 0;
  while (store.undo()) undone++;
  check('the history is capped at a hundred', undone <= 100, String(undone));
  check('undoing past the end returns false', store.undo() === false);
  check('the document survives exhausting the history',
    Array.isArray(store.doc.elements));

  // A transaction is one step even when it touches many elements.
  store.replaceDocument(blankDoc(), { history: false });
  const many = [];
  for (let index = 0; index < 5; index++) many.push(store.addElement('body', { x: index, y: 2 }));
  const beforeShift = many.map((element) => store.byId(element.id).x).join();
  store.transaction('bulk', () => {
    for (const element of many) {
      store.updateElement(element.id, { x: element.x + 3 }, { history: false });
    }
  });
  check('a transaction moved everything',
    store.doc.elements.map((e) => e.x).join() !== beforeShift);
  store.undo();
  check('one undo reverses the whole transaction',
    many.map((element) => store.byId(element.id).x).join() === beforeShift,
    many.map((element) => store.byId(element.id).x).join());

  // A transaction wrapping methods that record their own history must still
  // be one step. removeElement and addElement both push on their own.
  store.replaceDocument(blankDoc(), { history: false });
  for (let index = 0; index < 40; index++) store.addElement('body', { x: index % 20, y: 3 });
  store.select(store.doc.elements.map((element) => element.id));
  store.transaction('delete all', () => {
    for (const id of [...store.selection]) store.removeElement(id);
  });
  check('deleting forty shapes empties the sheet', store.doc.elements.length === 0);
  store.undo();
  check('one undo brings all forty back', store.doc.elements.length === 40,
    String(store.doc.elements.length));

  store.transaction('add a batch', () => {
    for (let index = 0; index < 10; index++) store.addElement('charge', { x: index, y: 9 });
  });
  check('a batch of additions landed', store.doc.elements.length === 50);
  store.undo();
  check('one undo removes the whole batch', store.doc.elements.length === 40,
    String(store.doc.elements.length));

  // Undo across a canvas resize that also shifted the shapes.
  store.replaceDocument(blankDoc([
    createElement('body', { id: 'b', x: 5, y: 5 }, new Set()),
  ]), { history: false });
  const start = { w: store.doc.canvas.width, x: store.byId('b').x };
  store.transaction('grow west', () => {});
  store.setCanvas({ width: start.w + 4 }, { history: false });
  store.shiftAll(4, 0, { history: false });
  check('growing west moved the shape', store.byId('b').x === start.x + 4);
  store.undo();
  check('one undo restores both the canvas and the shape',
    store.doc.canvas.width === start.w && store.byId('b').x === start.x,
    `${store.doc.canvas.width} / ${store.byId('b').x}`);
}

/* ==================================================================
   6. The expression parser, fuzzed
   ================================================================== */

section('expression fuzzing');
{
  const alphabet = 'x+-*/^(), .0123456789sincotaexpqrtlgmnbduvw{}[]@#$%&|!?~`\\\'"';
  let threwCompiling = 0;
  let threwCalling = 0;
  let nonNumber = 0;

  // A deterministic pseudo-random source, so a failure is reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let index = 0; index < 4000; index++) {
    const length = 1 + Math.floor(rand() * 24);
    let source = '';
    for (let position = 0; position < length; position++) {
      source += alphabet[Math.floor(rand() * alphabet.length)];
    }

    let compiled;
    try {
      compiled = compile(source, 'x');
    } catch {
      threwCompiling++;
      continue;
    }
    if (!compiled.fn) continue;
    for (const input of [0, 1, -1, 1e9, -1e-9]) {
      let value;
      try {
        value = compiled.fn(input);
      } catch {
        threwCalling++;
        break;
      }
      if (typeof value !== 'number') { nonNumber++; break; }
    }
  }

  check('fuzzing never throws while compiling', threwCompiling === 0, String(threwCompiling));
  check('fuzzing never throws while evaluating', threwCalling === 0, String(threwCalling));
  check('a compiled expression always returns a number', nonNumber === 0, String(nonNumber));

  // Structural extremes.
  const extremes = [
    ['deep nesting', '('.repeat(500) + 'x' + ')'.repeat(500)],
    ['a long chain', Array(2000).fill('x').join('+')],
    ['many unary minuses', '-'.repeat(200) + 'x'],
    ['an empty string', ''],
    ['only spaces', '     '],
    ['only operators', '+-*/^'],
    ['a lone bracket', '('],
  ];
  for (const [label, source] of extremes) {
    let ok = true;
    try {
      const { fn } = compile(source, 'x');
      if (fn) fn(2);
    } catch { ok = false; }
    check(`${label} is handled`, ok);
  }

  // The whitelist must hold under every prototype trick.
  const attacks = [
    'constructor', '__proto__', 'prototype', 'toString', 'valueOf',
    'hasOwnProperty', 'globalThis', 'process', 'eval', 'Function',
    'constructor(x)', '__proto__(x)', 'toString(x)',
  ];
  const leaked = attacks.filter((source) => compile(source, 'x').fn !== null);
  check('no prototype name slips through the whitelist', leaked.length === 0, leaked.join(', '));
}

/* ==================================================================
   7. Exports stay clean and deterministic
   ================================================================== */

section('exports');
{
  // One of everything, with awkward but legal values.
  const taken = new Set();
  const everything = allTypes().map((type) => {
    const element = createElement(type.name, {}, taken);
    taken.add(element.id);
    return element;
  });
  store.replaceDocument(blankDoc(everything), { history: false });

  const first = toTikzSource(store.doc, view, { widthCm: 12 });
  const second = toTikzSource(store.doc, view, { widthCm: 12 });
  check('the TikZ export is deterministic', first === second);
  check('the TikZ export lints clean', lintTex(first).length === 0,
    lintTex(first).slice(0, 2).map((p) => `${p.kind}: ${p.text.slice(0, 60)}`).join(' | '));

  for (const poison of ['NaN', 'undefined', 'Infinity', 'null', '[object']) {
    check(`the export holds no ${poison}`, !first.includes(poison),
      first.split('\n').find((l) => l.includes(poison)) || '');
  }

  // Every colour referenced must be defined.
  const used = new Set([...first.matchAll(/\bc(\d+)\b/g)].map((m) => m[0]));
  const defined = new Set([...first.matchAll(/\\definecolor\{(c\d+)\}/g)].map((m) => m[1]));
  const undefinedColours = [...used].filter((name) => !defined.has(name));
  check('every colour used is defined', undefinedColours.length === 0,
    undefinedColours.join(', '));

  // Balanced braces and brackets across the whole file.
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < first.length; index++) {
    const character = first[index];
    if (character === '\\') { index++; continue; }
    if (character === '{') braces++;
    if (character === '}') braces--;
    if (character === '[') brackets++;
    if (character === ']') brackets--;
  }
  check('braces balance across the export', braces === 0, String(braces));
  check('brackets balance across the export', brackets === 0, String(brackets));

  check('the picture is opened and closed once',
    (first.match(/\\begin\{tikzpicture\}/g) || []).length === 1
    && (first.match(/\\end\{tikzpicture\}/g) || []).length === 1);
}

/* ==================================================================
   8. Labels: nothing a user can type may break LaTeX
   ================================================================== */

section('labels');
{
  const nasty = [
    '', ' ', '\\', '\\\\', '{', '}', '{}', '$', '$$', '%', '&', '#', '_', '^', '~',
    'a_1_2_3', 'x^2^3^4', '\\vec{', '\\vec{}', '\\unknown{a}',
    '100%', 'A & B', 'a#b', 'a~b', 'C:\\temp\\x',
    'x'.repeat(500), '\\alpha'.repeat(50),
    'F_{net}', '\\vec{F}_{net}', '$already$', 'mixed $a$ and text',
  ];

  const broken = [];
  for (const label of nasty) {
    let output;
    try {
      output = toTikz(label);
    } catch (error) {
      broken.push(`${JSON.stringify(label)} threw ${error.message}`);
      continue;
    }
    const problems = lintTex(`\\node {${output}};`);
    if (problems.length) broken.push(`${JSON.stringify(label)} -> ${problems[0].kind}`);
  }
  check('no label produces invalid LaTeX', broken.length === 0, broken.slice(0, 3).join(' | '));

  // The screen renderer must survive them too.
  const runsBroken = [];
  for (const label of nasty) {
    try {
      plain(label);
      toRuns(label);
    } catch (error) {
      runsBroken.push(`${JSON.stringify(label)}: ${error.message}`);
    }
  }
  check('no label breaks the on-screen parser', runsBroken.length === 0,
    runsBroken.slice(0, 3).join(' | '));
}

/* ==================================================================
   9. Scale
   ================================================================== */

section('scale');
{
  const taken = new Set();
  const crowd = [];
  const names = allTypes().map((type) => type.name);
  for (let index = 0; index < 400; index++) {
    const name = names[index % names.length];
    const element = createElement(name, {}, taken);
    taken.add(element.id);
    crowd.push(element);
  }
  store.replaceDocument(blankDoc(crowd), { history: false });

  const started = Date.now();
  const big = toTikzSource(store.doc, view, {});
  const took = Date.now() - started;
  check('four hundred shapes export', big.length > 1000, `${big.length} chars`);
  check('four hundred shapes export in under five seconds', took < 5000, `${took}ms`);
  check('a large export holds no NaN', !big.includes('NaN'));

  // A curve at its sample ceiling.
  store.replaceDocument(blankDoc([
    createElement('axes', { id: 'ax', x: 1, y: 1 }, new Set()),
    createElement('curve', { id: 'cv', axesId: 'ax', expression: 'sin(50*x)', samples: 2000 }, new Set()),
  ]), { history: false });
  const dense = toTikzSource(store.doc, view, {});
  check('a two thousand sample curve exports', dense.includes('plot coordinates'));
  check('the export thins the samples so the source stays readable',
    dense.split('\n').length < 200, String(dense.split('\n').length));
}

console.log(failures === 0
  ? `\nAll ${checks} robustness checks passed.`
  : `\n${failures} of ${checks} robustness checks failed.`);
process.exit(failures === 0 ? 0 : 1);
