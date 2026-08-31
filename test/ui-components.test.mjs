/**
 * Per-component UI audit.
 *
 * The component audit asks whether a shape's data works. This asks whether its
 * *handles* work — the layer a user actually touches. It generalises the
 * force-anchor bug, where the anchor grip and the rotation grip drew at the
 * document origin while the shape sat three hundred pixels away.
 *
 * For all 48 types:
 *   1. the anchor grip lands on the shape, not somewhere else
 *   2. every square handle lands on the shape
 *   3. no two grips sit on top of each other, which would hide one
 *   4. dragging the anchor grip with a real mouse changes the document
 *   5. dragging the rotation grip changes the angle, for every type that has one
 *   6. delete then undo restores the shape and it draws again
 *   7. the document survives a reload byte for byte
 *
 * Run:  node test/ui-components.test.mjs [url]
 */

import { Browser, MOD } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:8124/';
const TOLERANCE = 40;   // px a grip may sit outside the drawn shape

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

const page = await Browser.attach(9222);
const rawEval = page.eval.bind(page);

async function ensureStore() {
  const present = await rawEval('typeof window.__store === "object" && window.__store !== null');
  if (present) return;
  await rawEval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
}
page.eval = async (expression) => {
  if (expression.includes('window.__store')) await ensureStore();
  return rawEval(expression);
};

try {
  await page.open(URL);
  await page.eval('localStorage.clear(); return true;');
  await page.open(URL);
  await ensureStore();

  const names = await page.eval(`
    return import('./src/registry.js').then((reg) => reg.allTypes().map((t) => t.name));
  `);
  check('the registry holds 50 types', names.length === 50, String(names.length));

  const offAnchor = [];      // the anchor grip is nowhere near the shape
  const offHandle = [];      // a square handle is nowhere near the shape
  const stacked = [];        // two grips on the same spot
  const deadAnchor = [];     // dragging the anchor grip does nothing
  const deadRotate = [];     // dragging the rotation grip does nothing
  const brokenUndo = [];     // delete then undo does not bring it back
  const table = [];

  for (const name of names) {
    /* ---------- place it and measure every grip ---------- */
    const shot = await page.eval(`
      const NAME = ${JSON.stringify(name)};
      return Promise.all([
        import('./src/registry.js'),
        import('./src/ui/palette.js'),
      ]).then(async (mods) => {
        const reg = mods[0];
        const palette = mods[1];
        const store = window.__store;
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        store.clear();
        await frame();
        const element = palette.addAt(NAME);
        store.select([element.id]);
        await frame();

        const host = document.getElementById('canvas-host');
        const ctx = host.__ctx;
        const svgBox = host.querySelector('svg').getBoundingClientRect();
        const type = reg.getType(NAME);
        const lookup = (id) => store.byId(id);

        // The shape's own extent, widened by its parent's when it has one:
        // a curve's anchor is its axes corner, which is correct but outside
        // the curve itself.
        const node = host.querySelector('.element[data-id=' + JSON.stringify(element.id) + ']');
        if (!node) return { name: NAME, drawn: false };
        let box = node.getBBox();
        const parentId = type.attachedTo ? type.attachedTo(element) : '';
        if (parentId) {
          const parentNode = host.querySelector('.element[data-id=' + JSON.stringify(parentId) + ']');
          if (parentNode) {
            const p = parentNode.getBBox();
            const minX = Math.min(box.x, p.x);
            const minY = Math.min(box.y, p.y);
            box = {
              x: minX, y: minY,
              width: Math.max(box.x + box.width, p.x + p.width) - minX,
              height: Math.max(box.y + box.height, p.y + p.height) - minY,
            };
          }
        }

        const grips = [...host.querySelectorAll('[data-handle]')].map((n) => ({
          kind: n.dataset.handle,
          x: Number(n.getAttribute('cx') ?? (Number(n.getAttribute('x')) + Number(n.getAttribute('width')) / 2)),
          y: Number(n.getAttribute('cy') ?? (Number(n.getAttribute('y')) + Number(n.getAttribute('height')) / 2)),
        }));

        // How far each grip sits outside the shape's box.
        const outside = (g) => Math.max(
          0, box.x - g.x, g.x - (box.x + box.width),
          0, box.y - g.y, g.y - (box.y + box.height),
        );

        return {
          name: NAME,
          drawn: true,
          id: element.id,
          // A type may call its rotation "angle" or "rotate". Keying only off
          // "angle" is exactly how the label's missing grip went unnoticed.
          spin: ['angle', 'rotate'].find((f) => Object.hasOwn(type.schema.properties, f)) || null,
          parentId,
          box: { x: box.x, y: box.y, w: box.width, h: box.height },
          grips: grips.map((g) => ({ ...g, outside: Math.round(outside(g)) })),
          svgLeft: svgBox.left,
          svgTop: svgBox.top,
        };
      });
    `);

    if (!shot.drawn) { offAnchor.push(`${name} (not drawn)`); continue; }

    const anchor = shot.grips.find((g) => g.kind === 'anchor');
    const squares = shot.grips.filter((g) => g.kind !== 'anchor' && g.kind !== 'rotate');
    const rotate = shot.grips.find((g) => g.kind === 'rotate');

    if (anchor && anchor.outside > TOLERANCE) {
      offAnchor.push(`${name} (${anchor.outside}px away)`);
    }
    for (const square of squares) {
      if (square.outside > TOLERANCE) offHandle.push(`${name} (${square.outside}px away)`);
    }

    // Two grips on the same pixel means one of them cannot be grabbed.
    for (let a = 0; a < shot.grips.length; a++) {
      for (let b = a + 1; b < shot.grips.length; b++) {
        const dx = shot.grips[a].x - shot.grips[b].x;
        const dy = shot.grips[a].y - shot.grips[b].y;
        if (Math.hypot(dx, dy) < 3) {
          stacked.push(`${name} (${shot.grips[a].kind}/${shot.grips[b].kind})`);
        }
      }
    }

    /* ---------- drag the anchor grip with a real mouse ---------- */
    const before = await page.eval('return JSON.stringify(window.__store.doc.elements);');
    if (anchor) {
      const from = { x: shot.svgLeft + anchor.x, y: shot.svgTop + anchor.y };
      await page.drag(from, { x: from.x + 70, y: from.y - 50 }, { steps: 8 });
      await page.settle();
    }
    const afterDrag = await page.eval('return JSON.stringify(window.__store.doc.elements);');
    if (before === afterDrag) deadAnchor.push(name);

    /* ---------- drag the rotation grip ---------- */
    let rotated = null;
    if (shot.spin && rotate) {
      const readSpin = `
        const store = window.__store;
        const el = store.byId(${JSON.stringify(shot.id)});
        const target = ${JSON.stringify(shot.parentId)} ? store.byId(${JSON.stringify(shot.parentId)}) : el;
        const field = ${JSON.stringify(shot.spin)};
        const holder = (target && target[field] !== undefined) ? target : el;
        return { angle: holder ? holder[field] : null };
      `;
      const state = await page.eval(readSpin);

      // Re-read the grip: the shape has moved since it was measured.
      const grip = await page.eval(`
        const host = document.getElementById('canvas-host');
        const n = host.querySelector('.handle-rotate');
        const anchorNode = host.querySelector('.handle-anchor');
        if (!n || !anchorNode) return null;
        const r = host.querySelector('svg').getBoundingClientRect();
        return {
          gx: r.left + Number(n.getAttribute('cx')),
          gy: r.top + Number(n.getAttribute('cy')),
          ax: r.left + Number(anchorNode.getAttribute('cx')),
          ay: r.top + Number(anchorNode.getAttribute('cy')),
        };
      `);

      if (grip) {
        // Swing the grip a quarter turn around the anchor.
        const radius = Math.hypot(grip.gx - grip.ax, grip.gy - grip.ay) || 34;
        const current = Math.atan2(grip.ay - grip.gy, grip.gx - grip.ax);
        const next = current + Math.PI / 2;
        await page.drag(
          { x: grip.gx, y: grip.gy },
          { x: grip.ax + Math.cos(next) * radius, y: grip.ay - Math.sin(next) * radius },
          { steps: 8 },
        );
        await page.settle();

        const now = await page.eval(readSpin);
        rotated = state.angle !== now.angle;
        if (!rotated) deadRotate.push(`${name} (${state.angle} -> ${now.angle})`);
      }
    }

    /* ---------- delete, undo, and draw again ---------- */
    const cycle = await page.eval(`
      const store = window.__store;
      const id = ${JSON.stringify(shot.id)};
      return (async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const had = store.doc.elements.length;
        store.select([id]);
        store.transaction('delete', () => {
          for (const each of [...store.selection]) store.removeElement(each);
        });
        await frame();
        const gone = !store.byId(id);
        store.undo();
        await frame();
        const back = !!store.byId(id);
        const node = document.querySelector('.element[data-id=' + JSON.stringify(id) + ']');
        const redrawn = !!node && (node.getBBox().width > 0.5 || node.getBBox().height > 0.5);
        return { had, gone, back, redrawn, now: store.doc.elements.length };
      })();
    `);
    if (!(cycle.gone && cycle.back && cycle.redrawn && cycle.now === cycle.had)) {
      brokenUndo.push(`${name} (gone=${cycle.gone} back=${cycle.back} drawn=${cycle.redrawn})`);
    }

    table.push({
      name,
      grips: shot.grips.length,
      anchorOff: anchor ? anchor.outside : -1,
      rotate: shot.spin ? (rotated === null ? 'n/a' : (rotated ? 'yes' : 'NO')) : '-',
    });
  }

  /* ---------- affordances every type of its kind must offer ---------- */

  const affordances = await page.eval(`
    return Promise.all([
      import('./src/registry.js'),
      import('./src/render.js'),
    ]).then((mods) => {
      const reg = mods[0];
      const renderModule = mods[1];
      const missingRotate = [];
      const missingSize = [];
      for (const type of reg.allTypes()) {
        const props = type.schema.properties;

        // A type that can be rotated must offer a grip for it. The renderer
        // decides that from its own rotationField(), so ask the renderer.
        const spin = ['angle', 'rotate'].find((name) => Object.hasOwn(props, name));
        if (spin && !renderModule.rotationField(type)) missingRotate.push(type.name);

        // A box with a width and a height must be resizable by dragging, not
        // only by typing two numbers.
        const boxy = Object.hasOwn(props, 'width') && Object.hasOwn(props, 'height');
        if (boxy) {
          const sample = reg.createElement(type.name, {}, new Set());
          const grips = typeof type.handles === 'function' ? (type.handles(sample, () => null) || []) : [];
          const resizes = grips.some((grip) => {
            const changed = grip.set({ x: sample.x + 3, y: sample.y + 3 }) || {};
            return 'width' in changed || 'height' in changed;
          });
          if (!resizes) missingSize.push(type.name);
        }
      }
      return { missingRotate, missingSize };
    });
  `);
  check('every rotatable type offers a rotation grip',
    affordances.missingRotate.length === 0, affordances.missingRotate.join(', '));
  check('every box type can be resized by dragging',
    affordances.missingSize.length === 0, affordances.missingSize.join(', '));

  check('the anchor grip lands on every shape', offAnchor.length === 0,
    offAnchor.slice(0, 6).join(', '));
  check('every square handle lands on its shape', offHandle.length === 0,
    offHandle.slice(0, 6).join(', '));
  check('no two grips sit on top of each other', stacked.length === 0,
    stacked.slice(0, 6).join(', '));
  check('dragging the anchor grip changes the document, for every type',
    deadAnchor.length === 0, deadAnchor.slice(0, 6).join(', '));
  check('the rotation grip rotates, for every type that has one',
    deadRotate.length === 0, deadRotate.slice(0, 6).join(', '));
  check('delete then undo restores and redraws every type',
    brokenUndo.length === 0, brokenUndo.slice(0, 4).join(', '));

  /* ---------- the whole document survives a reload ---------- */
  const roundTrip = await page.eval(`
    return import('./src/registry.js').then((reg) => {
      const store = window.__store;
      store.clear();
      const taken = new Set();
      store.transaction('all types', () => {
        for (const type of reg.allTypes()) store.addElement(type.name, {});
      });
      return JSON.stringify(store.doc);
    });
  `);
  await page.open(URL);
  await ensureStore();
  const restored = await page.eval('return JSON.stringify(window.__store.doc);');
  check('a document holding all 48 types survives a reload unchanged',
    restored === roundTrip,
    restored === roundTrip ? '' : `${roundTrip.length} chars saved, ${restored.length} restored`);

  lines.push('');
  lines.push('  component        grips  anchor off  rotates');
  lines.push('  ' + '-'.repeat(48));
  for (const row of table) {
    lines.push(
      `  ${row.name.padEnd(16)}${String(row.grips).padStart(5)}`
      + `${String(row.anchorOff).padStart(11)}px`
      + `  ${row.rotate}`,
    );
  }

  await page.eval('localStorage.clear(); return true;');
} catch (error) {
  failures++;
  lines.push(`  FATAL ${error.message}`);
}

console.log(lines.join('\n'));
console.log(failures === 0
  ? `\nAll ${checks} UI component checks passed.`
  : `\n${failures} of ${checks} UI component checks failed.`);

await page.close();
process.exit(failures === 0 ? 0 : 1);
