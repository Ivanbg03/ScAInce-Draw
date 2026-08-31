/**
 * The entry point. It registers the types, wires the panels and draws.
 *
 * Phase 2 adds one more import here. A WebMCP module walks the same registry
 * and turns each type into a tool, so the agent path and the GUI path stay in
 * step by construction.
 */

import './types/common.js';
import './types/annotation.js';
import './types/mechanics.js';
import './types/mechanics-parts.js';
import './types/plots.js';
import './types/plots-extra.js';
import './types/schematic.js';
import './types/optics.js';
import './types/optics-parts.js';
import './types/fields.js';
import './types/geometry.js';
import './types/circuit.js';

import { el } from './dom.js';
import { store } from './store.js';
import { renderDocument } from './render.js';
import { attachInteractions } from './interact.js';
import { createPalette, attachPaletteDrop } from './ui/palette.js';
import { createOutline } from './ui/outline.js';
import { attachContextMenu } from './ui/menu.js';
import { createSplitters } from './ui/splitter.js';
import { createInspector } from './ui/inspector.js';
import { createToolbar } from './ui/toolbar.js';
import { sampleDocument } from './sample.js';
import { applyTheme, currentTheme } from './ui/theme.js';
import { registerWebMcp } from './webmcp.js?v=webmcp32';

// Before anything draws, so the first paint is the right theme.
applyTheme(currentTheme());

const canvasHost = document.getElementById('canvas-host');
const statusBar = document.getElementById('status');

/* ----------------------------- drawing ---------------------------- */

let pendingFrame = 0;

function draw() {
  const { root, ctx } = renderDocument(store.doc, store.view, {
    selection: store.selection,
    interactive: true,
  });

  canvasHost.textContent = '';
  canvasHost.append(root);
  canvasHost.__ctx = ctx;

  const count = store.doc.elements.length;
  const selected = store.selection.length;
  const { width, height } = store.doc.canvas;

  statusBar.textContent = '';
  statusBar.append(
    part(String(count), count === 1 ? 'shape' : 'shapes'),
    sep(),
    part(`${width} x ${height}`, 'units'),
  );
  if (selected) statusBar.append(sep(), part(String(selected), 'selected'));
}

/** "12 shapes" with the number in the text colour and the noun muted. */
function part(value, noun) {
  const span = document.createElement('span');
  span.append(Object.assign(document.createElement('b'), { textContent: value }));
  span.append(document.createTextNode(` ${noun}`));
  return span;
}

function sep() {
  const span = document.createElement('span');
  span.textContent = ' · ';
  span.style.color = 'var(--n5)';
  return span;
}

function scheduleDraw() {
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    draw();
  });
}

/* --------------------------- TikZ dialog -------------------------- */

function showTikz(source) {
  const dialog = document.getElementById('tikz-dialog');
  const output = document.getElementById('tikz-output');
  output.value = source;
  dialog.showModal();
  output.focus();
  output.setSelectionRange(0, 0);
}

document.getElementById('tikz-copy').addEventListener('click', async () => {
  const output = document.getElementById('tikz-output');
  try {
    await navigator.clipboard.writeText(output.value);
    const button = document.getElementById('tikz-copy');
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch {
    output.select(); // The clipboard API can be blocked. A manual copy works.
  }
});

document.getElementById('tikz-download').addEventListener('click', () => {
  const output = document.getElementById('tikz-output');
  const blob = new Blob([output.value], { type: 'text/plain' });
  const link = el('a', { href: URL.createObjectURL(blob), download: 'diagram.tex' });
  document.body.append(link);
  link.click();
  link.remove();
});

/* ----------------------------- start ------------------------------ */

document.getElementById('help-button').addEventListener('click', () => {
  document.getElementById('help-dialog').showModal();
});

/**
 * Picks the zoom that makes the whole sheet fit the visible area.
 * The renderer adds a fixed 24px margin on each side, and the host has its own
 * padding, so both come off before the division.
 */
function fitToWindow() {
  const style = getComputedStyle(canvasHost);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const available = {
    x: canvasHost.clientWidth - padX - 48,
    y: canvasHost.clientHeight - padY - 48,
  };
  const { width, height } = store.doc.canvas;
  if (!(available.x > 0 && available.y > 0)) return;

  const scale = Math.min(available.x / width, available.y / height);
  store.view.scale = Math.round(Math.min(120, Math.max(12, scale)));
  draw();
}

const togglePanel = createSplitters(document.querySelector('.layout'));

createToolbar(document.getElementById('toolbar'), {
  onRedraw: draw, showTikz, fitToWindow, togglePanel,
});
createPalette(document.getElementById('palette'));
createInspector(document.getElementById('inspector'));
attachInteractions(canvasHost);
attachPaletteDrop(canvasHost);
attachContextMenu(canvasHost);
createOutline(document.getElementById('outline'));

store.subscribe(scheduleDraw);

if (!store.restore()) {
  store.replaceDocument(sampleDocument(), { history: false });
}

draw();

console.info('[diagram-studio] ready.', store.doc.elements.length, 'elements');

registerWebMcp({ showTikz, fitToWindow }).then((result) => {
  console.info('[diagram-studio] webmcp.', result);
}).catch((error) => {
  console.warn('[diagram-studio] webmcp failed.', error);
});
