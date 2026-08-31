/**
 * PNG export.
 *
 * The SVG carries no external image and no external font, so the canvas never
 * becomes tainted and toDataURL() succeeds. A foreignObject-based math
 * renderer such as KaTeX would break this path, which is one reason the labels
 * use plain SVG text.
 */

import { toSvgDataUrl } from './svg.js';

/** Renders the diagram to a PNG data URL at the given pixel ratio. */
export function toPngDataUrl(doc, view, { scale = 2, background = '#ffffff' } = {}) {
  return new Promise((resolve, reject) => {
    const url = toSvgDataUrl(doc, view, { background });
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      const context = canvas.getContext('2d');
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(new Error(`The canvas could not produce a PNG: ${error.message}`));
      }
    };

    image.onerror = () => reject(new Error('The browser could not load the SVG for rasterisation.'));
    image.src = url;
  });
}
