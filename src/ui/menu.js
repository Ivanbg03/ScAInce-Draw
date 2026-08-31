/** The right-click menu on the canvas. */

import { el } from '../dom.js';
import { store } from '../store.js';

let open = null;

function close() {
  if (!open) return;
  open.remove();
  open = null;
}

/** Shows a menu at the pointer, clamped to stay on screen. */
function show(x, y, items) {
  close();

  const menu = el('div', { class: 'context-menu', role: 'menu' });
  for (const item of items) {
    if (item === '-') {
      menu.append(el('hr'));
      continue;
    }
    menu.append(el('button', {
      type: 'button',
      class: `context-item${item.danger ? ' danger' : ''}`,
      disabled: item.enabled === false ? 'disabled' : null,
      onclick: () => { close(); item.run(); },
    }, [
      el('span', {}, [item.label]),
      item.keys ? el('kbd', {}, [item.keys]) : null,
    ].filter(Boolean)));
  }

  document.body.append(menu);
  open = menu;

  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - box.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - box.height - 8)}px`;
}

export function attachContextMenu(container) {
  container.addEventListener('contextmenu', (event) => {
    const node = event.target.closest('.element[data-id]');
    event.preventDefault();

    if (node) {
      const id = node.dataset.id;
      if (!store.selection.includes(id)) store.select([id]);
    }

    const count = store.selection.length;
    const many = count > 1;

    show(event.clientX, event.clientY, [
      {
        label: many ? `Duplicate ${count} shapes` : 'Duplicate',
        keys: 'Ctrl+D',
        enabled: count > 0,
        run: () => store.duplicate(),
      },
      { label: 'Copy', keys: 'Ctrl+C', enabled: count > 0, run: () => store.copy() },
      { label: 'Paste', keys: 'Ctrl+V', enabled: store.canPaste(), run: () => store.paste() },
      '-',
      {
        label: 'Bring forward',
        enabled: count === 1,
        run: () => store.reorder(store.selection[0], 'up'),
      },
      {
        label: 'Send back',
        enabled: count === 1,
        run: () => store.reorder(store.selection[0], 'down'),
      },
      '-',
      {
        label: 'Select all',
        keys: 'Ctrl+A',
        run: () => store.select(store.doc.elements.map((element) => element.id)),
      },
      {
        label: many ? `Delete ${count} shapes` : 'Delete',
        keys: 'Del',
        danger: true,
        enabled: count > 0,
        run: () => store.transaction('delete', () => {
          for (const id of [...store.selection]) store.removeElement(id);
        }),
      },
    ]);
  });

  window.addEventListener('pointerdown', (event) => {
    if (open && !open.contains(event.target)) close();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('blur', close);
}
