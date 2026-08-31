/**
 * The document store.
 *
 * The document is plain JSON. Every mutation goes through this class, so the
 * undo history, the autosave and the redraw stay consistent. In phase 2 the
 * WebMCP tools call exactly these methods, which is why the agent path and the
 * GUI path cannot drift apart.
 */

import { createElement, getType, nextId, validate } from './registry.js';

const STORAGE_KEY = 'diagram-studio:document';
const HISTORY_LIMIT = 100;

// The clipboard lives for the session only. It is deliberately not persisted.
let clipboard = [];

export function emptyDocument() {
  return {
    title: 'Untitled diagram',
    canvas: { width: 24, height: 16, grid: 0.5, showGrid: true, snap: true },
    elements: [],
  };
}

class Store {
  doc = emptyDocument();
  selection = [];
  // 30 px/unit puts the whole 24x16 sheet inside the canvas pane. The exports
  // do not follow this number; see EXPORT_SCALE in render.js.
  view = { scale: 30, panX: 0, panY: 0 };

  #listeners = new Set();
  #undo = [];
  #redo = [];
  #batch = 0;

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(reason = 'change') {
    if (this.#batch > 0) return;
    for (const listener of this.#listeners) listener(this, reason);
    this.#save();
  }

  /** Groups several mutations into one undo step. */
  transaction(label, work) {
    this.#pushUndo(label);
    this.#batch++;
    try {
      return work();
    } finally {
      this.#batch--;
      this.emit('transaction');
    }
  }

  /* ------------------------- history ------------------------- */

  #pushUndo(label) {
    // A transaction records the state once, before it opens. Every mutation
    // inside it must not record again, or deleting a selection of three
    // hundred shapes would take three hundred undos to reverse.
    if (this.#batch > 0) return;
    this.#undo.push({ label, snapshot: JSON.stringify(this.doc) });
    if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    this.#redo.length = 0;
  }

  undo() {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push({ label: entry.label, snapshot: JSON.stringify(this.doc) });
    this.doc = JSON.parse(entry.snapshot);
    this.selection = this.selection.filter((id) => this.byId(id));
    this.emit('undo');
    return true;
  }

  redo() {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push({ label: entry.label, snapshot: JSON.stringify(this.doc) });
    this.doc = JSON.parse(entry.snapshot);
    this.selection = this.selection.filter((id) => this.byId(id));
    this.emit('redo');
    return true;
  }

  canUndo() { return this.#undo.length > 0; }
  canRedo() { return this.#redo.length > 0; }

  /* ------------------------- reads --------------------------- */

  byId(id) {
    return this.doc.elements.find((element) => element.id === id) || null;
  }

  byType(typeName) {
    return this.doc.elements.filter((element) => element.type === typeName);
  }

  ids() {
    return new Set(this.doc.elements.map((element) => element.id));
  }

  selected() {
    return this.selection.map((id) => this.byId(id)).filter(Boolean);
  }

  /* ------------------------- writes -------------------------- */

  addElement(typeName, overrides = {}) {
    const element = createElement(typeName, overrides, this.ids());
    const problems = validate(getType(typeName).schema, element);
    if (problems.length) throw new Error(problems.join(' '));

    this.#pushUndo(`add ${typeName}`);
    this.doc.elements.push(element);
    this.selection = [element.id];
    this.emit('add');
    return element;
  }

  updateElement(id, changes, { history = true } = {}) {
    const element = this.byId(id);
    if (!element) throw new Error(`No element with the id "${id}".`);

    const candidate = { ...element, ...changes };
    const problems = validate(getType(element.type).schema, candidate);
    if (problems.length) throw new Error(problems.join(' '));

    if (history) this.#pushUndo(`edit ${id}`);
    Object.assign(element, changes);
    this.emit('update');
    return element;
  }

  removeElement(id) {
    const index = this.doc.elements.findIndex((element) => element.id === id);
    if (index < 0) throw new Error(`No element with the id "${id}".`);

    this.#pushUndo(`remove ${id}`);
    const [removed] = this.doc.elements.splice(index, 1);

    // Drop any reference that now points at nothing.
    for (const element of this.doc.elements) {
      for (const [key, value] of Object.entries(element)) {
        if (value === id) element[key] = '';
      }
    }

    this.selection = this.selection.filter((item) => item !== id);
    this.emit('remove');
    return removed;
  }

  reorder(id, direction) {
    const index = this.doc.elements.findIndex((element) => element.id === id);
    if (index < 0) return;
    const target = direction === 'up' ? index + 1 : index - 1;
    if (target < 0 || target >= this.doc.elements.length) return;

    this.#pushUndo(`reorder ${id}`);
    const [element] = this.doc.elements.splice(index, 1);
    this.doc.elements.splice(target, 0, element);
    this.emit('reorder');
  }

  select(ids) {
    this.selection = [].concat(ids ?? []).filter(Boolean);
    this.emit('select');
  }

  toggleSelected(id) {
    this.selection = this.selection.includes(id)
      ? this.selection.filter((item) => item !== id)
      : [...this.selection, id];
    this.emit('select');
  }

  /* --------------------- copy and duplicate ------------------- */

  /**
   * Clones a list of elements into the document.
   *
   * References are remapped inside the cloned set. Duplicate a body together
   * with its forces and the copies point at the copied body, not the original.
   * A reference to something outside the set is kept as it was.
   */
  #clone(elements, offset) {
    const taken = this.ids();
    const remap = new Map();
    const clones = [];

    for (const source of elements) {
      const copy = structuredClone(source);
      copy.id = nextId(source.type, taken);
      taken.add(copy.id);
      remap.set(source.id, copy.id);
      clones.push(copy);
    }

    for (const copy of clones) {
      for (const [key, value] of Object.entries(copy)) {
        if (key !== 'id' && typeof value === 'string' && remap.has(value)) {
          copy[key] = remap.get(value);
        }
      }
    }

    this.doc.elements.push(...clones);

    // Nudge the copies so they do not hide the originals.
    if (offset) {
      for (const copy of clones) {
        const type = getType(copy.type);
        const changes = type.move(copy, offset, -offset);
        if (changes) Object.assign(copy, changes);
      }
    }

    this.selection = clones.map((copy) => copy.id);
    return clones;
  }

  duplicate() {
    const selected = this.selected();
    if (!selected.length) return [];
    this.#pushUndo('duplicate');
    const clones = this.#clone(selected, this.doc.canvas.grid);
    this.emit('duplicate');
    return clones;
  }

  copy() {
    clipboard = this.selected().map((element) => structuredClone(element));
    return clipboard.length;
  }

  paste() {
    if (!clipboard.length) return [];
    this.#pushUndo('paste');
    const clones = this.#clone(clipboard, this.doc.canvas.grid);
    this.emit('paste');
    return clones;
  }

  canPaste() { return clipboard.length > 0; }

  /**
   * Moves every shape by the same amount.
   *
   * A follower is skipped: its parent moves, and it is drawn relative to that
   * parent, so shifting both would move it twice.
   */
  shiftAll(dx, dy, { history = true } = {}) {
    if (dx === 0 && dy === 0) return;
    if (history) this.#pushUndo('shift');

    for (const element of this.doc.elements) {
      const type = getType(element.type);
      if (type.attachedTo && type.attachedTo(element)) continue;
      const changes = type.move(element, dx, dy);
      if (changes) Object.assign(element, changes);
    }
    this.emit('shift');
  }

  setCanvas(changes, { history = true } = {}) {
    if (history) this.#pushUndo('canvas');
    Object.assign(this.doc.canvas, changes);
    this.emit('canvas');
  }

  setTitle(title) {
    this.#pushUndo('title');
    this.doc.title = title;
    this.emit('title');
  }

  replaceDocument(next, { history = true } = {}) {
    if (history) this.#pushUndo('replace document');
    const base = emptyDocument();
    this.doc = { ...base, ...next };
    // A canvas that is not an object, and entries that are not elements, both
    // arrive from a corrupt save. Neither may reach the renderer.
    const canvas = next.canvas;
    this.doc.canvas = {
      ...base.canvas,
      ...(canvas && typeof canvas === 'object' && !Array.isArray(canvas) ? canvas : {}),
    };
    this.doc.elements = (Array.isArray(next.elements) ? next.elements : [])
      .filter((element) => element && typeof element === 'object' && typeof element.type === 'string');
    this.selection = [];
    this.emit('replace');
  }

  clear() {
    this.replaceDocument(emptyDocument());
  }

  /* ------------------------ persistence ---------------------- */

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch {
      // A private window or a full quota. The editor still works in memory.
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.elements)) return false;
      // Drop any element whose type this build no longer knows.
      parsed.elements = parsed.elements.filter((element) => {
        try { getType(element.type); return true; } catch { return false; }
      });
      this.replaceDocument(parsed, { history: false });
      return true;
    } catch {
      return false;
    }
  }
}

export const store = new Store();
