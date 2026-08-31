/** The top toolbar: title, history, zoom and the three exports. */

import { el, download, clamp } from '../dom.js';
import { store } from '../store.js';
import { toSvgSource } from '../export/svg.js';
import { toPngDataUrl } from '../export/png.js';
import { toTikzSource } from '../export/tikz.js';
import { applyTheme, currentTheme, nextTheme } from './theme.js';

/** The app mark: a small pair of axes, drawn rather than imported. */
function brand() {
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('width', '16');
  mark.setAttribute('height', '16');
  mark.setAttribute('viewBox', '0 0 16 16');
  mark.setAttribute('fill', 'none');
  mark.innerHTML = '<path d="M3 13V3M3 13h10" stroke="currentColor" stroke-width="1.6"'
    + ' stroke-linecap="round"/><path d="M3 10.5C6 10.5 7 4.5 12.5 4.5" stroke="currentColor"'
    + ' stroke-width="1.6" stroke-linecap="round" opacity=".55"/>';
  return el('span', { class: 'brand' }, [mark, 'Diagram Studio']);
}

/** A file-safe stem from the diagram title. */
function slug(title) {
  return String(title || 'diagram')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'diagram';
}

export function createToolbar(mount, { onRedraw, showTikz, fitToWindow, togglePanel }) {
  const title = el('input', {
    type: 'text',
    class: 'title-input',
    value: store.doc.title,
    onchange: (event) => {
      // An empty title would reach an export and a filename. Fall back to the
      // same default a cleared document gets.
      const next = event.target.value.trim() || 'Untitled diagram';
      event.target.value = next;
      store.setTitle(next);
    },
  });

  const undoButton = el('button', { type: 'button', title: 'Ctrl+Z', onclick: () => store.undo() }, ['Undo']);
  const redoButton = el('button', { type: 'button', title: 'Ctrl+Shift+Z', onclick: () => store.redo() }, ['Redo']);

  const zoomOut = el('button', {
    type: 'button', title: 'Zoom out',
    onclick: () => { store.view.scale = clamp(store.view.scale - 6, 12, 120); onRedraw(); updateZoom(); },
  }, ['−']);
  const zoomIn = el('button', {
    type: 'button', title: 'Zoom in',
    onclick: () => { store.view.scale = clamp(store.view.scale + 6, 12, 120); onRedraw(); updateZoom(); },
  }, ['+']);
  const fitButton = el('button', {
    type: 'button', title: 'Zoom so the whole sheet fits the window',
    onclick: () => { fitToWindow(); updateZoom(); },
  }, ['Fit']);

  const zoomLabel = el('span', { class: 'muted small zoom' });
  const updateZoom = () => { zoomLabel.textContent = `${store.view.scale} px/unit`; };
  updateZoom();

  const exportSvg = el('button', {
    type: 'button',
    onclick: () => {
      const source = toSvgSource(store.doc, store.view);
      download(`${slug(store.doc.title)}.svg`, source, 'image/svg+xml');
    },
  }, ['SVG']);

  const exportPng = el('button', {
    type: 'button',
    onclick: async () => {
      exportPng.disabled = true;
      try {
        const url = await toPngDataUrl(store.doc, store.view, { scale: 2 });
        download(`${slug(store.doc.title)}.png`, url);
      } catch (error) {
        window.alert(`The PNG export failed: ${error.message}`);
      } finally {
        exportPng.disabled = false;
      }
    },
  }, ['PNG']);

  const exportTikz = el('button', {
    type: 'button',
    class: 'primary',
    title: 'Show the TikZ source for a LaTeX document',
    onclick: () => showTikz(toTikzSource(store.doc, store.view)),
  }, ['TikZ']);

  // Light, dark, or follow the system. The glyph names the current state.
  const THEME_GLYPH = { system: '◐', light: '☀', dark: '☾' };
  let theme = currentTheme();
  const themeButton = el('button', {
    type: 'button',
    class: 'ghost',
    onclick: () => {
      theme = nextTheme(theme);
      applyTheme(theme);
      updateTheme();
    },
  });
  const updateTheme = () => {
    themeButton.textContent = THEME_GLYPH[theme];
    themeButton.title = `Theme: ${theme}. Click for ${nextTheme(theme)}.`;
  };
  updateTheme();

  const clearButton = el('button', {
    type: 'button', class: 'ghost',
    onclick: () => {
      if (window.confirm('Clear the whole diagram? Undo can bring it back.')) store.clear();
    },
  }, ['Clear']);

  // One primary action (TikZ, the reason the app exists), everything else
  // quiet. A row of equal-weight buttons tells the eye nothing.
  mount.append(
    brand(),
    title,
    el('span', { class: 'spacer' }),
    el('span', { class: 'segment' }, [
      el('button', {
        type: 'button', title: 'Show or hide the shapes panel',
        onclick: () => togglePanel('left'),
      }, ['◧']),
      el('button', {
        type: 'button', title: 'Show or hide the properties panel',
        onclick: () => togglePanel('right'),
      }, ['◨']),
    ]),
    el('span', { class: 'divider' }),
    el('span', { class: 'segment' }, [undoButton, redoButton]),
    el('span', { class: 'divider' }),
    el('span', { class: 'segment' }, [zoomOut, zoomIn, fitButton]),
    zoomLabel,
    el('span', { class: 'divider' }),
    el('span', { class: 'tool-label' }, ['Export']),
    el('span', { class: 'segment' }, [exportSvg, exportPng, exportTikz]),
    el('span', { class: 'divider' }),
    themeButton,
    clearButton,
  );

  store.subscribe(() => {
    undoButton.disabled = !store.canUndo();
    redoButton.disabled = !store.canRedo();
    if (document.activeElement !== title && title.value !== store.doc.title) {
      title.value = store.doc.title;
    }
  });

  undoButton.disabled = !store.canUndo();
  redoButton.disabled = !store.canRedo();
}
