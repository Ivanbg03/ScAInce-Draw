/**
 * The outline: every shape in the document, in stacking order.
 *
 * With thirty shapes on a canvas, clicking around to find one stops working.
 * The list is the reliable way to select something that sits under something
 * else, and it shows the stacking order that Forward and Back change.
 */

import { el } from '../dom.js';
import { plain } from '../mathtext.js';
import { getType } from '../registry.js';
import { store } from '../store.js';

/** A short human description of one element. */
function describe(element) {
  const type = getType(element.type);
  const source = element.label || element.text || element.title || '';
  // Show the rendered label, not the LaTeX source. "\vec{f}_{k}" is noise
  // in a list; "f⃗k" is recognisable.
  // Strip the combining marks: a list wants a clean string, and only one
  // Windows font renders them anyway.
  const detail = source
    ? plain(source).replace(/[̀-ͯ⃐-⃰]/g, '').slice(0, 22)
    : element.id;
  return { name: type.label, detail };
}

export function createOutline(mount) {
  function render() {
    mount.textContent = '';
    const elements = store.doc.elements;

    if (!elements.length) {
      mount.append(el('p', { class: 'muted small' }, ['The diagram is empty.']));
      return;
    }

    const list = el('ul', { class: 'outline' });

    // Topmost first, so the list reads the way the drawing stacks.
    for (const element of [...elements].reverse()) {
      const { name, detail } = describe(element);
      const selected = store.selection.includes(element.id);

      list.append(el('li', {
        class: `outline-item${selected ? ' is-selected' : ''}`,
        title: `${element.type} · ${element.id}`,
        onclick: (event) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey) store.toggleSelected(element.id);
          else store.select([element.id]);
        },
      }, [
        el('span', { class: 'outline-name' }, [name]),
        el('span', { class: 'outline-detail muted' }, [detail]),
      ]));
    }

    mount.append(list);

    if (store.selection.length === 1) {
      mount.append(el('div', { class: 'row gap' }, [
        el('button', {
          type: 'button', class: 'ghost tiny',
          onclick: () => store.reorder(store.selection[0], 'up'),
        }, ['Forward']),
        el('button', {
          type: 'button', class: 'ghost tiny',
          onclick: () => store.reorder(store.selection[0], 'down'),
        }, ['Back']),
      ]));
    }
  }

  let pending = 0;
  store.subscribe(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; render(); });
  });
  render();
}
