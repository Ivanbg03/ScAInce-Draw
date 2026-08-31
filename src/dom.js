/** Small DOM helpers. No framework. */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element. Null and undefined attributes are skipped. */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/** Creates an HTML element. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Rounds a number for a tidy SVG attribute or an export line. */
export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

/** Clamps a number. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const DEG = Math.PI / 180;

/** Starts a browser download for a blob or a data URL. */
export function download(filename, data, mime) {
  const url = typeof data === 'string' && data.startsWith('data:')
    ? data
    : URL.createObjectURL(new Blob([data], { type: mime || 'text/plain' }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
}
