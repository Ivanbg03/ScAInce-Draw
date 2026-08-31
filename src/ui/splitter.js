/**
 * Draggable, collapsible panel dividers.
 *
 * The drawing space is whatever is left over, so being able to take space back
 * from the two side panels is the only way to make it bigger on a laptop.
 * The widths live in CSS custom properties on the layout, so the grid does the
 * work and nothing is positioned from JavaScript.
 */

const KEY = 'diagram-studio:panels';
const MIN = 140;   // px: narrower than this and a panel is unusable
const MAX = 520;

const DEFAULTS = { left: 240, right: 304 };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.right === 'number') return saved;
  } catch { /* fall through to the defaults */ }
  return { ...DEFAULTS };
}

function save(sizes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch { /* a private window: the layout still works, it just will not persist */ }
}

export function createSplitters(layout) {
  const sizes = load();

  const apply = () => {
    layout.style.setProperty('--left-w', `${sizes.left}px`);
    layout.style.setProperty('--right-w', `${sizes.right}px`);
    layout.classList.toggle('left-collapsed', sizes.left === 0);
    layout.classList.toggle('right-collapsed', sizes.right === 0);
  };
  apply();

  for (const splitter of layout.querySelectorAll('.splitter')) {
    const side = splitter.dataset.side;
    let drag = null;

    splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, start: sizes[side] || 0 };
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add('is-dragging');
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const delta = side === 'left' ? event.clientX - drag.x : drag.x - event.clientX;
      const next = drag.start + delta;
      // Dragging a panel below its minimum collapses it, the way a real
      // editor behaves, instead of fighting the pointer.
      sizes[side] = next < MIN * 0.6 ? 0 : Math.min(MAX, Math.max(MIN, next));
      apply();
    });

    const stop = (event) => {
      if (!drag) return;
      try { splitter.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
      splitter.classList.remove('is-dragging');
      drag = null;
      save(sizes);
    };
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);

    // A double click collapses the panel, or restores it.
    splitter.addEventListener('dblclick', () => {
      sizes[side] = sizes[side] === 0 ? DEFAULTS[side] : 0;
      apply();
      save(sizes);
    });
  }

  /** Collapses or restores one panel. The toolbar buttons call this. */
  return function togglePanel(side) {
    sizes[side] = sizes[side] === 0 ? DEFAULTS[side] : 0;
    apply();
    save(sizes);
  };
}
