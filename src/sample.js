/**
 * The starter document: a balanced Wheatstone bridge.
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

  const sideLength = Math.hypot(3.5, 3);
  const sideAngle = Math.atan2(3, 3.5) * 180 / Math.PI;

  return {
    title: 'Wheatstone bridge',
    canvas: {
      ...emptyDocument().canvas,
      width: 14.2,
      height: 10.4,
      grid: 0.2,
    },
    elements: [
      make('resistor', {
        id: 'R1', x: 6.25, y: 6.7, length: sideLength, angle: sideAngle,
        kind: 'zigzag', label: 'R_1', labelSide: 'left', labelSize: 17,
        color: '#1f2937', strokeWidth: 2.3,
      }),
      make('resistor', {
        id: 'R2', x: 6.25, y: 3.7, length: sideLength, angle: 180 - sideAngle,
        kind: 'zigzag', label: 'R_2', labelSide: 'left', labelSize: 17,
        color: '#1f2937', strokeWidth: 2.3,
      }),
      make('resistor', {
        id: 'R3', x: 9.75, y: 6.7, length: sideLength, angle: 180 - sideAngle,
        kind: 'zigzag', label: 'R_3', labelSide: 'right', labelSize: 17,
        color: '#1f2937', strokeWidth: 2.3,
      }),
      make('resistor', {
        id: 'R4', x: 9.75, y: 3.7, length: sideLength, angle: sideAngle,
        kind: 'zigzag', label: 'R_4', labelSide: 'right', labelSize: 17,
        color: '#1f2937', strokeWidth: 2.3,
      }),
      make('meter', {
        id: 'G', x: 8, y: 5.2, length: 7, angle: 0,
        kind: 'galvanometer', label: '', size: 0.78,
        color: '#0f766e', strokeWidth: 2.4,
      }),
      make('source', {
        id: 'Vs', x: 2.35, y: 5.2, length: 3, angle: 90,
        kind: 'battery', cells: 2, label: 'V_s', labelSide: 'right',
        labelSize: 17, size: 0.75, color: '#b45309', strokeWidth: 2.3,
      }),
      make('wire', {
        id: 'top-supply', points: '2.35,3.7 2.35,2.2 8,2.2',
        route: 'orthogonal', dots: 'ends', color: '#334155', strokeWidth: 2.3,
      }),
      make('wire', {
        id: 'bottom-supply', points: '2.35,6.7 2.35,8.2 8,8.2',
        route: 'orthogonal', dots: 'ends', color: '#334155', strokeWidth: 2.3,
      }),
      make('label', {
        id: 'balance', x: 8, y: 9.45,
        text: '\\frac{R_1}{R_2}=\\frac{R_3}{R_4}',
        size: 22, color: '#111827', anchor: 'middle',
      }),
    ],
  };
}
