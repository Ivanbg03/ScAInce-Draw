/**
 * Light, dark, or follow the system.
 *
 * The choice is an attribute on the root element, so the stylesheet decides
 * everything and no colour is computed in JavaScript. It is read before the
 * first paint in main.js, which avoids a flash of the wrong theme.
 */

const KEY = 'diagram-studio:theme';
export const THEMES = ['system', 'light', 'dark'];

/** Reads the saved choice, or a ?theme= override for a screenshot or a link. */
export function currentTheme() {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (THEMES.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(KEY);
    if (THEMES.includes(saved)) return saved;
  } catch { /* a private window: fall back to the system setting */ }
  return 'system';
}

export function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch { /* nothing to do: the attribute is already set */ }
}

/** Steps system to light to dark and back. */
export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}
