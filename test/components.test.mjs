/**
 * Does every component actually work?
 *
 * "It draws something" is a weak test — a shape can draw a stub and still be
 * broken. For each of the 48 types this checks five things in a real browser:
 *
 *   1. it can be added through the palette
 *   2. it draws real primitives, not an empty group
 *   3. it lands on the sheet, not at the origin
 *   4. every geometry field in its schema actually changes the drawing
 *   5. it exports at least one real TikZ command
 *
 * Rule 4 is the one that matters. A field that changes nothing is either dead
 * or wired to the wrong thing, and that is exactly how a component looks
 * "not working" to somebody using it.
 *
 * Run:  node test/components.test.mjs [url]
 */

import { Browser } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:8124/';

let failures = 0;
let checks = 0;
const lines = [];

function check(label, condition, extra = '') {
  checks++;
  if (condition) return true;
  failures++;
  lines.push(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  return false;
}

/**
 * Fields that only bite once something else is set.
 *
 * A dead field is a bug; a conditional field is not. "sides" does nothing to a
 * circle and "dotSize" does nothing when the dots are off, so each is tested
 * with its condition satisfied. Anything not listed here must change the
 * drawing on its own.
 */
const GATES = {
  'text-box': { leaderX: { showLeader: true }, leaderY: { showLeader: true } },
  mirror: { curvature: { kind: 'concave' } },
  shape: { height: { kind: 'rect' }, sides: { kind: 'polygon' }, angle: { kind: 'rect' } },
  'vector-field': {
    xMin: { axesId: '' }, xMax: { axesId: '' }, yMin: { axesId: '' }, yMax: { axesId: '' },
  },
  wire: { route: { points: '0,0 3,2' }, dotSize: { dots: 'corners' } },
  // A force only has an offset once it is attached to a body. The runner
  // creates one and fills the id in.
  force: { offsetX: { bodyId: '@body' }, offsetY: { bodyId: '@body' } },
};

// Fields that legitimately change nothing on their own.
const COSMETIC = new Set([
  'label', 'labelSize', 'labelSide', 'labelPlace', 'value', 'title',
  'xLabel', 'yLabel', 'zLabel', 'text', 'autoLength',
  'color', 'fill', 'style', 'fillOpacity', 'strokeWidth',
  'axesId', 'bodyId', 'fromId', 'toId',
]);

const page = await Browser.attach(9222);

try {
  await page.open(URL);
  await page.eval('localStorage.clear(); return true;');
  await page.open(URL);
  await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

  const names = await page.eval(`
    return import('./src/registry.js').then((reg) => reg.allTypes().map((t) => t.name));
  `);
  check('the registry holds 50 types', names.length === 50, String(names.length));

  const report = [];

  for (const name of names) {
    // Each type is examined in isolation, on a fresh sheet.
    const result = await page.eval(`
      const NAME = ${JSON.stringify(name)};
      const COSMETIC = new Set(${JSON.stringify([...COSMETIC])});
      const GATES = ${JSON.stringify(GATES)}[NAME] || {};

      return Promise.all([
        import('./src/registry.js'),
        import('./src/ui/palette.js'),
        import('./src/export/tikz.js'),
      ]).then(async ([reg, palette, tikz]) => {
        const store = window.__store;
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        store.clear();
        await frame();

        let element;
        try {
          element = palette.addAt(NAME);
        } catch (error) {
          return { name: NAME, addError: error.message };
        }
        await frame();

        const host = document.getElementById('canvas-host');
        const svg = host.querySelector('svg');
        const node = host.querySelector('.element[data-id=' + JSON.stringify(element.id) + ']');
        if (!node) return { name: NAME, drawn: false };

        // 2. real primitives, and how much ink. The node itself counts: a
        // plain label renders as a bare <text>, with nothing inside it.
        const PRIMITIVE = /^(path|line|rect|circle|polygon|polyline|ellipse|text)$/;
        const drawnCount = node.querySelectorAll(
          'path, line, rect, circle, polygon, polyline, ellipse, text').length
          + (PRIMITIVE.test(node.tagName) ? 1 : 0);
        const box = node.getBBox();

        // 3. where it sits, as a fraction of the sheet.
        const sheetW = svg.viewBox.baseVal.width;
        const sheetH = svg.viewBox.baseVal.height;

        // 4. does every geometry field move the needle?
        const type = reg.getType(NAME);
        const markup = () => host.querySelector('.element[data-id=' + JSON.stringify(element.id) + ']').outerHTML;

        // A body, in case a gate needs something to attach to.
        let helperBody = null;
        const needsBody = Object.values(GATES).some((g) => g.bodyId === '@body');
        if (needsBody) helperBody = store.addElement('body', { x: 8, y: 8 });

        const dead = [];
        for (const [key, property] of Object.entries(type.schema.properties)) {
          if (COSMETIC.has(key)) continue;

          // Satisfy the condition this field depends on, if it has one.
          const gate = GATES[key];
          const undo = {};
          if (gate) {
            for (const [gk, gv] of Object.entries(gate)) {
              undo[gk] = store.byId(element.id)[gk];
              store.updateElement(element.id, { [gk]: gv === '@body' ? helperBody.id : gv });
            }
            await frame();
          }

          const current = store.byId(element.id)[key];
          const before = markup();

          // An enum is dead only when NO other value changes the drawing.
          const candidates = [];
          if (property.enum) {
            for (const option of property.enum) if (option !== current) candidates.push(option);
          } else if (property.type === 'number') {
            const min = property.minimum;
            const max = property.maximum;
            let next = current + 1;
            if (max !== undefined && next > max) next = current - 1;
            if (min !== undefined && next < min) next = min;
            if (next !== current) candidates.push(next);
            if (current !== 0) candidates.push(current * 2);
          } else if (property.type === 'boolean') {
            candidates.push(!current);
          } else if (property.format === 'points') {
            candidates.push('1,1 3,2 5,1');
          } else if (property.format === 'expression') {
            candidates.push(key === 'rExpression' ? '1.5'
              : (key === 'uExpression' || key === 'vExpression') ? '1'
              : '0.5');
          }

          let moved = candidates.length === 0;   // nothing sensible to try
          for (const value of candidates) {
            if (value === current) continue;
            try {
              store.updateElement(element.id, { [key]: value });
            } catch { continue; }
            await frame();
            if (markup() !== before) moved = true;
            store.updateElement(element.id, { [key]: current });
            await frame();
            if (moved) break;
          }
          if (!moved) dead.push(key);

          for (const [gk, gv] of Object.entries(undo)) {
            store.updateElement(element.id, { [gk]: gv });
          }
          if (gate) await frame();
        }

        // 5. a real TikZ command, not only comments.
        const source = tikz.toTikzSource(store.doc, store.view, {});
        const own = source.split('\\n');
        const start = own.findIndex((l) => l.includes('% ' + element.id + ' ('));
        const body = start === -1 ? [] : own.slice(start + 1)
          .filter((l) => l.trim() && !l.trim().startsWith('%') && !l.includes('end{tikzpicture}'));
        const firstBlock = [];
        for (const l of body) { if (l.trim().startsWith('%')) break; firstBlock.push(l.trim()); }

        return {
          name: NAME,
          drawn: true,
          shapes: drawnCount,
          texts: 0,
          box: { x: box.x, y: box.y, w: box.width, h: box.height },
          sheetW, sheetH,
          fields: Object.keys(type.schema.properties).filter((k) => !COSMETIC.has(k)).length,
          dead,
          tikz: firstBlock.length,
          tikzSample: firstBlock[0] || '',
        };
      });
    `);

    report.push(result);
  }

  /* ------------------------------- verdicts ------------------------------ */

  const failedAdd = report.filter((r) => r.addError);
  check('every component can be added', failedAdd.length === 0,
    failedAdd.map((r) => `${r.name}: ${r.addError}`).join(' | '));

  const notDrawn = report.filter((r) => r.drawn === false);
  check('every component draws a node', notDrawn.length === 0,
    notDrawn.map((r) => r.name).join(', '));

  const drawn = report.filter((r) => r.drawn);

  const empty = drawn.filter((r) => r.shapes === 0 && r.texts === 0);
  check('every component draws real primitives', empty.length === 0,
    empty.map((r) => r.name).join(', '));

  const tiny = drawn.filter((r) => r.box.w < 3 && r.box.h < 3);
  check('no component draws a speck', tiny.length === 0,
    tiny.map((r) => `${r.name} ${Math.round(r.box.w)}x${Math.round(r.box.h)}`).join(', '));

  const huge = drawn.filter((r) => r.box.w > r.sheetW * 1.5 || r.box.h > r.sheetH * 1.5);
  check('no component overflows the sheet', huge.length === 0,
    huge.map((r) => `${r.name} ${Math.round(r.box.w)}x${Math.round(r.box.h)}`).join(', '));

  const cornered = drawn.filter((r) => {
    const cx = r.box.x + r.box.w / 2;
    const cy = r.box.y + r.box.h / 2;
    return cx < r.sheetW * 0.2 && cy > r.sheetH * 0.8;
  });
  check('no component lands in the bottom left corner', cornered.length === 0,
    cornered.map((r) => r.name).join(', '));

  const withDead = drawn.filter((r) => r.dead.length > 0);
  check('every geometry field changes the drawing', withDead.length === 0,
    withDead.map((r) => `${r.name}: ${r.dead.join('/')}`).join(' | '));

  const noTikz = drawn.filter((r) => r.tikz === 0);
  check('every component exports a TikZ command', noTikz.length === 0,
    noTikz.map((r) => r.name).join(', '));

  /* -------------------------------- table -------------------------------- */

  lines.push('');
  lines.push('  component        ink  fields  tikz  box');
  lines.push('  ' + '-'.repeat(52));
  for (const r of report) {
    if (!r.drawn) { lines.push(`  ${r.name.padEnd(16)} NOT DRAWN`); continue; }
    lines.push(
      `  ${r.name.padEnd(16)}`
      + `${String(r.shapes + r.texts).padStart(4)}`
      + `${String(r.fields).padStart(8)}`
      + `${String(r.tikz).padStart(6)}`
      + `  ${Math.round(r.box.w)}x${Math.round(r.box.h)}`
      + (r.dead.length ? `   DEAD: ${r.dead.join(', ')}` : ''),
    );
  }

  await page.eval('localStorage.clear(); return true;');
} catch (error) {
  failures++;
  lines.push(`  FATAL ${error.message}`);
}

console.log(lines.join('\n'));
console.log(failures === 0
  ? `\nAll ${checks} component checks passed.`
  : `\n${failures} of ${checks} component checks failed.`);

await page.close();
process.exit(failures === 0 ? 0 : 1);
