/**
 * The element palette.
 *
 * Each entry shows the shape itself, drawn by the type's own render function on
 * a small canvas. Drag an entry onto the drawing to place it where you drop it,
 * or click it to drop it in the middle.
 */

import { el, round } from '../dom.js';
import { typesByGroup, createElement, getType } from '../registry.js';
import { renderDocument } from '../render.js';
import { iconFor } from '../icons.js';
import { store } from '../store.js';

const ICON_BOX = { width: 54, height: 40, margin: 3 };

/** Renders one type's shape into a small SVG for the palette. */
function iconSvg(typeName) {
  const icon = iconFor(typeName);
  const scale = Math.min(
    (ICON_BOX.width - ICON_BOX.margin * 2) / icon.w,
    (ICON_BOX.height - ICON_BOX.margin * 2) / icon.h,
  );

  // A plot type has no coordinates of its own, so its framing supplies a faint
  // set of axes to hang it on. The extras are drawn first, underneath.
  const taken = new Set();
  const elements = icon.extra.map((entry) => {
    const element = createElement(entry.type, { id: entry.id, ...entry.values }, taken);
    taken.add(element.id);
    return element;
  });
  elements.push(createElement(typeName, icon.values, taken));

  const doc = {
    title: '',
    canvas: { width: icon.w, height: icon.h, grid: 1, showGrid: false, snap: false },
    elements,
  };

  try {
    const { root } = renderDocument(doc, { scale }, {
      selection: [],
      interactive: false,
      margin: ICON_BOX.margin,
      // An icon is fitted to its box, not previewing an export. Shrinking its
      // strokes by that fitted scale would leave the glyph too faint to read.
      previewScale: false,
    });
    root.setAttribute('class', 'palette-icon');
    root.removeAttribute('font-family');
    return root;
  } catch (error) {
    console.warn(`icon failed for ${typeName}`, error);
    return el('span', { class: 'palette-icon-missing' }, ['?']);
  }
}

/** Sensible starting values for a new element, including the obvious links. */
export function seedFor(typeName) {
  const canvas = store.doc.canvas;
  const count = store.byType(typeName).length;
  const stagger = round((count % 5) * canvas.grid, 3);

  const seed = {
    x: round(canvas.width / 2 + stagger, 3),
    y: round(canvas.height / 2 - stagger, 3),
  };

  // Any type with an axesId reuses the axes already on the sheet. The list
  // used to be hard coded, so a vector field or a polar curve built itself a
  // second set of axes on top of the first.
  if (Object.hasOwn(getType(typeName).schema.properties, 'axesId')) {
    const axes = store.byType('axes')[0];
    if (axes) seed.axesId = axes.id;
  }

  if (typeName === 'force') {
    const selected = store.selected()[0];
    if (selected && selected.type === 'body') seed.bodyId = selected.id;
  }

  if (typeName === 'link') {
    const blocks = store.byType('block');
    if (blocks.length >= 2) {
      seed.fromId = blocks[blocks.length - 2].id;
      seed.toId = blocks[blocks.length - 1].id;
    }
  }

  // These types carry their own geometry instead of a single x,y.
  if (!Object.hasOwn(getType(typeName).schema.properties, 'x')) {
    delete seed.x;
    delete seed.y;
  }

  return seed;
}

/**
 * Adds an element and puts it where it belongs.
 *
 * A drop supplies the point. A click does not, and used to leave the shape at
 * its schema default — which for every point-list type is the origin, so
 * arrows, wires and polylines all piled up in the bottom left corner.
 * There is now always a target: the middle of the sheet.
 */
export function addAt(typeName, target = null) {
  const canvas = store.doc.canvas;
  const lookup = (id) => store.byId(id);

  // A plot shape has no coordinates of its own. Give it a frame to live on,
  // or it renders at the origin and cannot be moved.
  const seed = seedFor(typeName);
  const type = getType(typeName);
  if (Object.hasOwn(type.schema.properties, 'axesId') && !seed.axesId) {
    const axes = store.addElement('axes', {
      x: round((target ? target.x : canvas.width / 2) - 4, 2),
      y: round((target ? target.y : canvas.height / 2) - 3, 2),
    });
    seed.axesId = axes.id;
  }

  const element = store.addElement(typeName, seed);

  // A follower sits wherever its parent is; moving it is meaningless.
  if (type.attachedTo && type.attachedTo(element)) return element;

  const spot = target || {
    x: round(canvas.width / 2, 2),
    y: round(canvas.height / 2, 2),
  };
  const anchor = type.anchor(element, lookup);
  if (!anchor) return element;

  const changes = type.move(element, round(spot.x - anchor.x, 3), round(spot.y - anchor.y, 3));
  if (changes && Object.keys(changes).length) {
    store.updateElement(element.id, changes, { history: false });
  }
  return element;
}

export function createPalette(mount) {
  const filter = el('input', {
    type: 'search',
    class: 'palette-filter',
    placeholder: 'Search shapes',
    spellcheck: 'false',
    oninput: () => apply(filter.value.trim().toLowerCase()),
  });

  const groupsHost = el('div', { class: 'palette-groups' });
  const noMatch = el('p', { class: 'muted small no-match' }, ['No shape matches that search.']);
  noMatch.hidden = true;
  mount.append(filter, noMatch, groupsHost);

  const entries = [];

  for (const [group, types] of typesByGroup()) {
    const grid = el('div', { class: 'palette-grid' });

    for (const type of types) {
      const item = el('button', {
        type: 'button',
        class: 'palette-item',
        draggable: 'true',
        title: `${type.label}\n${type.hint || ''}`,
        'data-type': type.name,
        onclick: () => {
          try {
            addAt(type.name);
          } catch (error) {
            console.error(error);
            window.alert(`Could not add ${type.label}: ${error.message}`);
          }
        },
        ondragstart: (event) => {
          event.dataTransfer.setData('application/x-diagram-type', type.name);
          event.dataTransfer.setData('text/plain', type.name);
          event.dataTransfer.effectAllowed = 'copy';
          item.classList.add('is-dragging');
        },
        ondragend: () => item.classList.remove('is-dragging'),
      }, [
        iconSvg(type.name),
        el('span', { class: 'palette-name' }, [type.label]),
      ]);

      grid.append(item);
      entries.push({ item, group, haystack: `${type.label} ${type.name} ${type.hint || ''}`.toLowerCase() });
    }

    const section = el('details', { class: 'palette-group', open: 'open' }, [
      el('summary', { class: 'group-title' }, [group]),
      grid,
    ]);
    groupsHost.append(section);
  }

  /** Hides the entries that do not match, and any group left empty. */
  function apply(query) {
    for (const entry of entries) {
      entry.item.hidden = Boolean(query) && !entry.haystack.includes(query);
    }
    let anyVisible = false;
    for (const section of groupsHost.querySelectorAll('.palette-group')) {
      const visible = [...section.querySelectorAll('.palette-item')].some((item) => !item.hidden);
      section.hidden = !visible;
      if (visible) anyVisible = true;
      if (query && visible) section.open = true;
    }
    noMatch.hidden = anyVisible;
  }
}

/** Wires the canvas as a drop target for the palette. */
export function attachPaletteDrop(container) {
  container.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-diagram-type')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    container.classList.add('is-drop-target');
  });

  container.addEventListener('dragleave', (event) => {
    if (event.target === container) container.classList.remove('is-drop-target');
  });

  container.addEventListener('drop', (event) => {
    const typeName = event.dataTransfer.getData('application/x-diagram-type');
    container.classList.remove('is-drop-target');
    if (!typeName) return;
    event.preventDefault();

    const ctx = container.__ctx;
    const svgNode = container.querySelector('svg');
    if (!ctx || !svgNode) return;

    const rect = svgNode.getBoundingClientRect();
    const point = ctx.D(event.clientX - rect.left, event.clientY - rect.top);

    const { snap, grid } = store.doc.canvas;
    const fit = (value) => (snap && grid > 0 ? round(Math.round(value / grid) * grid, 3) : round(value, 3));

    try {
      addAt(typeName, { x: fit(point.x), y: fit(point.y) });
    } catch (error) {
      console.error(error);
      window.alert(`Could not add ${typeName}: ${error.message}`);
    }
  });
}
