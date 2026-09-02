/**
 * End-to-end tests in a real browser.
 *
 * Everything here goes through synthesised mouse and key events, so it
 * exercises the actual pointer handlers, the CSS layout and the SVG geometry —
 * the parts the Node suites cannot reach.
 *
 * Run:  node test/browser.test.mjs [http://127.0.0.1:8124/]
 * Chrome must already be listening with --remote-debugging-port=9222.
 */

import { Browser, MOD } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:8124/';

let failures = 0;
let checks = 0;
const results = [];

function check(label, condition, extra = '') {
  checks++;
  if (condition) {
    results.push(`  ok   ${label}`);
    return true;
  }
  failures++;
  results.push(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  return false;
}

function section(name) {
  results.push(`\n${name}`);
}

const page = await Browser.attach(9222);

/**
 * The store is module-private, so the tests reach it through window.__store.
 * Any navigation throws that reference away, and tracking which section
 * navigated is a losing game — so every evaluation that mentions it re-imports
 * the module first if it has to.
 */
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

/** Puts the app in a known state: the sample document, nothing selected. */
async function reset() {
  await page.eval(`
    localStorage.clear();
    return true;
  `);
  await page.open(URL);
  await page.settle();
}

/** Reads a single expression out of the live store. */
function store(expression) {
  return page.eval(`
    const mod = window.__store;
    return (${expression});
  `);
}

/** Runs a block of statements against the live store. It must return. */
function storeRun(code) {
  return page.eval(`
    const mod = window.__store;
    ${code}
  `);
}

/**
 * A viewport point that actually hits the given shape.
 *
 * The centre of a group's bounding box is often empty space — a diagonal
 * arrow's box is mostly air, and a label pushes the centre off the geometry.
 * Worse, another shape drawn later may cover that pixel. So scan for a point
 * whose topmost element really is the one wanted.
 */
function pointOn(id) {
  return page.eval(`
    const target = document.querySelector('.element[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
    if (!target) return null;
    const raw = target.getBoundingClientRect();
    // Inflate by two pixels: a perfectly vertical line has a zero-width box,
    // so ceil(left) > floor(right) and the scan would never run at all.
    const box = {
      left: raw.left - 2, right: raw.right + 2,
      top: raw.top - 2, bottom: raw.bottom + 2,
    };
    const id = target.getAttribute('data-id');

    // Whole pixels only: a synthesised mouse event is dispatched at integer
    // coordinates, and rounding a fractional hit can slide off a thin line.
    // A hit on the shape's own anchor grip counts, because dragging that grip
    // moves the shape — for a small marker it is the only reachable point.
    for (let y = Math.ceil(box.top); y <= Math.floor(box.bottom); y++) {
      for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x++) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit.closest('.element') === target) return { x, y };
        if (hit.dataset && hit.dataset.handle === 'anchor' && hit.dataset.id === id) return { x, y };
      }
    }
    return null;
  `);
}

try {
  // The app autosaves, so a previous run would otherwise leak into this one.
  await page.open(URL);
  await page.eval('localStorage.clear(); return true;');
  await page.open(URL);

  // The store is module-private, so expose it once for the tests to read.
  await page.eval(`
    return import('./src/store.js').then((m) => { window.__store = m.store; return true; });
  `);

  /* ------------------------------------------------------------------ */
  section('boot');
  {
    check('the sheet renders', await page.eval('!!document.querySelector("#canvas-host svg")'));
    check('the sample document loaded',
      await store('mod.doc.elements.length') === 9,
      String(await store('mod.doc.elements.length')));
    check('the palette is populated',
      await page.eval('document.querySelectorAll(".palette-item").length') === 50,
      String(await page.eval('document.querySelectorAll(".palette-item").length')));
    check('all seven groups render',
      await page.eval('document.querySelectorAll(".palette-group").length') === 7);
    check('the status bar reports the shape count',
      (await page.eval('document.getElementById("status").textContent')).includes('9 shapes'),
      await page.eval('document.getElementById("status").textContent'));
    check('no console error on boot',
      await page.eval('!window.__bootError'));
  }

  /* ------------------------------------------------------------------ */
  section('selection');
  {
    const body = await pointOn('block');
    check('a hittable point on the body was found', body !== null);
    await page.click(body.x, body.y);
    await page.settle();
    check('clicking a shape selects it',
      JSON.stringify(await store('mod.selection')) === '["block"]',
      JSON.stringify(await store('mod.selection')));

    check('the properties panel shows the type',
      (await page.eval('document.querySelector(".inspector-head strong")?.textContent')) === 'Body');

    check('handles appear for the selection',
      await page.eval('document.querySelectorAll("[data-layer=handles] .handle").length') > 0);

    check('a rotation grip appears for a shape with an angle',
      await page.eval('!!document.querySelector(".handle-rotate")'));

    // Shift-click a second shape.
    const weight = await pointOn('weight');
    await page.click(weight.x, weight.y, { modifiers: MOD.shift });
    await page.settle();
    check('shift-click adds to the selection',
      await store('mod.selection.length') === 2,
      JSON.stringify(await store('mod.selection')));

    check('the panel switches to the multi view',
      (await page.eval('document.querySelector(".inspector-head strong")?.textContent') || '').includes('2 shapes'));

    check('align tools appear for a multi selection',
      await page.eval('[...document.querySelectorAll(".section-title")].some((n) => n.textContent === "Arrange")'));

    await page.key('Escape');
    await page.settle();
    check('Escape clears the selection', await store('mod.selection.length') === 0);
  }

  /* ------------------------------------------------------------------ */
  section('marquee');
  {
    const host = await page.centreOf('#canvas-host svg');
    // Sweep the whole sheet.
    await page.drag(
      { x: host.left + 6, y: host.top + 6 },
      { x: host.left + host.width - 6, y: host.top + host.height - 6 },
      { steps: 10 },
    );
    await page.settle();
    check('a marquee over everything selects everything',
      await store('mod.selection.length') === 9,
      String(await store('mod.selection.length')));
    check('the marquee rectangle is removed afterwards',
      await page.eval('!document.querySelector(".marquee")'));

    await page.key('Escape');
    await page.settle();
  }

  /* ------------------------------------------------------------------ */
  section('drag to move');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const before = await store('({ x: mod.byId("block").x, y: mod.byId("block").y })');
    const body = await pointOn('block');

    await page.drag({ x: body.x, y: body.y }, { x: body.x + 80, y: body.y }, { steps: 8 });
    await page.settle();

    const after = await store('({ x: mod.byId("block").x, y: mod.byId("block").y })');
    const grid = await store('mod.doc.canvas.grid');
    check('dragging a shape moves it right', after.x > before.x, `${before.x} -> ${after.x}`);
    check('dragging does not move it vertically', Math.abs(after.y - before.y) < 0.001,
      `y ${before.y} -> ${after.y}`);
    // Derived from the live grid, not hard coded: the default step may change.
    check('the move snapped to the grid',
      Math.abs(after.x / grid - Math.round(after.x / grid)) < 1e-6,
      `${after.x} is not a multiple of ${grid}`);

    // Its attached forces follow, because they reference the body.
    check('a force attached to the body follows it',
      await store('mod.byId("weight").bodyId') === 'block');

    await page.key('z', { modifiers: MOD.ctrl, code: 'KeyZ', keyCode: 90 });
    await page.settle();
    const undone = await store('mod.byId("block").x');
    check('one drag undoes in one step', Math.abs(undone - before.x) < 0.001,
      `${before.x} vs ${undone}`);
  }

  /* ------------------------------------------------------------------ */
  section('handle and rotation drags');
  {
    const force = await pointOn('normal');
    check('a hittable point on the force was found', force !== null);
    await page.click(force.x, force.y);
    await page.settle();
    check('a force can be selected', await store('mod.selection[0]') === 'normal');

    const magnitudeBefore = await store('mod.byId("normal").magnitude');
    const handle = await page.centreOf('.handle-point');
    if (check('the force has a square handle', handle !== null)) {
      await page.drag({ x: handle.x, y: handle.y }, { x: handle.x + 40, y: handle.y - 40 }, { steps: 6 });
      await page.settle();
      const magnitudeAfter = await store('mod.byId("normal").magnitude');
      check('dragging the handle changes the magnitude',
        Math.abs(magnitudeAfter - magnitudeBefore) > 0.01,
        `${magnitudeBefore} -> ${magnitudeAfter}`);
    }

    // Rotation grip on the body.
    const body = await pointOn('block');
    await page.click(body.x, body.y);
    await page.settle();
    check('the body is the selection before rotating',
      await store('mod.selection[0]') === 'block', await store('mod.selection[0]'));
    const angleBefore = await store('mod.byId("block").angle');
    const grip = await page.centreOf('.handle-rotate');
    if (check('the body has a rotation grip', grip !== null)) {
      const anchor = await page.eval(`
        const host = document.getElementById('canvas-host');
        const svgBox = host.querySelector('svg').getBoundingClientRect();
        const point = host.__ctx.S(window.__store.byId('block').x, window.__store.byId('block').y);
        return { x: svgBox.left + point.x, y: svgBox.top + point.y };
      `);
      await page.drag({ x: grip.x, y: grip.y }, { x: anchor.x, y: anchor.y - 70 }, { steps: 8 });
      await page.settle();
      const angleAfter = await store('mod.byId("block").angle');
      check('dragging the grip rotates the shape',
        Math.abs(angleAfter - angleBefore) > 1, `${angleBefore} -> ${angleAfter}`);
    }
  }

  /* ------------------------------------------------------------------ */
  section('palette');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const countBefore = await store('mod.doc.elements.length');
    const tile = await page.centreOf('.palette-item[data-type="spring"]');
    await page.click(tile.x, tile.y);
    await page.settle();
    check('clicking a palette tile adds that shape',
      await store('mod.doc.elements.length') === countBefore + 1);
    check('the new shape is the right type',
      await store('mod.selected()[0].type') === 'spring',
      await store('mod.selected()[0]?.type'));
    check('the new shape is selected', await store('mod.selection.length') === 1);

    // The search box filters.
    await page.eval(`
      const box = document.querySelector('.palette-filter');
      box.value = 'lens';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await page.settle(1);
    // Counting matches ties the test to the type list. Assert the property
    // that matters: everything still shown mentions what was typed.
    const shown = await page.eval(
      '[...document.querySelectorAll(".palette-item")].filter((n) => !n.hidden).map((n) => n.textContent.toLowerCase())');
    check('the search box filters the palette',
      shown.length > 0 && shown.length < 10 && shown.every((t) => t.includes('lens')),
      JSON.stringify(shown));
    check('empty groups hide themselves',
      await page.eval('[...document.querySelectorAll(".palette-group")].filter((n) => !n.hidden).length') === 1);

    await page.eval(`
      const box = document.querySelector('.palette-filter');
      box.value = '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await page.settle(1);
    check('clearing the search restores every shape',
      await page.eval('[...document.querySelectorAll(".palette-item")].filter((n) => !n.hidden).length') === 50);
  }

  /* ------------------------------------------------------------------ */
  section('duplicate, copy and paste');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    // Select the body and one of its forces, then duplicate.
    await page.eval(`window.__store.select(['block', 'weight']); return true;`);
    await page.settle();
    await page.key('d', { modifiers: MOD.ctrl, code: 'KeyD', keyCode: 68 });
    await page.settle();

    check('Ctrl+D duplicates the selection',
      await store('mod.doc.elements.length') === 11,
      String(await store('mod.doc.elements.length')));
    check('the copied force points at the copied body',
      await storeRun(`
        const copies = mod.selected();
        const b = copies.find((e) => e.type === 'body');
        const f = copies.find((e) => e.type === 'force');
        return !!b && !!f && f.bodyId === b.id;
      `));
    check('the original force still points at the original body',
      await store('mod.byId("weight").bodyId') === 'block');

    await page.key('z', { modifiers: MOD.ctrl, code: 'KeyZ', keyCode: 90 });
    await page.settle();
    check('undo removes the whole duplicate',
      await store('mod.doc.elements.length') === 9);

    // Copy and paste.
    await page.eval(`window.__store.select(['block']); return true;`);
    await page.key('c', { modifiers: MOD.ctrl, code: 'KeyC', keyCode: 67 });
    await page.key('v', { modifiers: MOD.ctrl, code: 'KeyV', keyCode: 86 });
    await page.settle();
    check('Ctrl+C then Ctrl+V pastes',
      await store('mod.doc.elements.length') === 10,
      String(await store('mod.doc.elements.length')));
  }

  /* ------------------------------------------------------------------ */
  section('keyboard');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    await page.eval(`window.__store.select(['block']); return true;`);
    await page.settle();

    const grid = await store('mod.doc.canvas.grid');
    const start = await store('mod.byId("block").x');
    await page.key('ArrowRight', { code: 'ArrowRight', keyCode: 39 });
    await page.settle();
    const nudged = await store('mod.byId("block").x');
    check('an arrow key nudges a quarter grid step',
      Math.abs((nudged - start) - grid / 4) < 1e-6, `${start} -> ${nudged}, grid ${grid}`);

    await page.key('ArrowRight', { code: 'ArrowRight', keyCode: 39, modifiers: MOD.shift });
    await page.settle();
    check('Shift and an arrow key nudges a full step',
      Math.abs((await store('mod.byId("block").x')) - nudged - grid) < 1e-6);

    await page.key('a', { modifiers: MOD.ctrl, code: 'KeyA', keyCode: 65 });
    await page.settle();
    check('Ctrl+A selects everything', await store('mod.selection.length') === 9);

    await page.eval(`window.__store.select(['block']); return true;`);
    await page.key('Delete', { code: 'Delete', keyCode: 46 });
    await page.settle();
    check('Delete removes the selection',
      await store('mod.doc.elements.length') === 8,
      String(await store('mod.doc.elements.length')));
    check('a reference to the deleted shape is cleared',
      await store('mod.byId("weight").bodyId') === '');
  }

  /* ------------------------------------------------------------------ */
  section('the drawing space');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    // Sheet grip: drag the right edge outwards. Fit first, so the whole sheet
    // is on screen — otherwise the east grip sits outside the viewport.
    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Fit').click();
      return true;
    `);
    await page.settle();

    const widthBefore = await store('mod.doc.canvas.width');
    const grip = await page.centreOf('.sheet-grip-e');
    check('the east grip is on screen',
      grip !== null && grip.x > 0 && grip.x < await page.eval('window.innerWidth'),
      JSON.stringify(grip));
    if (check('the sheet has an east grip', grip !== null)) {
      await page.drag({ x: grip.x, y: grip.y }, { x: grip.x + 120, y: grip.y }, { steps: 8 });
      await page.settle();
      const widthAfter = await store('mod.doc.canvas.width');
      check('dragging the east grip widens the sheet', widthAfter > widthBefore,
        `${widthBefore} -> ${widthAfter}`);

      await page.key('z', { modifiers: MOD.ctrl, code: 'KeyZ', keyCode: 90 });
      await page.settle();
      check('a whole resize drag undoes in one step',
        await store('mod.doc.canvas.width') === widthBefore,
        String(await store('mod.doc.canvas.width')));
    }

    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Fit').click();
      return true;
    `);
    await page.settle();
    const gripN = await page.centreOf('.sheet-grip-n');
    if (check('the sheet has a north grip', gripN !== null)) {
      const heightBefore = await store('mod.doc.canvas.height');
      await page.drag({ x: gripN.x, y: gripN.y }, { x: gripN.x, y: gripN.y - 120 }, { steps: 8 });
      await page.settle();
      check('dragging the north grip heightens the sheet',
        await store('mod.doc.canvas.height') > heightBefore,
        `${heightBefore} -> ${await store('mod.doc.canvas.height')}`);
    }

    // Splitter: drag the left divider inwards.
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    const splitter = await page.centreOf('.splitter[data-side="left"]');
    const paneBefore = (await page.centreOf('.pane-left')).width;
    await page.drag({ x: splitter.x, y: splitter.y }, { x: splitter.x - 60, y: splitter.y }, { steps: 8 });
    await page.settle();
    const paneAfter = (await page.centreOf('.pane-left')).width;
    check('dragging the splitter narrows the panel', paneAfter < paneBefore - 30,
      `${paneBefore} -> ${paneAfter}`);

    // Toolbar toggle collapses the panel entirely.
    await page.eval(`
      const buttons = [...document.querySelectorAll('.toolbar button')];
      buttons.find((b) => b.title.includes('shapes panel')).click();
      return true;
    `);
    await page.settle();
    check('the toolbar button collapses the shapes panel',
      await page.eval('document.querySelector(".layout").classList.contains("left-collapsed")'));
    check('the canvas is still visible when a panel is collapsed',
      (await page.centreOf('#canvas-host svg')).width > 100,
      String((await page.centreOf('#canvas-host svg'))?.width));

    // Fit.
    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Fit').click();
      return true;
    `);
    await page.settle();
    const sheet = await page.centreOf('#canvas-host svg');
    const host = await page.centreOf('#canvas-host');
    check('Fit keeps the sheet inside the viewport',
      sheet.width <= host.width + 1 && sheet.height <= host.height + 1,
      `sheet ${Math.round(sheet.width)}x${Math.round(sheet.height)} host ${Math.round(host.width)}x${Math.round(host.height)}`);
  }

  /* ------------------------------------------------------------------ */
  section('zoom and pan');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const scaleBefore = await store('mod.view.scale');
    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === '+').click();
      return true;
    `);
    await page.settle();
    check('the zoom button increases the scale',
      await store('mod.view.scale') > scaleBefore,
      `${scaleBefore} -> ${await store('mod.view.scale')}`);

    // Ctrl and the wheel.
    const host = await page.centreOf('#canvas-host');
    const scaleMid = await store('mod.view.scale');
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(host.x), y: Math.round(host.y),
      deltaX: 0, deltaY: -120, modifiers: MOD.ctrl,
    });
    await page.settle();
    check('Ctrl and the wheel zooms in',
      await store('mod.view.scale') > scaleMid,
      `${scaleMid} -> ${await store('mod.view.scale')}`);

    // Middle-drag pans by scrolling.
    const scrollBefore = await page.eval('document.getElementById("canvas-host").scrollLeft');
    await page.drag({ x: host.x, y: host.y }, { x: host.x - 100, y: host.y },
      { button: 'middle', buttons: 4, steps: 6 });
    await page.settle();
    check('a middle drag pans the view',
      await page.eval('document.getElementById("canvas-host").scrollLeft') !== scrollBefore,
      String(await page.eval('document.getElementById("canvas-host").scrollLeft')));
  }

  /* ------------------------------------------------------------------ */
  section('properties panel');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    await page.eval(`window.__store.select(['weight']); return true;`);
    await page.settle();

    check('fields are grouped into sections',
      await page.eval('document.querySelectorAll("#inspector .section").length') >= 3);
    check('a field label is human readable',
      await page.eval(`
        const labels = [...document.querySelectorAll('#inspector .field-label')].map((n) => n.textContent);
        return labels.includes('Line width') && labels.includes('Acts on body');
      `));
    check('a bounded number gets a slider',
      await page.eval('document.querySelectorAll("#inspector .slider").length') > 0);
    check('a colour field gets a picker and a text box',
      await page.eval('document.querySelectorAll("#inspector .colour-pair").length') > 0);

    // Editing a field updates the document.
    await page.eval(`
      const rows = [...document.querySelectorAll('#inspector .field')];
      const row = rows.find((r) => r.querySelector('.field-label').textContent === 'Magnitude');
      const input = row.querySelector('input[type=number]');
      input.value = '4.5';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await page.settle();
    check('editing a field updates the shape',
      await store('mod.byId("weight").magnitude') === 4.5,
      String(await store('mod.byId("weight").magnitude')));

    // An invalid value is refused with a message.
    await page.eval(`
      const rows = [...document.querySelectorAll('#inspector .field')];
      const row = rows.find((r) => r.querySelector('.field-label').textContent === 'Magnitude');
      const input = row.querySelector('input[type=number]');
      input.value = '-99';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await page.settle();
    check('an out-of-range value is refused',
      await store('mod.byId("weight").magnitude') === 4.5);
    check('the panel shows why',
      await page.eval('!document.querySelector("#inspector .problem")?.hidden'));
  }

  /* ------------------------------------------------------------------ */
  section('outline and context menu');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    check('the outline lists every shape',
      await page.eval('document.querySelectorAll(".outline-item").length') === 9,
      String(await page.eval('document.querySelectorAll(".outline-item").length')));
    check('the outline shows rendered labels, not LaTeX',
      !(await page.eval('document.querySelector("#outline").textContent')).includes('\\\\vec'));

    const row = await page.centreOf('.outline-item');
    await page.click(row.x, row.y);
    await page.settle();
    check('clicking an outline row selects that shape',
      await store('mod.selection.length') === 1);

    // Right click opens the menu.
    const body = await pointOn('block');
    await page.mouse('mousePressed', body.x, body.y, { button: 'right', buttons: 2 });
    await page.mouse('mouseReleased', body.x, body.y, { button: 'right', buttons: 0 });
    await page.settle();
    check('right click opens the context menu',
      await page.eval('!!document.querySelector(".context-menu")'));
    check('the menu offers duplicate',
      (await page.eval('document.querySelector(".context-menu")?.textContent') || '').includes('Duplicate'));

    await page.key('Escape');
    await page.settle();
    check('Escape closes the context menu',
      await page.eval('!document.querySelector(".context-menu")'));
  }

  /* ------------------------------------------------------------------ */
  section('exports and dialogs');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'TikZ').click();
      return true;
    `);
    await page.settle();
    check('the TikZ dialog opens',
      await page.eval('document.getElementById("tikz-dialog").open'));
    const tikz = await page.eval('document.getElementById("tikz-output").value');
    check('the TikZ source is complete',
      tikz.includes('\\begin{tikzpicture}') && tikz.includes('\\end{tikzpicture}'));
    check('the TikZ source names the shapes', tikz.includes('% weight (force)'));
    check('no NaN reaches the export', !tikz.includes('NaN'));

    await page.eval(`document.getElementById('tikz-dialog').close(); return true;`);
    await page.settle();

    // SVG export builds a real document.
    const svgSource = await page.eval(`
      return import('./src/export/svg.js').then((m) => {
        const store = window.__store;
        return m.toSvgSource(store.doc, store.view);
      });
    `);
    check('the SVG export is well formed',
      svgSource.startsWith('<?xml') && svgSource.includes('</svg>'));
    check('the SVG export drops the grid and the handles',
      !svgSource.includes('data-layer="grid"') && !svgSource.includes('data-layer="handles"'));

    // PNG export actually rasterises.
    const png = await page.eval(`
      return import('./src/export/png.js').then((m) => {
        const store = window.__store;
        return m.toPngDataUrl(store.doc, store.view, { scale: 1 });
      });
    `);
    check('the PNG export produces an image', typeof png === 'string' && png.startsWith('data:image/png;base64,'));
    check('the PNG is not empty', png.length > 5000, `${png.length} chars`);

    // Shortcuts dialog.
    await page.eval(`document.getElementById('help-button').click(); return true;`);
    await page.settle();
    check('the shortcuts dialog opens',
      await page.eval('document.getElementById("help-dialog").open'));
    await page.eval(`document.getElementById('help-dialog').close(); return true;`);
  }

  /* ------------------------------------------------------------------ */
  section('theme and persistence');
  {
    await page.eval(`
      [...document.querySelectorAll('.toolbar button')].find((b) => b.title?.startsWith('Theme')).click();
      return true;
    `);
    await page.settle();
    check('the theme button sets an explicit theme',
      ['light', 'dark'].includes(await page.eval('document.documentElement.getAttribute("data-theme")')),
      await page.eval('document.documentElement.getAttribute("data-theme")'));

    check('the theme is remembered',
      typeof (await page.eval('localStorage.getItem("diagram-studio:theme")')) === 'string');

    // The document autosaves and restores.
    await page.eval(`window.__store.select([]); window.__store.addElement('lens', { x: 5, y: 5 }); return true;`);
    await page.settle();
    const total = await store('mod.doc.elements.length');
    await page.open(URL);
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    await page.settle();
    check('the document survives a reload',
      await store('mod.doc.elements.length') === total,
      `${total} vs ${await store('mod.doc.elements.length')}`);
  }

  /* ------------------------------------------------------------------ */
  section('every shape renders on the real canvas');
  {
    await page.eval('localStorage.clear(); return true;');
    await page.open(URL);
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const report = await page.eval(`
      return import('./src/registry.js').then((reg) => {
        const store = window.__store;
        const bad = [];
        for (const type of reg.allTypes()) {
          store.clear();
          try {
            store.addElement(type.name, {});
          } catch (error) {
            bad.push(type.name + ': ' + error.message);
          }
        }
        return { total: reg.allTypes().length, bad };
      });
    `);
    check('every one of the 48 shapes can be added', report.bad.length === 0,
      report.bad.slice(0, 3).join(' | '));
    check('the registry holds 50 types', report.total === 50, String(report.total));

    // And each one draws something with a real bounding box.
    const empty = await page.eval(`
      return import('./src/registry.js').then(async (reg) => {
        const store = window.__store;
        const blank = [];
        for (const type of reg.allTypes()) {
          store.clear();
          store.addElement(type.name, {});
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const node = document.querySelector('#canvas-host .element');
          if (!node) { blank.push(type.name + ' (no node)'); continue; }
          const box = node.getBBox();
          if (box.width < 0.5 && box.height < 0.5) blank.push(type.name + ' (empty box)');
        }
        return blank;
      });
    `);
    check('every shape draws a non-empty box', empty.length === 0,
      empty.slice(0, 5).join(', '));
  }

  /* ------------------------------------------------------------------ */
  section('every component: add, place and move');
  {
    // The reported bug: a new shape landed at the origin and could not be
    // dragged. Every type is now added through the palette click path, then
    // dragged with a real mouse, and both are checked.
    const names = await page.eval(`
      return import('./src/registry.js').then((reg) => reg.allTypes().map((t) => t.name));
    `);
    check('there are 50 component types', names.length === 50, String(names.length));

    const stuck = [];
    const immobile = [];
    const missing = [];

    for (const name of names) {
      await page.eval(`
        window.__store.clear();
        return import('./src/ui/palette.js').then((p) => { p.addAt(${JSON.stringify(name)}); return true; });
      `);
      await page.settle();

      const placed = await page.eval(`
        const store = window.__store;
        const el = store.doc.elements.find((e) => e.type === ${JSON.stringify(name)});
        if (!el) return null;
        const host = document.getElementById('canvas-host');
        const node = host.querySelector('.element[data-id=' + JSON.stringify(el.id) + ']');
        if (!node) return { id: el.id, drawn: false };
        const box = node.getBBox();
        return {
          id: el.id, drawn: true,
          cx: box.x + box.width / 2, cy: box.y + box.height / 2,
          w: box.width, h: box.height,
          sheetW: host.querySelector('svg').viewBox.baseVal.width,
          sheetH: host.querySelector('svg').viewBox.baseVal.height,
        };
      `);

      if (!placed || !placed.drawn) { missing.push(name); continue; }

      // "Stuck in the bottom left" means the drawn centre sits in the first
      // fifth of the sheet horizontally and the last fifth vertically.
      if (placed.cx < placed.sheetW * 0.2 && placed.cy > placed.sheetH * 0.8) {
        stuck.push(`${name} (${Math.round(placed.cx)},${Math.round(placed.cy)})`);
      }

      // Now drag it and see whether anything actually moved.
      const before = await page.eval(`return JSON.stringify(window.__store.doc.elements);`);
      const grab = await pointOn(placed.id);
      if (!grab) { immobile.push(`${name} (unhittable)`); continue; }

      await page.drag({ x: grab.x, y: grab.y }, { x: grab.x + 60, y: grab.y - 40 }, { steps: 6 });
      await page.settle();
      const after = await page.eval(`return JSON.stringify(window.__store.doc.elements);`);
      if (before === after) immobile.push(name);
    }

    check('every component draws when added', missing.length === 0, missing.join(', '));
    check('no component lands stuck in the bottom left corner',
      stuck.length === 0, stuck.slice(0, 6).join(', '));
    check('every component can be dragged', immobile.length === 0,
      immobile.slice(0, 6).join(', '));
  }

  /* ------------------------------------------------------------------ */
  section('growing the sheet from every side');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    for (const edge of ['e', 'n', 'w', 's']) {
      await page.eval(`
        [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Fit').click();
        return true;
      `);
      await page.settle();

      const state = await page.eval(`
        const store = window.__store;
        return {
          w: store.doc.canvas.width, h: store.doc.canvas.height,
          bx: store.byId('block').x, by: store.byId('block').y,
        };
      `);
      const grip = await page.centreOf('.sheet-grip-' + edge);
      if (!check(`the ${edge} grip is on screen`, grip !== null && grip.x > 0)) continue;

      const to = {
        e: { x: grip.x + 90, y: grip.y },
        w: { x: grip.x - 90, y: grip.y },
        n: { x: grip.x, y: grip.y - 90 },
        s: { x: grip.x, y: grip.y + 90 },
      }[edge];

      await page.drag({ x: grip.x, y: grip.y }, to, { steps: 8 });
      await page.settle();

      const next = await page.eval(`
        const store = window.__store;
        return {
          w: store.doc.canvas.width, h: store.doc.canvas.height,
          bx: store.byId('block').x, by: store.byId('block').y,
        };
      `);

      const grewX = edge === 'e' || edge === 'w';
      check(`dragging the ${edge} grip enlarges the sheet`,
        grewX ? next.w > state.w : next.h > state.h,
        `${state.w}x${state.h} -> ${next.w}x${next.h}`);

      // Growing from the west or the south must carry the drawing with it.
      if (edge === 'w') {
        check('growing west keeps the drawing in place',
          Math.abs((next.bx - state.bx) - (next.w - state.w)) < 0.001,
          `shape moved ${next.bx - state.bx}, sheet grew ${next.w - state.w}`);
      }
      if (edge === 's') {
        check('growing south keeps the drawing in place',
          Math.abs((next.by - state.by) - (next.h - state.h)) < 0.001,
          `shape moved ${next.by - state.by}, sheet grew ${next.h - state.h}`);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  section('a parent and its follower move once, not twice');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const before = await page.eval(`
      const store = window.__store;
      const ctx = document.getElementById('canvas-host').__ctx;
      const f = store.byId('weight');
      const b = store.byId('block');
      return { fx: b.x + f.offsetX, bx: b.x };
    `);

    await page.eval(`window.__store.select(['block', 'weight']); return true;`);
    await page.settle();
    const grab = await pointOn('block');
    await page.drag({ x: grab.x, y: grab.y }, { x: grab.x + 80, y: grab.y }, { steps: 8 });
    await page.settle();

    const after = await page.eval(`
      const store = window.__store;
      const f = store.byId('weight');
      const b = store.byId('block');
      return { fx: b.x + f.offsetX, bx: b.x };
    `);
    check('a force keeps its offset when moved with its body',
      Math.abs((after.fx - before.fx) - (after.bx - before.bx)) < 0.001,
      `force moved ${(after.fx - before.fx).toFixed(2)}, body moved ${(after.bx - before.bx).toFixed(2)}`);
  }

  /* ------------------------------------------------------------------ */
  section('DOM hygiene');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    // Several SVGs share one page. url(#id) resolves against the whole
    // document, so a repeated marker id makes an arrow borrow another SVG's
    // arrowhead — and its colour.
    const dupes = await page.eval(`
      const seen = new Map();
      for (const node of document.querySelectorAll('[id]')) {
        seen.set(node.id, (seen.get(node.id) || 0) + 1);
      }
      return [...seen].filter((pair) => pair[1] > 1).map((pair) => pair[0] + ' x' + pair[1]);
    `);
    check('no element id is repeated anywhere on the page', dupes.length === 0,
      dupes.slice(0, 5).join(', '));

    check('a canvas arrow resolves to a marker inside the canvas',
      await page.eval(`
        const canvas = document.querySelector('#canvas-host svg');
        const user = canvas.querySelector('[marker-end]');
        if (!user) return true;
        const id = user.getAttribute('marker-end').slice(5, -1);
        const marker = document.getElementById(id);
        return !!marker && canvas.contains(marker);
      `));

    const before = await page.eval('document.querySelectorAll("#canvas-host svg *").length');
    await page.eval(`
      for (let i = 0; i < 30; i++) window.__store.emit('churn');
      return true;
    `);
    await page.settle();
    const after = await page.eval('document.querySelectorAll("#canvas-host svg *").length');
    check('thirty redraws do not grow the DOM', Math.abs(after - before) <= 2,
      before + ' -> ' + after);
  }

  /* ------------------------------------------------------------------ */
  section('export validity');
  {
    // Every type's SVG export must parse as XML. An unescaped ampersand in a
    // label would make the downloaded file unopenable.
    const bad = await page.eval(`
      return Promise.all([
        import('./src/registry.js'),
        import('./src/export/svg.js'),
      ]).then((mods) => {
        const reg = mods[0];
        const svgExport = mods[1];
        const store = window.__store;
        const parser = new DOMParser();
        const broken = [];
        for (const type of reg.allTypes()) {
          store.clear();
          store.addElement(type.name, { label: 'a & b < c > d' });
          const source = svgExport.toSvgSource(store.doc, store.view);
          const parsed = parser.parseFromString(source, 'image/svg+xml');
          const err = parsed.querySelector('parsererror');
          if (err) broken.push(type.name + ': ' + err.textContent.slice(0, 60));
        }
        return broken;
      });
    `);
    check('every type exports parseable SVG', bad.length === 0, bad.slice(0, 3).join(' | '));

    const rawAmp = await page.eval(`
      return import('./src/export/svg.js').then((m) => {
        const store = window.__store;
        store.clear();
        store.addElement('label', { text: 'a & b', x: 5, y: 5 });
        const source = m.toSvgSource(store.doc, store.view);
        return /&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(source);
      });
    `);
    check('an ampersand in a label is entity encoded', rawAmp === false);
  }

  /* ------------------------------------------------------------------ */
  section('stress');
  {
    const timing = await page.eval(`
      return import('./src/registry.js').then(async (reg) => {
        const store = window.__store;
        store.clear();
        const names = reg.allTypes().map((t) => t.name);
        store.transaction('crowd', () => {
          for (let i = 0; i < 300; i++) store.addElement(names[i % names.length], {});
        });
        const started = performance.now();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          ms: performance.now() - started,
          drawn: document.querySelectorAll('#canvas-host .element').length,
          total: store.doc.elements.length,
        };
      });
    `);
    check('three hundred shapes all draw', timing.drawn === timing.total,
      timing.drawn + ' of ' + timing.total);
    check('a crowded sheet draws in under two seconds', timing.ms < 2000,
      Math.round(timing.ms) + 'ms');

    await page.key('a', { modifiers: MOD.ctrl, code: 'KeyA', keyCode: 65 });
    await page.settle();
    await page.key('Delete', { code: 'Delete', keyCode: 46 });
    await page.settle();
    check('select all then delete empties the sheet',
      await store('mod.doc.elements.length') === 0,
      String(await store('mod.doc.elements.length')));

    await page.key('z', { modifiers: MOD.ctrl, code: 'KeyZ', keyCode: 90 });
    await page.settle();
    check('one undo brings all three hundred back',
      await store('mod.doc.elements.length') === 300,
      String(await store('mod.doc.elements.length')));

    // Rapid clicking must not corrupt the selection or the history.
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    const spot = await pointOn('block');
    for (let index = 0; index < 12; index++) await page.click(spot.x, spot.y);
    await page.settle();
    check('rapid clicking leaves exactly one selection',
      await store('mod.selection.length') === 1,
      String(await store('mod.selection.length')));
    check('rapid clicking changes nothing else',
      await store('mod.doc.elements.length') === 9);

    // A drag released outside the window must still end the drag.
    await page.mouse('mousePressed', spot.x, spot.y);
    await page.mouse('mouseMoved', spot.x + 40, spot.y + 20);
    await page.mouse('mouseReleased', -50, -50);
    await page.settle();
    const survived = await store('Number.isFinite(mod.byId("block").x)');
    await page.click(spot.x + 220, spot.y + 200);
    await page.settle();
    check('a drag released off-window ends cleanly',
      survived === true && await store('mod.selection.length') === 0);
  }

  /* ------------------------------------------------------------------ */
  section('storage failure');
  {
    // A private window makes localStorage throw on every access.
    await page.eval(`
      window.__realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('denied', 'SecurityError'); },
      });
      return true;
    `);
    const result = await page.eval(`
      return import('./src/store.js').then((m) => {
        try {
          m.store.addElement('body', { x: 3, y: 3 });
          m.store.undo();
          return { ok: true, restored: m.store.restore() };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
    `);
    check('the store works when localStorage throws', result.ok === true, result.error || '');
    check('restore reports failure rather than throwing', result.restored === false);

    await page.eval(`
      Object.defineProperty(window, 'localStorage', window.__realStorage);
      return true;
    `);
  }

  /* ------------------------------------------------------------------ */
  section('QA regressions');
  {
    // BUG-01/02/03: below the responsive threshold the panes were pinned to
    // grid columns that no longer existed, so the shapes panel collapsed to
    // the width of its own scrollbar and both splitters to zero.
    // The threshold is 1024px: a media query resolves rem against the initial
    // 16px font size, not the 15px on :root.
    for (const width of [900, 1000, 1023]) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await page.open(URL);
      await page.settle();

      const narrow = await page.eval(`
        const w = (sel) => {
          const n = document.querySelector(sel);
          if (!n) return null;
          const r = n.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        };
        return {
          matches: window.matchMedia('(max-width: 64rem)').matches,
          left: w('.pane-left'),
          canvas: w('.pane-canvas'),
          right: w('.pane-right'),
          items: [...document.querySelectorAll('.palette-item')]
            .filter((n) => n.getBoundingClientRect().width > 10).length,
        };
      `);

      check(`at ${width}px the shapes panel is usable`,
        narrow.left.w > 200 && narrow.left.h > 100,
        JSON.stringify(narrow.left));
      check(`at ${width}px the palette buttons are reachable`,
        narrow.items >= 40, String(narrow.items));
      check(`at ${width}px the canvas keeps its width`,
        narrow.canvas.w > 200, JSON.stringify(narrow.canvas));
      check(`at ${width}px the properties panel is usable`,
        narrow.right.w > 200, JSON.stringify(narrow.right));
    }

    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.open(URL);
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);
    await page.settle();

    // BUG-04: the anchor grip and the rotation grip of a body-attached force
    // drew at the document origin instead of at the arrow's tail.
    const grips = await page.eval(`
      const store = window.__store;
      store.select(['normal']);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const ctx = document.getElementById('canvas-host').__ctx;
        const f = store.byId('normal');
        const b = store.byId(f.bodyId);
        const tail = ctx.S(b.x + f.offsetX, b.y + f.offsetY);
        const origin = ctx.S(0, 0);
        const at = (sel) => {
          const n = document.querySelector(sel);
          if (!n) return null;
          return {
            x: Math.round(Number(n.getAttribute('cx') ?? n.getAttribute('x'))),
            y: Math.round(Number(n.getAttribute('cy') ?? n.getAttribute('y'))),
          };
        };
        r({ tail, origin, anchor: at('.handle-anchor'), rotate: at('.handle-rotate') });
      })));
    `);
    const near = (a, b, tolerance = 6) => a && b
      && Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance;

    check('the anchor grip sits at the force tail, not the origin',
      near(grips.anchor, grips.tail),
      `anchor ${JSON.stringify(grips.anchor)} tail ${JSON.stringify(grips.tail)}`);
    check('the anchor grip is not at the document origin',
      !near(grips.anchor, grips.origin));
    check('the rotation grip is near the force tail',
      grips.rotate && Math.hypot(grips.rotate.x - grips.tail.x, grips.rotate.y - grips.tail.y) < 45,
      `rotate ${JSON.stringify(grips.rotate)} tail ${JSON.stringify(grips.tail)}`);

    // BUG-06: a refused number must not linger in the box.
    await page.eval(`window.__store.select([]); return true;`);
    await page.settle();
    const widthField = await page.eval(`
      const rows = [...document.querySelectorAll('#inspector .field')];
      const row = rows.find((r) => r.querySelector('.field-label').textContent.startsWith('Width'));
      const input = row.querySelector('input');
      input.value = '-5';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { shown: input.value, model: window.__store.doc.canvas.width };
    `);
    check('a negative canvas width is refused', widthField.model === 24, String(widthField.model));
    check('the width box shows the value the document holds',
      Number(widthField.shown) === widthField.model,
      `box ${widthField.shown} vs model ${widthField.model}`);

    // The same rule for a shape field.
    await page.eval(`window.__store.select(['weight']); return true;`);
    await page.settle();
    const shapeField = await page.eval(`
      const rows = [...document.querySelectorAll('#inspector .field')];
      const row = rows.find((r) => r.querySelector('.field-label').textContent === 'Magnitude');
      const input = row.querySelector('input[type=number]');
      const was = window.__store.byId('weight').magnitude;
      input.value = '-99';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { shown: input.value, model: window.__store.byId('weight').magnitude, was };
    `);
    check('a refused shape value does not stick', shapeField.model === shapeField.was);
    check('the shape field reverts to the stored value',
      Number(shapeField.shown) === shapeField.model,
      `box ${shapeField.shown} vs model ${shapeField.model}`);

    // BUG-07: an empty title must fall back rather than persist blank.
    const title = await page.eval(`
      const input = document.querySelector('.title-input');
      input.value = '   ';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { shown: input.value, model: window.__store.doc.title };
    `);
    check('an empty title falls back to a default',
      title.model === 'Untitled diagram' && title.shown === 'Untitled diagram',
      JSON.stringify(title));

    // BUG-09: a search with no hits must say so.
    const search = await page.eval(`
      const box = document.querySelector('.palette-filter');
      const message = document.querySelector('.no-match');
      if (!message) return { missing: true };

      box.value = 'zzz_nonexistent';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      // Read now. The node is a live reference, so anything read after the
      // box is cleared below would report the final state instead.
      const shownWhenEmpty = !message.hidden;
      const visibleAfter = [...document.querySelectorAll('.palette-item')].filter((n) => !n.hidden).length;

      box.value = '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const hiddenWhenResults = message.hidden;

      return { missing: false, shownWhenEmpty, visibleAfter, hiddenWhenResults };
    `);
    check('the palette has a no-match message at all', search.missing === false);
    check('a search with no hits explains itself', search.shownWhenEmpty === true);
    check('the empty search really had no hits', search.visibleAfter === 0);
    check('the message goes away when there are hits', search.hiddenWhenResults === true);

    // BUG-05: Clear must ask first. window.confirm blocks the page, so the
    // dialog is observed through the protocol rather than by evaluating.
    await page.send('Page.enable');
    const opening = page.once('Page.javascriptDialogOpening');
    page.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Clear').click();`,
    });
    const dialog = await Promise.race([
      opening,
      new Promise((resolve) => { setTimeout(() => resolve(null), 3000); }),
    ]);
    check('Clear asks for confirmation first', dialog !== null,
      'no dialog was raised');
    if (dialog) {
      check('the confirmation names the consequence',
        /clear/i.test(dialog.message), dialog.message);
      await page.send('Page.handleJavaScriptDialog', { accept: false });
      await page.settle();
      check('declining the confirmation keeps the diagram',
        await store('mod.doc.elements.length') === 9,
        String(await store('mod.doc.elements.length')));
    }
  }

  /* ------------------------------------------------------------------ */
  section('marquee precision');
  {
    // A marquee used to select by bounding box. A hatched incline's box is a
    // huge diagonal rectangle, so a sweep drawn tightly around a small shape
    // sitting inside that box also caught the incline — and dragging the shape
    // then dragged the ground with it.
    await page.eval(`
      const store = window.__store;
      store.clear();
      store.addElement('surface', { id: 'slope', x: 2, y: 2, length: 18, angle: 30 });
      store.addElement('charge', { id: 'q', x: 5, y: 10, radius: 0.4 });
      store.select([]);
      return true;
    `);
    await page.settle();

    const nested = await page.eval(`
      const host = document.getElementById('canvas-host');
      const slope = host.querySelector('.element[data-id="slope"]').getBBox();
      const q = host.querySelector('.element[data-id="q"]').getBBox();
      return q.x > slope.x && q.x + q.width < slope.x + slope.width
        && q.y > slope.y && q.y + q.height < slope.y + slope.height;
    `);
    check('the small shape really sits inside the big one’s bounding box', nested === true);

    const sweep = await page.eval(`
      const host = document.getElementById('canvas-host');
      const r = host.querySelector('svg').getBoundingClientRect();
      const b = host.querySelector('.element[data-id="q"]').getBBox();
      return { ax: r.left + b.x - 6, ay: r.top + b.y - 6,
               bx: r.left + b.x + b.width + 6, by: r.top + b.y + b.height + 6 };
    `);
    await page.drag({ x: sweep.ax, y: sweep.ay }, { x: sweep.bx, y: sweep.by }, { steps: 10 });
    await page.settle();
    check('a tight sweep selects only what it touches',
      JSON.stringify(await store('mod.selection')) === '["q"]',
      JSON.stringify(await store('mod.selection')));

    const before = await page.eval('return JSON.stringify(window.__store.doc.elements.map((e) => [e.id, e.x, e.y]));');
    const grab = await page.eval(`
      const host = document.getElementById('canvas-host');
      const r = host.querySelector('svg').getBoundingClientRect();
      const b = host.querySelector('.element[data-id="q"]').getBBox();
      return { x: r.left + b.x + b.width / 2, y: r.top + b.y + b.height / 2 };
    `);
    await page.drag(grab, { x: grab.x + 60, y: grab.y - 40 }, { steps: 8 });
    await page.settle();
    const after = await page.eval('return JSON.stringify(window.__store.doc.elements.map((e) => [e.id, e.x, e.y]));');
    const moved = JSON.parse(before)
      .filter((row, index) => JSON.stringify(row) !== JSON.stringify(JSON.parse(after)[index]))
      .map((row) => row[0]);
    check('dragging it moves only it', JSON.stringify(moved) === '["q"]', JSON.stringify(moved));

    // A sweep over the whole sheet must still take everything.
    await page.eval(`window.__store.select([]); return true;`);
    const whole = await page.eval(`
      const r = document.querySelector('#canvas-host svg').getBoundingClientRect();
      return { ax: r.left + 6, ay: r.top + 6, bx: r.right - 6, by: r.bottom - 6 };
    `);
    await page.drag({ x: whole.ax, y: whole.ay }, { x: whole.bx, y: whole.by }, { steps: 12 });
    await page.settle();
    check('a full sweep still takes everything',
      await store('mod.selection.length') === await store('mod.doc.elements.length'),
      `${await store('mod.selection.length')} of ${await store('mod.doc.elements.length')}`);
  }

  /* ------------------------------------------------------------------ */
  section('the grid');
  {
    await reset();
    await page.eval(`return import('./src/store.js').then((m) => { window.__store = m.store; return true; });`);

    const grid = await page.eval(`
      const lines = [...document.querySelectorAll('[data-layer=grid] line')];
      const majors = lines.filter((l) => l.getAttribute('stroke') === 'var(--grid-major)').length;
      return { step: window.__store.doc.canvas.grid, total: lines.length, majors };
    `);
    check('the default grid is finer than one unit', grid.step < 1, String(grid.step));
    check('the grid is drawn', grid.total > 20, String(grid.total));
    check('every fifth line is a major line', grid.majors > 0 && grid.majors < grid.total,
      `${grid.majors} of ${grid.total}`);

    // The circuit starter uses a finer grid for its compact geometry.
    check('the sample uses the circuit grid step',
      await page.eval(`
        return import('./src/sample.js').then((m) => m.sampleDocument().canvas.grid === 0.2);
      `));

    // A very fine grid at a low zoom must thin out rather than turn solid.
    const dense = await page.eval(`
      return import('./src/store.js').then(async (m) => {
        m.store.setCanvas({ grid: 0.1 });
        m.store.view.scale = 14;
        m.store.emit('zoom');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const lines = [...document.querySelectorAll('[data-layer=grid] line')];
        const majors = lines.filter((l) => l.getAttribute('stroke') === 'var(--grid-major)').length;
        return { total: lines.length, majors };
      });
    `);
    check('a very fine grid drops its minor lines when zoomed out',
      dense.total === dense.majors && dense.total > 0,
      `${dense.majors} major of ${dense.total}`);

    // Leave the default grid behind, so the end-of-run screenshot is honest.
    await reset();
  }

  /* ------------------------------------------------------------------ */
  section('a render failure is visible');
  {
    await reset();

    // A type whose render always throws. renderDocument catches it so one bad
    // shape cannot blank the sheet, but it used to only warn to the console:
    // four curves once vanished from a figure while the audit said clean.
    const reported = await page.eval(`
      return Promise.all([
        import('./src/registry.js'),
        import('./src/store.js'),
        import('./src/webmcp.js'),
        import('./src/render.js'),
      ]).then(async ([registry, store, webmcp, render]) => {
        // getType throws on an unknown name, so ask the list instead.
        if (!registry.allTypes().some((t) => t.name === 'test-explodes')) {
          registry.defineType({
            name: 'test-explodes', label: 'Explodes', group: 'Common',
            hint: 'Throws on render. Test only.',
            schema: { type: 'object', properties: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 } }, required: [] },
            anchor: (el) => ({ x: el.x, y: el.y }),
            move: (el, dx, dy) => ({ x: el.x + dx, y: el.y + dy }),
            render() { throw new Error('deliberate'); },
            tikz: () => [],
          });
        }
        store.store.addElement('test-explodes', { id: 'boom', x: 6, y: 5 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const failures = render.renderFailures();
        const issues = webmcp.diagnoseDiagram();
        // The handle layer stamps data-id too, so ask for the content group.
        const drawn = document.querySelector('#canvas-host svg .element[data-id=boom]') !== null;

        store.store.removeElement('boom');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const after = webmcp.diagnoseDiagram();

        return {
          failures,
          drawn,
          titles: issues.map((i) => i.title),
          severity: issues.find((i) => i.title === 'Element failed to draw')?.severity,
          detail: issues.find((i) => i.title === 'Element failed to draw')?.detail || '',
          recovered: !after.some((i) => i.title === 'Element failed to draw'),
        };
      });
    `);

    check('the broken element is absent from the drawing', reported.drawn === false);
    check('the renderer records which element failed',
      reported.failures.some((f) => f.id === 'boom'), JSON.stringify(reported.failures));
    check('the audit reports it', reported.titles.includes('Element failed to draw'),
      JSON.stringify(reported.titles));
    check('as an error, not a warning', reported.severity === 'error', String(reported.severity));
    check('carrying the reason', reported.detail.includes('deliberate'), reported.detail);
    check('and it clears once the element is gone', reported.recovered === true);

    await reset();
  }

  await page.screenshot(process.env.SHOT || 'browser-test.png');
  await page.eval('localStorage.clear(); return true;');
} catch (error) {
  failures++;
  results.push(`\n  FATAL ${error.message}`);
}

console.log(results.join('\n'));
console.log(failures === 0
  ? `\nAll ${checks} browser checks passed.`
  : `\n${failures} of ${checks} browser checks failed.`);

await page.close();
process.exit(failures === 0 ? 0 : 1);
