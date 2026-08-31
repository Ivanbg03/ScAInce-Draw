/**
 * Pointer and keyboard handling on the canvas.
 *
 * A drag pushes one undo entry when the first real change happens, then
 * updates without history. Undo therefore restores the state from before the
 * whole drag, and a plain click leaves the history untouched.
 */

import { round, svg, DEG } from './dom.js';
import { getType } from './registry.js';
import { store } from './store.js';

/* -------------------- precise marquee hit testing -------------------- */

/**
 * A marquee must select what it actually touches.
 *
 * Testing a group's bounding box is far too eager: a hatched incline's box is
 * a huge diagonal rectangle, so a sweep drawn tightly around a block sitting
 * on that incline selected the incline as well — and then dragging the block
 * dragged the ground with it. These helpers test the drawn geometry instead.
 */

/** A point in one node's own user space, mapped to viewport coordinates. */
function toViewport(node, x, y) {
  const matrix = node.getScreenCTM();
  if (!matrix) return null;
  return {
    x: x * matrix.a + y * matrix.c + matrix.e,
    y: x * matrix.b + y * matrix.d + matrix.f,
  };
}

function pointInside(point, rect) {
  return Boolean(point)
    && point.x >= rect.left && point.x <= rect.right
    && point.y >= rect.top && point.y <= rect.bottom;
}

function rectsOverlap(box, rect) {
  return box.left <= rect.right && box.right >= rect.left
    && box.top <= rect.bottom && box.bottom >= rect.top;
}

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/** True when the segment enters the rectangle at all. */
function segmentHitsRect(a, b, rect) {
  if (pointInside(a, rect) || pointInside(b, rect)) return true;
  const corners = [
    { x: rect.left, y: rect.top }, { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom },
  ];
  for (let index = 0; index < 4; index++) {
    if (segmentsCross(a, b, corners[index], corners[(index + 1) % 4])) return true;
  }
  return false;
}

const PRIMITIVES = 'path, line, rect, circle, ellipse, polygon, polyline, text';

/** Does this element draw anything inside the rectangle? */
function drawsInside(node, rect) {
  // Cheap reject on the whole group before looking at its parts.
  if (!rectsOverlap(node.getBoundingClientRect(), rect)) return false;

  const leaves = node.matches(PRIMITIVES) ? [node] : [...node.querySelectorAll(PRIMITIVES)];

  for (const leaf of leaves) {
    if (!rectsOverlap(leaf.getBoundingClientRect(), rect)) continue;

    const tag = leaf.tagName.toLowerCase();
    const filled = leaf.getAttribute('fill') && leaf.getAttribute('fill') !== 'none';

    if (tag === 'line') {
      const a = toViewport(leaf, Number(leaf.getAttribute('x1')), Number(leaf.getAttribute('y1')));
      const b = toViewport(leaf, Number(leaf.getAttribute('x2')), Number(leaf.getAttribute('y2')));
      if (a && b && segmentHitsRect(a, b, rect)) return true;
      continue;
    }

    if ((tag === 'polyline' || tag === 'polygon') && !filled) {
      const points = [...leaf.points].map((point) => toViewport(leaf, point.x, point.y));
      for (let index = 0; index + 1 < points.length; index++) {
        if (segmentHitsRect(points[index], points[index + 1], rect)) return true;
      }
      if (tag === 'polygon' && points.length > 2
        && segmentHitsRect(points[points.length - 1], points[0], rect)) return true;
      continue;
    }

    if (tag === 'path' && !filled) {
      // Walk the outline. getPointAtLength follows the real curve, so a
      // sweep beside a bowed path does not catch it.
      const length = leaf.getTotalLength ? leaf.getTotalLength() : 0;
      if (!length) return true;
      const steps = Math.min(240, Math.max(8, Math.ceil(length / 4)));
      let previous = null;
      for (let index = 0; index <= steps; index++) {
        const local = leaf.getPointAtLength((length * index) / steps);
        const point = toViewport(leaf, local.x, local.y);
        if (pointInside(point, rect)) return true;
        if (previous && segmentHitsRect(previous, point, rect)) return true;
        previous = point;
      }
      continue;
    }

    // A filled shape, or text: its box really is what it covers.
    return true;
  }

  return false;
}

export function attachInteractions(container) {
  let drag = null;
  let marquee = null;
  let pan = null;
  let spaceHeld = false;

  const svgNode = () => container.querySelector('svg');

  /** Converts a pointer event to document units. */
  function toDoc(event) {
    const ctx = container.__ctx;
    const node = svgNode();
    if (!ctx || !node) return null;
    const rect = node.getBoundingClientRect();
    return ctx.D(event.clientX - rect.left, event.clientY - rect.top);
  }

  /** Applies the grid snap when it is on. */
  function snap(value) {
    const { snap: on, grid } = store.doc.canvas;
    if (!on || !(grid > 0)) return round(value, 3);
    return round(Math.round(value / grid) * grid, 3);
  }

  const lookup = (id) => store.byId(id);

  /** True when this shape's own move() does nothing. */
  function immovable(element) {
    const changes = getType(element.type).move(element, 1, 1);
    return !changes || Object.keys(changes).length === 0;
  }

  /**
   * The id that a drag on this shape should actually move.
   * A curve follows its axes and has no geometry of its own, so dragging it
   * moves the axes. A shape that can move itself is returned unchanged.
   */
  function redirect(id) {
    const element = store.byId(id);
    if (!element || !immovable(element)) return id;
    const type = getType(element.type);
    const parent = type.attachedTo ? type.attachedTo(element) : '';
    return parent && store.byId(parent) ? parent : id;
  }

  /* --------------------------- pointer --------------------------- */

  container.addEventListener('pointerdown', (event) => {
    const ctx = container.__ctx;
    if (!ctx) return;

    // Middle button, or space held: pan by scrolling.
    if (event.button === 1 || (spaceHeld && event.button === 0)) {
      pan = { x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop };
      container.setPointerCapture(event.pointerId);
      container.classList.add('is-panning');
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;

    const start = toDoc(event);
    if (!start) return;

    // A sheet grip resizes the drawing area itself, so it is checked first.
    const sheetNode = event.target.closest('[data-canvas-handle]');
    if (sheetNode) {
      drag = { kind: 'sheet', edge: sheetNode.dataset.canvasHandle, start, pushed: false };
      container.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const handleNode = event.target.closest('[data-handle]');
    if (handleNode) {
      const which = handleNode.dataset.handle;
      const kind = which === 'anchor' ? 'move' : which === 'rotate' ? 'rotate' : 'handle';
      // The anchor grip means "move this", so it follows the same redirect as
      // a drag on the shape itself. A marker's grip covers the marker, so this
      // is often the only way to grab it.
      const id = kind === 'move' ? redirect(handleNode.dataset.id) : handleNode.dataset.id;
      const grabbed = store.byId(id);
      const anchor = kind === 'move' && grabbed
        ? getType(grabbed.type).anchor(grabbed, lookup)
        : null;
      drag = {
        kind,
        id,
        index: Number(which),
        // Which field this grip writes. A label rotates through "rotate".
        field: handleNode.dataset.field || 'angle',
        start,
        grab: anchor ? { x: anchor.x - start.x, y: anchor.y - start.y } : { x: 0, y: 0 },
        pushed: false,
      };
      container.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const elementNode = event.target.closest('.element[data-id]');
    if (elementNode) {
      const id = elementNode.dataset.id;
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        store.toggleSelected(id);
        return; // a modifier click selects; it does not start a drag
      }
      if (!store.selection.includes(id)) store.select([id]);

      // A shape that cannot move itself drags its parent instead. Grabbing a
      // curve moves the axes it is drawn on, which is what a user means.
      const moveId = redirect(id);
      const grabbed = store.byId(moveId);
      const anchor = grabbed ? getType(grabbed.type).anchor(grabbed, lookup) : null;
      drag = {
        kind: 'move',
        id: moveId,
        start,
        grab: anchor ? { x: anchor.x - start.x, y: anchor.y - start.y } : { x: 0, y: 0 },
        pushed: false,
      };
      container.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    // Empty canvas: start a marquee.
    marquee = { start, additive: event.shiftKey, node: null };
    if (!event.shiftKey) store.select([]);
    container.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  container.addEventListener('pointermove', (event) => {
    if (pan) {
      container.scrollLeft = pan.left - (event.clientX - pan.x);
      container.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }

    const ctx = container.__ctx;
    if (!ctx) return;

    if (marquee) {
      const point = toDoc(event);
      if (point) drawMarquee(marquee, point, ctx);
      return;
    }

    if (!drag) return;
    const point = toDoc(event);
    if (!point) return;

    if (drag.kind === 'sheet') {
      const canvas = store.doc.canvas;
      const grid = canvas.grid || 1;
      const snapTo = (value) => Math.round(value / grid) * grid;

      // East and north set the far edge directly. West and south set the near
      // edge, which would move the origin, so the growth is applied as a shift
      // of every shape instead. Working from the live frame each move keeps it
      // self-correcting: once applied, the pointer reads zero again.
      const changes = {};
      let shiftX = 0;
      let shiftY = 0;

      if (drag.edge.includes('e')) changes.width = Math.min(400, Math.max(2, snapTo(point.x)));
      if (drag.edge.includes('n')) changes.height = Math.min(400, Math.max(2, snapTo(point.y)));
      if (drag.edge.includes('w')) {
        const grow = Math.max(2 - canvas.width, Math.min(400 - canvas.width, -snapTo(point.x)));
        if (grow !== 0) { changes.width = canvas.width + grow; shiftX = grow; }
      }
      if (drag.edge.includes('s')) {
        const grow = Math.max(2 - canvas.height, Math.min(400 - canvas.height, -snapTo(point.y)));
        if (grow !== 0) { changes.height = canvas.height + grow; shiftY = grow; }
      }

      const sizeChanged = (changes.width !== undefined && changes.width !== canvas.width)
        || (changes.height !== undefined && changes.height !== canvas.height);
      if (!sizeChanged) return;

      if (!drag.pushed) { store.transaction('resize sheet', () => {}); drag.pushed = true; }
      store.setCanvas(changes, { history: false });
      if (shiftX || shiftY) store.shiftAll(shiftX, shiftY, { history: false });
      return;
    }

    const element = store.byId(drag.id);
    if (!element) { drag = null; return; }
    const type = getType(element.type);

    const beginEdit = () => {
      if (drag.pushed) return;
      store.transaction('drag', () => {});
      drag.pushed = true;
    };

    if (drag.kind === 'rotate') {
      const field = drag.field || 'angle';
      const anchor = type.anchor(element, lookup);
      const next = round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / DEG, 1);
      const stepped = event.shiftKey ? round(Math.round(next / 15) * 15, 1) : next;
      if (stepped === element[field]) return;
      beginEdit();
      store.updateElement(drag.id, { [field]: stepped }, { history: false });
      return;
    }

    if (drag.kind === 'handle') {
      const handles = type.handles ? type.handles(element, lookup) : [];
      const handle = handles[drag.index];
      if (!handle) return;
      const changes = handle.set({ x: snap(point.x), y: snap(point.y) });
      if (!changes || !Object.keys(changes).length) return;
      beginEdit();
      store.updateElement(drag.id, changes, { history: false });
      return;
    }

    // The grab offset is added back before snapping, so the shape keeps the
    // spot you took hold of instead of centring itself on the cursor.
    const anchor = type.anchor(element, lookup);
    const grab = drag.grab || { x: 0, y: 0 };
    const dx = round(snap(point.x + grab.x) - anchor.x, 3);
    const dy = round(snap(point.y + grab.y) - anchor.y, 3);
    if (dx === 0 && dy === 0) return;

    // Everything selected moves by the same delta, not to the same place.
    // A follower is dropped when its parent is moving too, or it would shift
    // once for itself and once with the parent.
    const chosen = store.selection.includes(drag.id) ? store.selected() : [element];
    const moving = new Set(chosen.map((item) => item.id));
    const targets = chosen.filter((item) => {
      const type = getType(item.type);
      const parent = type.attachedTo ? type.attachedTo(item) : '';
      return !(parent && moving.has(parent));
    });
    let moved = false;
    for (const target of targets) {
      const changes = getType(target.type).move(target, dx, dy);
      if (changes && Object.keys(changes).length) {
        if (!moved) { beginEdit(); moved = true; }
        store.updateElement(target.id, changes, { history: false });
      }
    }
  });

  const finish = (event) => {
    try { container.releasePointerCapture(event.pointerId); } catch { /* already released */ }

    if (pan) {
      pan = null;
      container.classList.remove('is-panning');
      return;
    }

    if (marquee) {
      if (marquee.node) marquee.node.remove();
      if (marquee.box) applyMarquee(marquee);
      marquee = null;
      return;
    }

    drag = null;
  };

  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);

  /* --------------------------- marquee --------------------------- */

  function drawMarquee(state, point, ctx) {
    const node = svgNode();
    if (!node) return;

    state.box = {
      minX: Math.min(state.start.x, point.x),
      maxX: Math.max(state.start.x, point.x),
      minY: Math.min(state.start.y, point.y),
      maxY: Math.max(state.start.y, point.y),
    };

    const topLeft = ctx.S(state.box.minX, state.box.maxY);
    const bottomRight = ctx.S(state.box.maxX, state.box.minY);

    if (!state.node) {
      state.node = svg('rect', { class: 'marquee' });
      node.append(state.node);
    }
    state.node.setAttribute('x', topLeft.x);
    state.node.setAttribute('y', topLeft.y);
    state.node.setAttribute('width', Math.abs(bottomRight.x - topLeft.x));
    state.node.setAttribute('height', Math.abs(bottomRight.y - topLeft.y));
  }

  function applyMarquee(state) {
    const { box } = state;
    if ((box.maxX - box.minX) < 0.05 && (box.maxY - box.minY) < 0.05) return;

    const ctx = container.__ctx;
    const node = svgNode();
    if (!ctx || !node) return;

    // The rectangle in viewport coordinates, which is the frame every DOM
    // geometry call reports in.
    const svgRect = node.getBoundingClientRect();
    const topLeft = ctx.S(box.minX, box.maxY);
    const bottomRight = ctx.S(box.maxX, box.minY);
    const rect = {
      left: svgRect.left + Math.min(topLeft.x, bottomRight.x),
      right: svgRect.left + Math.max(topLeft.x, bottomRight.x),
      top: svgRect.top + Math.min(topLeft.y, bottomRight.y),
      bottom: svgRect.top + Math.max(topLeft.y, bottomRight.y),
    };

    const hits = [...container.querySelectorAll('.element[data-id]')]
      .filter((element) => drawsInside(element, rect))
      .map((element) => element.dataset.id);

    store.select(state.additive ? [...new Set([...store.selection, ...hits])] : hits);
  }

  /* ---------------------------- zoom ----------------------------- */

  container.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return; // a plain wheel scrolls
    event.preventDefault();

    const before = toDoc(event);
    const step = event.deltaY < 0 ? 4 : -4;
    const next = Math.min(120, Math.max(12, store.view.scale + step));
    if (next === store.view.scale) return;

    store.view.scale = next;
    store.emit('zoom');

    // Keep the point under the cursor where it was.
    requestAnimationFrame(() => {
      const ctx = container.__ctx;
      const node = svgNode();
      if (!ctx || !node || !before) return;
      const rect = node.getBoundingClientRect();
      const after = ctx.S(before.x, before.y);
      container.scrollLeft += after.x - (event.clientX - rect.left);
      container.scrollTop += after.y - (event.clientY - rect.top);
    });
  }, { passive: false });

  /* --------------------------- keyboard -------------------------- */

  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceHeld = false;
  });

  window.addEventListener('keydown', (event) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    const accel = event.ctrlKey || event.metaKey;

    if (event.code === 'Space' && !inField) {
      spaceHeld = true;
      event.preventDefault();
    }

    if (accel && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (accel && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      return;
    }

    if (inField) return;

    if (accel && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      store.duplicate();
      return;
    }
    if (accel && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      store.copy();
      return;
    }
    if (accel && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      store.paste();
      return;
    }
    if (accel && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      store.select(store.doc.elements.map((element) => element.id));
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!store.selection.length) return;
      event.preventDefault();
      store.transaction('delete', () => {
        for (const id of [...store.selection]) store.removeElement(id);
      });
      return;
    }

    if (event.key === 'Escape') {
      store.select([]);
      return;
    }

    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (nudge && store.selection.length) {
      event.preventDefault();
      const step = event.shiftKey ? store.doc.canvas.grid : store.doc.canvas.grid / 4;
      store.transaction('nudge', () => {
        for (const element of store.selected()) {
          const changes = getType(element.type).move(element, nudge[0] * step, nudge[1] * step);
          if (changes && Object.keys(changes).length) {
            store.updateElement(element.id, changes, { history: false });
          }
        }
      });
    }
  });
}
