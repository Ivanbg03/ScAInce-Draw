/** SVG export. It reuses the renderer with the interactive layers switched off. */

import { renderDocument, EXPORT_SCALE } from '../render.js';

/** Returns the diagram as an SVG source string. */
export function toSvgSource(doc, view, { background = '#ffffff', scale = EXPORT_SCALE } = {}) {
  // The screen zoom is overridden here, so an export never changes when the
  // user zooms. Pass an explicit scale to render at a different resolution.
  const { root } = renderDocument(doc, { ...view, scale }, {
    selection: [],
    interactive: false,
    background,
  });

  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const source = new XMLSerializer().serializeToString(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${source}\n`;
}

/** A data URL for the same source. The PNG export draws it into a canvas. */
export function toSvgDataUrl(doc, view, options) {
  const source = toSvgSource(doc, view, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}
