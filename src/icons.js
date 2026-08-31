/**
 * Palette icons.
 *
 * An icon is not hand-drawn artwork. It is the element's own render function
 * running on a small canvas, so the icon always matches what the canvas draws.
 * This table only supplies a framing: how big the mini canvas is, which field
 * values make the shape fill it, and — for a plot type — a faint set of axes to
 * hang it on.
 */

export const ICON_AXES_ID = 'icon-axes';

/** A framing for a type that needs an axes to have any coordinates. */
function withAxes(w, h, values, range = 1.2) {
  return {
    w,
    h,
    extra: [{
      type: 'axes',
      id: ICON_AXES_ID,
      values: {
        x: 0.15, y: 0.15, width: w - 0.3, height: h - 0.3,
        xMin: -range, xMax: range, yMin: -range, yMax: range,
        tickX: 0, tickY: 0, xLabel: '', yLabel: '',
        color: '#cbd5e1', strokeWidth: 1,
      },
    }],
    values: { axesId: ICON_AXES_ID, ...values },
  };
}

const ICONS = {
  /* Common */
  label: { w: 3, h: 2, values: { x: 1.5, y: 1, text: 'A', size: 30 } },
  arrow: { w: 3, h: 2, values: { x1: 0.3, y1: 0.4, x2: 2.7, y2: 1.6 } },
  polyline: { w: 3, h: 2, values: { points: '0.3,0.4 1.2,1.6 1.9,0.6 2.7,1.5' } },
  angle: { w: 2.6, h: 2, values: { x: 0.5, y: 0.5, from: 0, to: 55, radius: 1.3, label: '\\theta' } },
  dimension: { w: 3.4, h: 2, values: { x1: 0.4, y1: 0.5, x2: 3, y2: 0.5, offset: 0.7, tick: 0.25, autoLength: false } },
  'text-box': { w: 3.4, h: 2, values: { x: 1.7, y: 1, width: 2.8, height: 1.1, text: 'Note', size: 13 } },
  brace: { w: 3.4, h: 1.8, values: { x: 0.4, y: 0.6, length: 2.6, depth: 0.45 } },
  shape: { w: 2.8, h: 2.4, values: { x: 1.4, y: 1.2, kind: 'circle', width: 1.9, fill: '#dbeafe', fillOpacity: 0.7 } },
  'axis-frame': { w: 2.6, h: 2.4, values: { x: 0.75, y: 0.55, kind: '3d', size: 1.4, labelSize: 11 } },

  /* Mechanics */
  body: { w: 3, h: 2, values: { x: 1.5, y: 1, width: 2, height: 1.1 } },
  force: { w: 3, h: 2, values: { x: 0.6, y: 0.4, magnitude: 1.9, angle: 50 } },
  moment: { w: 2.4, h: 2.2, values: { x: 1.2, y: 1.1, radius: 0.78, from: 40, to: 300 } },
  surface: { w: 3, h: 1.6, values: { x: 0.3, y: 1.05, length: 2.4, hatchStep: 0.4 } },
  spring: { w: 3.4, h: 1.6, values: { x: 0.3, y: 0.8, length: 2.8, coils: 5, amplitude: 0.34 } },
  damper: { w: 3.4, h: 1.6, values: { x: 0.3, y: 0.8, length: 2.8, size: 0.38 } },
  support: { w: 2.6, h: 2, values: { x: 1.3, y: 1.55, size: 0.6, kind: 'pin' } },
  pulley: { w: 2.6, h: 2.8, values: { x: 1.3, y: 1.8, radius: 0.5, ropeLeft: 1.3, ropeRight: 1.3 } },

  /* Plots */
  axes: {
    w: 3.2, h: 2.6,
    values: {
      x: 0.35, y: 0.3, width: 2.5, height: 2,
      xMin: -1, xMax: 3, yMin: -1, yMax: 3,
      tickX: 0, tickY: 0, xLabel: '', yLabel: '',
    },
  },
  curve: withAxes(3.2, 2.4, { expression: 'sin(3*x)', from: -1.2, to: 1.2, samples: 80 }),
  marker: withAxes(2.2, 2.2, { dataX: 0.4, dataY: 0.5, size: 6, shape: 'dot', showGuides: true }),
  area: withAxes(3.2, 2.4, { expression: 'cos(2*x)', from: -0.8, to: 0.8, samples: 40, fillOpacity: 0.45 }),
  parametric: withAxes(2.6, 2.6, { xExpression: 'cos(t)', yExpression: 'sin(t)', samples: 90 }),
  polar: withAxes(2.6, 2.6, { rExpression: 'cos(3*t)', samples: 200 }),
  scatter: withAxes(3.2, 2.4, {
    data: '-1,-0.7 -0.5,-0.3 0,0.15 0.5,0.55 1,0.95', connect: true, size: 3,
  }),

  /* Fields */
  'vector-field': withAxes(2.8, 2.6, { columns: 4, rows: 4, arrowScale: 0.9, strokeWidth: 1 }),
  charge: { w: 2, h: 2, values: { x: 1, y: 1, radius: 0.55, sign: 'positive' } },
  wave: { w: 3.4, h: 1.8, values: { x: 0.2, y: 0.9, length: 3, amplitude: 0.5, wavelength: 1.2 } },

  /* Circuit — a two-terminal part fills the icon lead to lead. */
  resistor: { w: 3.4, h: 1.4, values: { x: 1.7, y: 0.7, length: 3, size: 0.6 } },
  capacitor: { w: 3.4, h: 1.4, values: { x: 1.7, y: 0.7, length: 3, size: 0.8 } },
  inductor: { w: 3.4, h: 1.4, values: { x: 1.7, y: 0.6, length: 3, size: 0.6, loops: 4 } },
  source: { w: 3.4, h: 1.6, values: { x: 1.7, y: 0.8, length: 3, size: 0.6, kind: 'battery' } },
  switch: { w: 3.4, h: 1.6, values: { x: 1.7, y: 0.6, length: 3, size: 0.5, kind: 'open' } },
  diode: { w: 3.4, h: 1.4, values: { x: 1.7, y: 0.7, length: 3, size: 0.7 } },
  lamp: { w: 3.4, h: 1.8, values: { x: 1.7, y: 0.9, length: 3, size: 0.6 } },
  meter: { w: 3.4, h: 1.8, values: { x: 1.7, y: 0.9, length: 3, size: 0.6, kind: 'ammeter' } },
  ground: { w: 2, h: 2, values: { x: 1, y: 1.7, size: 0.5, kind: 'earth' } },
  wire: { w: 3.2, h: 2, values: { points: '0.3,1.6 2,1.6 2,0.4 2.9,0.4', dots: 'ends', dotSize: 3 } },

  /* Schematic */
  block: { w: 3.4, h: 2, values: { x: 1.7, y: 1, width: 2.8, height: 1.2 } },
  link: { w: 3.4, h: 1.4, values: { x1: 0.3, y1: 0.7, x2: 3.1, y2: 0.7 } },
  node: { w: 2, h: 2, values: { x: 1, y: 1, r: 0.6, symbol: 'sum' } },
  container: { w: 3.4, h: 2.4, values: { x: 1.7, y: 1.2, width: 2.9, height: 1.9, title: 'Group' } },

  /* Optics */
  'optical-axis': { w: 3.4, h: 1.2, values: { x: 0.3, y: 0.6, length: 2.8 } },
  lens: { w: 2.4, h: 2.6, values: { x: 1.2, y: 1.3, height: 2, kind: 'converging', showFoci: false } },
  mirror: { w: 2.2, h: 2.6, values: { x: 1.2, y: 1.3, height: 2, kind: 'concave', curvature: 0.4 } },
  ray: { w: 3.4, h: 2, values: { points: '0.3,1.5 1.7,1.5 3.1,0.5', head: 'middle' } },
  'object-arrow': { w: 2, h: 2.4, values: { x: 1, y: 0.4, height: 1.6 } },
  screen: { w: 2, h: 2.6, values: { x: 1.1, y: 1.3, height: 2 } },
  prism: { w: 2.8, h: 2.6, values: { x: 1.4, y: 1.3, size: 2 } },
};

const FALLBACK = { w: 3, h: 2, values: { x: 1.5, y: 1 } };

/** The icon framing for a type. Every label is stripped, so icons stay clean. */
export function iconFor(typeName) {
  const entry = ICONS[typeName] || FALLBACK;
  return {
    w: entry.w,
    h: entry.h,
    extra: entry.extra || [],
    values: { label: '', ...entry.values },
  };
}
