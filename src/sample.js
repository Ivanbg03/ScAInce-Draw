/**
 * The starter document: a block on an incline.
 *
 * It is built through createElement, so every schema default is filled in and
 * the sample cannot drift out of step with the type definitions.
 */

import { createElement } from './registry.js';
import { emptyDocument } from './store.js';

export function sampleDocument() {
  const taken = new Set();
  const make = (type, values) => {
    const element = createElement(type, values, taken);
    taken.add(element.id);
    return element;
  };

  const incline = 25;
  const body = make('body', {
    id: 'block',
    x: 6.67, y: 6.0, width: 2.4, height: 1.4, angle: incline,
    fill: '#dbeafe', label: 'm', labelSize: 17,
  });

  return {
    title: 'Block on an incline',
    // Inherit the canvas defaults rather than restate them, so the grid
    // step is defined in exactly one place.
    canvas: emptyDocument().canvas,
    elements: [
      make('surface', {
        id: 'ground',
        x: 2, y: 3, length: 12, angle: incline, side: 'below',
        hatchStep: 0.45, color: '#334155', label: '',
      }),
      make('arrow', {
        id: 'horizontal-ref',
        x1: 2, y1: 3, x2: 9, y2: 3,
        head: 'none', style: 'dashed', width: 1.5, color: '#94a3b8',
      }),
      make('angle', {
        id: 'incline-angle',
        x: 2, y: 3, from: 0, to: incline, radius: 2.2,
        color: '#334155', label: '\\theta', labelSize: 17,
      }),
      body,
      make('force', {
        id: 'weight',
        bodyId: body.id, magnitude: 2.6, angle: -90,
        color: '#b91c1c', label: 'm\\vec{g}', labelSide: 'right',
      }),
      make('force', {
        id: 'normal',
        bodyId: body.id, magnitude: 2.0, angle: incline + 90,
        color: '#1d4ed8', label: '\\vec{N}', labelSide: 'left',
      }),
      make('force', {
        id: 'friction',
        bodyId: body.id, magnitude: 1.5, angle: incline,
        color: '#15803d', label: '\\vec{f}_{k}', labelSide: 'left',
      }),
      make('label', {
        id: 'caption',
        x: 12, y: 14.4, text: 'Block on an incline', size: 22, color: '#0f172a',
      }),
      make('label', {
        id: 'note',
        x: 12, y: 13.4,
        text: 'Drag the arrow tip. Add a plot, a block or a lens from the palette.',
        size: 13, color: '#64748b',
      }),
    ],
  };
}
