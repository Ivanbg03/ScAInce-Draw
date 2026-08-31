/**
 * Align and distribute the selection.
 *
 * The bounds come from the live SVG through getBBox(), so they are the real
 * drawn extent of a shape — the tip of an arrowhead, the hatch under a
 * surface, the whole of a spring. A per-type bounds() function would need
 * thirty-eight implementations and would still only ever be an estimate.
 *
 * When getBBox is unavailable the anchor point stands in, so the commands
 * degrade to aligning anchors instead of failing.
 */

import { round } from '../dom.js';
import { getType } from '../registry.js';
import { store } from '../store.js';

/** The drawn extent of one element, in document units. */
export function boundsOf(id) {
  const host = document.getElementById('canvas-host');
  const ctx = host && host.__ctx;
  const element = store.byId(id);
  if (!element || !ctx) return null;

  const node = host.querySelector(`.element[data-id="${CSS.escape(id)}"]`);
  if (node && typeof node.getBBox === 'function') {
    try {
      const box = node.getBBox();
      if (box.width > 0 || box.height > 0) {
        const bottomLeft = ctx.D(box.x, box.y + box.height);
        const topRight = ctx.D(box.x + box.width, box.y);
        return {
          minX: bottomLeft.x, maxX: topRight.x,
          minY: bottomLeft.y, maxY: topRight.y,
        };
      }
    } catch { /* a detached or empty node: fall through to the anchor */ }
  }

  const anchor = getType(element.type).anchor(element, (other) => store.byId(other));
  if (!anchor) return null;
  return { minX: anchor.x, maxX: anchor.x, minY: anchor.y, maxY: anchor.y };
}

/** Every selected element that can actually be moved, with its bounds. */
function movableSelection() {
  return store.selected()
    .map((element) => ({ element, type: getType(element.type), bounds: boundsOf(element.id) }))
    .filter((entry) => entry.bounds !== null)
    // A curve follows its axes; its move() is a no-op, so it cannot be aligned.
    .filter((entry) => Object.keys(entry.type.move(entry.element, 1, 1) || {}).length > 0);
}

function shift(entry, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const changes = entry.type.move(entry.element, round(dx, 3), round(dy, 3));
  if (changes && Object.keys(changes).length) {
    store.updateElement(entry.element.id, changes, { history: false });
  }
}

const EDGE = {
  left: { axis: 'x', read: (b) => b.minX },
  right: { axis: 'x', read: (b) => b.maxX },
  centreX: { axis: 'x', read: (b) => (b.minX + b.maxX) / 2 },
  top: { axis: 'y', read: (b) => b.maxY },
  bottom: { axis: 'y', read: (b) => b.minY },
  centreY: { axis: 'y', read: (b) => (b.minY + b.maxY) / 2 },
};

/** Aligns every selected shape to one edge of the selection. */
export function alignSelection(edge) {
  const rule = EDGE[edge];
  if (!rule) return;

  const entries = movableSelection();
  if (entries.length < 2) return;

  const values = entries.map((entry) => rule.read(entry.bounds));
  let target;
  if (edge === 'left' || edge === 'bottom') target = Math.min(...values);
  else if (edge === 'right' || edge === 'top') target = Math.max(...values);
  else target = values.reduce((sum, value) => sum + value, 0) / values.length;

  store.transaction(`align ${edge}`, () => {
    entries.forEach((entry, index) => {
      const delta = target - values[index];
      shift(entry, rule.axis === 'x' ? delta : 0, rule.axis === 'y' ? delta : 0);
    });
  });
}

/** Spaces the selection evenly between its two outermost shapes. */
export function distributeSelection(axis) {
  const entries = movableSelection();
  if (entries.length < 3) return;

  const centre = (bounds) => (axis === 'x'
    ? (bounds.minX + bounds.maxX) / 2
    : (bounds.minY + bounds.maxY) / 2);

  const ordered = [...entries].sort((a, b) => centre(a.bounds) - centre(b.bounds));
  const first = centre(ordered[0].bounds);
  const last = centre(ordered[ordered.length - 1].bounds);
  const step = (last - first) / (ordered.length - 1);

  store.transaction(`distribute ${axis}`, () => {
    ordered.forEach((entry, index) => {
      if (index === 0 || index === ordered.length - 1) return;
      const delta = (first + step * index) - centre(entry.bounds);
      shift(entry, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
    });
  });
}
