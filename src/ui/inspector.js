/**
 * The properties panel.
 *
 * Every field is generated from the element type's JSON Schema. Nothing here
 * knows about a force or a lens. Add a type to the registry and its panel
 * appears with no change to this file. The same schema becomes the WebMCP
 * inputSchema in phase 2.
 */

import { el, round } from '../dom.js';
import { fieldName, getType, sectionsFor } from '../registry.js';
import { store } from '../store.js';
import { alignSelection, distributeSelection } from './arrange.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

function fieldRow(key, property, control) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', title: `${key} — ${property.description || ''}` }, [
      fieldName(key),
    ]),
    control,
  ]);
}

/** Builds one control from a JSON Schema property. */
function buildControl(key, property, value, onChange) {
  if (property.enum) {
    const select = el('select', {
      onchange: (event) => onChange(event.target.value),
    }, property.enum.map((option) => el('option', {
      value: option,
      selected: option === value ? 'selected' : null,
    }, [option])));
    select.value = value;
    return select;
  }

  if (property.type === 'boolean') {
    return el('input', {
      type: 'checkbox',
      checked: Boolean(value),
      onchange: (event) => onChange(event.target.checked),
    });
  }

  if (property.type === 'number') {
    const step = property.step ?? (property.maximum === 1 ? 0.05 : 0.1);
    const input = el('input', {
      type: 'number',
      value: String(value ?? 0),
      step: String(step),
      min: property.minimum ?? null,
      max: property.maximum ?? null,
      onchange: (event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      },
    });

    // A bounded value also gets a slider. Dragging beats typing for an angle
    // or an opacity, and the number stays visible beside it.
    if (property.minimum !== undefined && property.maximum !== undefined) {
      const slider = el('input', {
        type: 'range',
        class: 'slider',
        min: String(property.minimum),
        max: String(property.maximum),
        step: String(step),
        value: String(value ?? 0),
        oninput: (event) => { input.value = event.target.value; },
        onchange: (event) => onChange(Number(event.target.value)),
      });
      return el('div', { class: 'number-pair' }, [input, slider]);
    }
    return input;
  }

  if (property.format === 'color') {
    // A text field alongside the picker, so "none" and a named colour work.
    // "change", not "input": an input event on every pointer move would
    // rebuild the panel underneath the open picker.
    const picker = el('input', {
      type: 'color',
      class: 'swatch',
      value: HEX.test(value) ? value : '#000000',
      onchange: (event) => onChange(event.target.value),
    });
    const text = el('input', {
      type: 'text',
      class: 'colour-text',
      value: String(value ?? ''),
      onchange: (event) => onChange(event.target.value.trim()),
    });
    return el('div', { class: 'colour-pair' }, [picker, text]);
  }

  if (property.format === 'elementRef') {
    const options = [el('option', { value: '' }, ['(none)'])];
    for (const element of store.doc.elements) {
      if (element.id === store.selection[0]) continue;
      const type = getType(element.type);
      options.push(el('option', {
        value: element.id,
        selected: element.id === value ? 'selected' : null,
      }, [`${type.label} · ${element.id}`]));
    }
    const select = el('select', { onchange: (event) => onChange(event.target.value) }, options);
    select.value = value ?? '';
    return select;
  }

  const isLong = property.format === 'points' || property.format === 'expression';
  return el('input', {
    type: 'text',
    class: isLong ? 'wide mono' : null,
    value: String(value ?? ''),
    spellcheck: 'false',
    onchange: (event) => onChange(event.target.value),
  });
}

export function createInspector(mount) {
  function render() {
    mount.textContent = '';
    const selected = store.selected();

    if (selected.length === 0) {
      mount.append(el('p', { class: 'muted small' }, [
        'Select a shape, or drag one from the palette.',
      ]));
      mount.append(canvasPanel());
      return;
    }

    if (selected.length > 1) {
      mount.append(multiPanel(selected));
      return;
    }

    const element = selected[0];
    const type = getType(element.type);

    mount.append(el('div', { class: 'inspector-head' }, [
      el('strong', {}, [type.label]),
      el('code', { class: 'id-chip', title: 'The id other shapes use to reference this one' }, [element.id]),
    ]));
    if (type.hint) mount.append(el('p', { class: 'muted small' }, [type.hint]));

    const problems = el('p', { class: 'problem small' });
    problems.hidden = true;
    mount.append(problems);

    const apply = (key, next, control) => {
      try {
        store.updateElement(element.id, { [key]: next });
        problems.hidden = true;
      } catch (error) {
        problems.textContent = error.message;
        problems.hidden = false;
        // Put the field back to what the document actually holds, so the panel
        // never shows a value that was not accepted.
        const input = control && control.querySelector
          ? (control.querySelector('input, select') || control)
          : control;
        if (input && 'value' in input) input.value = String(element[key]);
      }
    };

    for (const [section, fields] of sectionsFor(type.schema)) {
      const body = el('div', { class: 'section-body' });
      for (const [key, property] of fields) {
        let control;
        control = buildControl(key, property, element[key], (next) => apply(key, next, control));
        body.append(fieldRow(key, property, control));
      }
      mount.append(el('details', { class: 'section', open: 'open' }, [
        el('summary', { class: 'section-title' }, [section]),
        body,
      ]));
    }

    mount.append(el('div', { class: 'row gap' }, [
      el('button', { type: 'button', class: 'ghost', title: 'Ctrl+D', onclick: () => store.duplicate() }, ['Duplicate']),
      el('button', { type: 'button', class: 'ghost', onclick: () => store.reorder(element.id, 'up') }, ['Forward']),
      el('button', { type: 'button', class: 'ghost', onclick: () => store.reorder(element.id, 'down') }, ['Back']),
      el('button', { type: 'button', class: 'danger', onclick: () => store.removeElement(element.id) }, ['Delete']),
    ]));
  }

  /** The panel for two or more shapes: align, distribute, bulk style. */
  function multiPanel(selected) {
    const box = el('div', {}, [
      el('div', { class: 'inspector-head' }, [
        el('strong', {}, [`${selected.length} shapes selected`]),
      ]),
    ]);

    const alignRow = (title, buttons) => el('div', { class: 'arrange-row' }, [
      el('span', { class: 'muted small arrange-label' }, [title]),
      ...buttons.map(([label, action, hint]) => el('button', {
        type: 'button', class: 'ghost tiny', title: hint, onclick: action,
      }, [label])),
    ]);

    box.append(el('details', { class: 'section', open: 'open' }, [
      el('summary', { class: 'section-title' }, ['Arrange']),
      el('div', { class: 'section-body' }, [
        alignRow('Align', [
          ['Left', () => alignSelection('left'), 'Align the left edges'],
          ['Centre', () => alignSelection('centreX'), 'Align the vertical centres'],
          ['Right', () => alignSelection('right'), 'Align the right edges'],
        ]),
        alignRow('', [
          ['Top', () => alignSelection('top'), 'Align the top edges'],
          ['Middle', () => alignSelection('centreY'), 'Align the horizontal centres'],
          ['Bottom', () => alignSelection('bottom'), 'Align the bottom edges'],
        ]),
        alignRow('Space', [
          ['Across', () => distributeSelection('x'), 'Space them evenly left to right'],
          ['Down', () => distributeSelection('y'), 'Space them evenly top to bottom'],
        ]),
      ]),
    ]));

    // Any field every selected shape shares can be set for all of them at once.
    const shared = sharedFields(selected);
    if (shared.length) {
      const body = el('div', { class: 'section-body' });
      for (const [key, property] of shared) {
        const first = selected[0][key];
        const same = selected.every((element) => element[key] === first);
        const control = buildControl(key, property, same ? first : '', (next) => {
          store.transaction(`set ${key}`, () => {
            for (const element of selected) {
              try {
                store.updateElement(element.id, { [key]: next }, { history: false });
              } catch { /* a shape that rejects the value keeps its own */ }
            }
          });
        });
        body.append(fieldRow(key, property, control));
      }
      box.append(el('details', { class: 'section', open: 'open' }, [
        el('summary', { class: 'section-title' }, ['Shared style']),
        body,
      ]));
    }

    box.append(el('div', { class: 'row gap' }, [
      el('button', { type: 'button', class: 'ghost', onclick: () => store.duplicate() }, ['Duplicate']),
      el('button', {
        type: 'button', class: 'danger',
        onclick: () => store.transaction('delete', () => {
          for (const id of [...store.selection]) store.removeElement(id);
        }),
      }, ['Delete all']),
    ]));

    return box;
  }

  /** The style fields that every selected shape has in common. */
  function sharedFields(selected) {
    const [first, ...rest] = selected.map((element) => getType(element.type).schema.properties);
    const keys = ['color', 'strokeWidth', 'style', 'fill', 'labelSize'];
    return keys
      .filter((key) => Object.hasOwn(first, key) && rest.every((properties) => Object.hasOwn(properties, key)))
      .map((key) => [key, first[key]]);
  }

  function canvasPanel() {
    const canvas = store.doc.canvas;
    const body = el('div', { class: 'section-body' });

    const numberField = (key, label, step = 1, min = 0.5) => {
      const input = el('input', {
        type: 'number', value: String(canvas[key]), step: String(step), min: String(min),
        onchange: (event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= min) {
            store.setCanvas({ [key]: next });
          } else {
            // Never leave the box showing a value the document does not hold.
            input.value = String(store.doc.canvas[key]);
          }
        },
      });
      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, [label]),
        input,
      ]);
    };

    body.append(numberField('width', 'Width (units)'));
    body.append(numberField('height', 'Height (units)'));
    body.append(numberField('grid', 'Grid step', 0.25, 0.05));
    body.append(el('div', { class: 'field' }, [
      el('label', { class: 'field-label' }, ['Show grid']),
      el('input', {
        type: 'checkbox', checked: canvas.showGrid,
        onchange: (event) => store.setCanvas({ showGrid: event.target.checked }),
      }),
    ]));
    body.append(el('div', { class: 'field' }, [
      el('label', { class: 'field-label' }, ['Snap to grid']),
      el('input', {
        type: 'checkbox', checked: canvas.snap,
        onchange: (event) => store.setCanvas({ snap: event.target.checked }),
      }),
    ]));

    return el('details', { class: 'section', open: 'open' }, [
      el('summary', { class: 'section-title' }, ['Canvas']),
      body,
    ]);
  }

  // A drag emits on every pointer move. One rebuild per frame is enough.
  let pending = 0;
  const scheduleRender = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      // Do not rebuild the panel while the user types in one of its fields.
      const active = document.activeElement;
      if (mount.contains(active) && active.tagName === 'INPUT'
        && (active.type === 'text' || active.type === 'number')) return;
      render();
    });
  };

  store.subscribe(scheduleRender);
  render();
}


