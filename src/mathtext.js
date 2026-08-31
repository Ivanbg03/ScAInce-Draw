/**
 * A LaTeX-lite renderer for labels.
 *
 * The document stores the LaTeX source, for example "\vec{F}_{net}".
 * - The SVG shows an approximation: real Unicode symbols and tspan subscripts.
 * - The TikZ export emits the source unchanged inside $...$, so the paper gets
 *   the exact formula.
 *
 * The supported subset: \symbol, _sub, ^sup, {groups}, \vec{}, \hat{}, \bar{},
 * \text{}. It does not support fractions, roots or matrices. Those still export
 * correctly to TikZ; they only look plain on the screen.
 */

import { svg, round } from './dom.js';

/** A stack that actually carries combining marks such as the vector arrow. */
export const MATH_FONT = 'Georgia, "Cambria Math", "Segoe UI Symbol", "Times New Roman", serif';

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', pm: '±', mp: '∓',
  leq: '≤', geq: '≥', neq: '≠', approx: '≈',
  infty: '∞', partial: '∂', nabla: '∇', propto: '∝',
  rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  int: '∫', sum: '∑', sqrt: '√', degree: '°',
  perp: '⊥', parallel: '∥', angle: '∠', circ: '∘',
  // Current into and out of the page, which every magnetic field figure needs.
  otimes: '⊗', odot: '⊙', oplus: '⊕', ominus: '⊖',
  cdots: '⋯', ldots: '…', forall: '∀', exists: '∃', in: '∈',
};

/**
 * Operator names. LaTeX sets these upright, because "cos" is one operator and
 * not the product of c, o and s. Slanting them made a law-of-cosines caption
 * read as four italic variables.
 */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf',
  'det', 'gcd', 'arg', 'deg', 'dim', 'ker', 'Pr',
]);

/**
 * LaTeX spacing commands.
 *
 * These reach toRuns as a backslash followed by punctuation, which the escape
 * branch below used to emit verbatim. "10\,k\Omega" therefore drew a comma
 * between the number and its unit, on every circuit value in the app.
 */
const SPACING = {
  ',': '\u2009',   // thin space
  ':': '\u2005',   // four-per-em space
  ';': '\u2004',   // three-per-em space
  ' ': ' ',
  '!': '',         // negative thin space: nothing is tighter than nothing
};

/**
 * Accent marks.
 *
 * The combining characters below are correct Unicode, and plain() uses them so
 * a copied label keeps its meaning. They are NOT used for drawing: on Windows
 * only Segoe UI Symbol carries a true zero-advance U+20D7, and Chrome will not
 * split one grapheme cluster across two fonts, so "\vec{F}" in a serif face
 * came out as "F" followed by a tofu box. The SVG draws the mark itself from
 * the spacing glyphs in DRAWN, which every font has.
 */
const ACCENTS = {
  vec: '⃗',  // combining right arrow above
  hat: '̂',  // combining circumflex
  bar: '̄',  // combining macron
  dot: '̇',  // combining dot above
  ddot: '̈', // combining diaeresis
};

const DRAWN = {
  vec: { glyph: '→', rise: 0.62, scale: 0.62 },
  hat: { glyph: '^', rise: 0.20, scale: 0.90 },
  bar: { glyph: '¯', rise: 0.16, scale: 0.90 },
  dot: { glyph: '˙', rise: 0.16, scale: 0.90 },
  ddot: { glyph: '¨', rise: 0.16, scale: 0.90 },
};

/**
 * An estimate of how wide a string is, in units of the font size.
 * An accent only has to sit above one or two letters, so an estimate places it
 * well within a pixel or two. Real measurement needs the node to be in the
 * document, which the SVG export never is.
 */
function advanceOf(text, size) {
  let width = 0;
  for (const character of String(text)) {
    if (/[A-Z]/.test(character)) width += 0.70;
    else if (/[mw]/.test(character)) width += 0.82;
    else if (/[iljtf.,'!:;]/.test(character)) width += 0.30;
    else width += 0.52;
  }
  return width * size;
}

/**
 * The characters LaTeX sets in italic: Latin letters and lowercase Greek.
 *
 * Digits, spaces, operators and uppercase Greek stay upright. Slanting the
 * whole label is what made "m_1 = 4.0 kg" read as one long italic phrase
 * instead of a variable, a number and a unit.
 */
const ITALIC_CHAR = /[A-Za-z\u03b1-\u03c9\u03d1\u03d5\u03d6]/;

function splitByStyle(value) {
  const parts = [];
  for (const char of String(value)) {
    const italic = ITALIC_CHAR.test(char);
    const last = parts[parts.length - 1];
    if (last && last.italic === italic) last.text += char;
    else parts.push({ text: char, italic });
  }
  return parts;
}

/**
 * Splits the source into runs.
 * A run is { text, shift, upright } where shift is 'base', 'sub' or 'sup'.
 */
export function toRuns(source) {
  const text = String(source ?? '');
  const runs = [];
  let index = 0;

  // With $...$ the label is prose that contains formulas, exactly as LaTeX
  // reads it: "Area under $f$ from $x = 0$" sets the sentence upright and
  // only the delimited spans in maths. Without any $, the whole label is one
  // mode and the heuristic picks it.
  let mathMode = text.includes('$') ? false : looksLikeMath(text);

  const push = (value, shift, forceUpright = false) => {
    if (!value) return;
    const parts = forceUpright || !mathMode
      ? [{ text: String(value), italic: false }]
      : splitByStyle(value);
    for (const part of parts) {
      const last = runs[runs.length - 1];
      // An accent run must never absorb a neighbour: the mark is centred over
      // its own text, so "\\vec{F}x" would draw the arrow across both.
      if (last && !last.accent && last.shift === shift && last.upright === !part.italic) {
        last.text += part.text;
      } else {
        runs.push({ text: part.text, shift, upright: !part.italic });
      }
    }
  };

  // Reads the argument after _ ^ or an accent command.
  const readGroup = () => {
    if (text[index] === '{') {
      let depth = 1;
      let start = ++index;
      while (index < text.length && depth > 0) {
        if (text[index] === '{') depth++;
        else if (text[index] === '}') depth--;
        index++;
      }
      return text.slice(start, index - 1);
    }
    if (text[index] === '\\') {
      const start = index++;
      while (index < text.length && /[a-zA-Z]/.test(text[index])) index++;
      return text.slice(start, index);
    }
    return text[index++] ?? '';
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '\\') {
      index++;
      let name = '';
      while (index < text.length && /[a-zA-Z]/.test(text[index])) name += text[index++];

      if (ACCENTS[name]) {
        // An accented run stands alone. Merging it into a neighbour would lose
        // track of which letters the mark belongs over.
        runs.push({ text: plain(readGroup()), shift: 'base', accent: name, upright: !mathMode });
        continue;
      } else if (name === 'text' || name === 'mathrm') {
        push(plain(readGroup()), 'base', true);
      } else if (FUNCTIONS.has(name)) {
        push(name, 'base', true);
        // A thin space before the argument, the way LaTeX sets it, unless a
        // bracket already separates them.
        if (text[index] && !'([{'.includes(text[index]) && !/\s/.test(text[index])) {
          push('\u2009', 'base', true);
        }
      } else if (SYMBOLS[name]) {
        push(SYMBOLS[name], 'base');
      } else if (name === '') {
        const next = text[index];
        if (SPACING[next] !== undefined) {
          index += 1;
          push(SPACING[next], 'base', true);
          continue;
        }
        push(text[index++] ?? '', 'base'); // escaped character such as \_
      } else {
        push(name, 'base'); // unknown command: show the name
      }
      continue;
    }

    if (char === '_' || char === '^') {
      index++;
      const group = readGroup();
      // 30^\circ is a degree sign, not a ring operator shrunk onto the
      // shoulder. Drawn as a superscript it reads "30o".
      if (char === '^' && /^\\(circ|degree)$/.test(group)) {
        push('\u00b0', 'base', true);
        continue;
      }
      push(plain(group), char === '_' ? 'sub' : 'sup');
      continue;
    }

    if (char === '$') {
      mathMode = !mathMode;
      index++;
      continue;
    }

    if (char === '{' || char === '}') {
      index++;
      continue;
    }

    push(char, 'base');
    index++;
  }

  return runs;
}

/**
 * Renders the source to a plain Unicode string, with no sub or sup shift.
 * An accent becomes its real combining character here, because this is a
 * text context: copying "F⃗" keeps the meaning. The SVG draws the mark
 * instead, since a serif face cannot render the combining form.
 */
export function plain(source) {
  return toRuns(source)
    .map((run) => run.text + (run.accent ? ACCENTS[run.accent] : ''))
    .join('');
}

/**
 * Approximate rendered width in px.
 *
 * The advance table is an estimate, not a measurement: this runs during render
 * where there is no laid-out node to ask, and in Node where there is no layout
 * at all. It is accurate enough to keep a label from running off the sheet.
 */
export function measureText(source, size = 14) {
  let width = 0;
  for (const run of toRuns(source)) {
    width += advanceOf(run.text, run.shift === 'base' ? size : size * 0.72);
  }
  return width;
}

/**
 * Builds an SVG <text> node.
 * options: { x, y, anchor, size, color, rotate, baseline }
 */
export function mathText(source, options = {}) {
  const {
    x = 0, y = 0, anchor = 'middle', size = 14,
    color = 'currentColor', rotate = 0, baseline = 'middle',
    halo = null,
  } = options;

  // Georgia carries no combining marks, so \vec{F} came out as a tofu box.
  // Cambria Math and Segoe UI Symbol do; the browser falls back per glyph.
  // Prose stays upright, exactly as the LaTeX export decides it.
  const node = svg('text', {
    x, y,
    'text-anchor': anchor,
    'dominant-baseline': baseline,
    'font-size': size,
    'font-family': MATH_FONT,
    'font-style': looksLikeMath(source) ? 'italic' : 'normal',
    fill: color,
    // A halo, drawn as a stroke underneath the fill. Without it a label lying
    // over a filled body or a grid line is read through whatever is behind it.
    // paint-order is what puts the stroke below rather than around the glyph.
    stroke: halo || null,
    'stroke-width': halo ? round(Math.max(2, size * 0.22), 2) : null,
    'stroke-linejoin': halo ? 'round' : null,
    'paint-order': halo ? 'stroke fill' : null,
    transform: rotate ? `rotate(${rotate} ${x} ${y})` : null,
  });

  // The shift is in absolute px, not em. An em value resolves against the
  // tspan's OWN font-size, so a 0.72em subscript would shift by 0.72 of the
  // intended amount and the baseline would drift on the way back up.
  let offset = 0;      // the current vertical shift
  let pendingDx = 0;   // put back what an accent mark borrowed
  let pendingDy = 0;

  for (const run of toRuns(source)) {
    const target = run.shift === 'sub' ? 0.28 : run.shift === 'sup' ? -0.45 : 0;
    const runSize = run.shift === 'base' ? size : round(size * 0.72, 2);

    const span = svg('tspan', {
      dx: pendingDx ? round(pendingDx, 3) : null,
      dy: round((target - offset) * size + pendingDy, 3),
      'font-size': run.shift === 'base' ? null : runSize,
      // Stated per run, not inherited. A $x$ span inside an otherwise
      // upright caption has to be able to slant on its own.
      'font-style': run.upright ? 'normal' : 'italic',
    });
    span.textContent = run.text;
    node.append(span);

    offset = target;
    pendingDx = 0;
    pendingDy = 0;

    if (run.accent && DRAWN[run.accent]) {
      // Step back over the letters just drawn, put the mark above their
      // centre, then hand the leftover shift to whichever run comes next.
      const mark = DRAWN[run.accent];
      const base = advanceOf(run.text, runSize);
      const markSize = round(runSize * mark.scale, 2);
      const markWidth = advanceOf(mark.glyph, markSize);
      const rise = mark.rise * runSize;

      const accent = svg('tspan', {
        dx: round(-(base / 2 + markWidth / 2), 3),
        dy: round(-rise, 3),
        'font-size': markSize,
        'font-style': 'normal',
      });
      accent.textContent = mark.glyph;
      node.append(accent);

      pendingDx = round(base / 2 - markWidth / 2, 3);
      pendingDy = round(rise, 3);
    }
  }

  return node;
}

/**
 * True when a script marker carries a second script of the same kind on the
 * same atom, as in "a_1_2" or "x^2^3". LaTeX rejects exactly that with
 * "Double subscript". Two scripts on DIFFERENT atoms are fine:
 * "Solar_Array_1" and "a_1 + b_2" both compile.
 */
export function hasDoubleScript(source) {
  const text = String(source ?? '');
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '\\') { index += 2; continue; }
    if (character !== '_' && character !== '^') { index++; continue; }

    const marker = character;
    index++;

    // Consume the script argument: a braced group, a command, or one token.
    if (text[index] === '{') {
      let depth = 1;
      index++;
      while (index < text.length && depth > 0) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === '{') depth++;
        if (text[index] === '}') depth--;
        index++;
      }
    } else if (text[index] === '\\') {
      index++;
      while (index < text.length && /[a-zA-Z]/.test(text[index])) index++;
    } else {
      index++;
    }

    if (text[index] === marker) return true;
  }

  return false;
}

/**
 * True when the label should go to LaTeX math mode.
 *
 * The label field holds LaTeX. An underscore means a subscript, so anything
 * written with LaTeX syntax must reach math mode unchanged, or the subscript
 * comes out as a literal underscore. Prose goes to text mode instead, where
 * every special character is escaped, because math mode would run the words
 * together in italic.
 */
/** True when every { has its }, ignoring escaped braces. */
function bracesBalanced(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') { index++; continue; }
    if (character === '{') depth++;
    else if (character === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** True when the dollar signs pair up, ignoring escaped ones. */
function dollarsBalanced(text) {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '$') count++;
  }
  return count % 2 === 0;
}

export function looksLikeMath(source) {
  const text = String(source ?? '').trim();
  if (!text) return false;

  // 0. Math mode cannot rescue an unbalanced brace: "$\vec{$" does not
  //    compile. Anything lopsided goes to text mode and gets escaped.
  if (!bracesBalanced(text)) return false;

  // 1. Several ordinary words make a sentence, whatever punctuation it
  //    carries. "Area under f from x = 0.4 to x = 2.6" is a caption, and
  //    rule 3 below used to slant the whole of it. Wrap the formula in
  //    $...$ to set part of a sentence in maths.
  const words = text.replace(/\\[a-zA-Z]+/g, ' ').match(/[A-Za-z]{3,}/g) || [];
  if (!text.includes('$') && words.length >= 3) return false;

  // 2. A LaTeX command is always math: \theta, \vec{F}.
  if (/\\[a-zA-Z]/.test(text)) return true;

  // 2. Input that cannot compile as math goes to text mode, so the document
  //    still builds. "a_1_2" is ambiguous LaTeX, not a subscript.
  if (hasDoubleScript(text)) return false;

  // 3. A relation or a sum reads as a statement: E=mc^2, a+b.
  if (/[=<>+]/.test(text)) return true;

  // 4. Digits and operators only: 2.5, (3), -4.
  if (/^[-+*/=<>()[\]\d.,\s]+$/.test(text)) return true;

  // 5. Prose. A space with no LaTeX command means a caption, not a formula.
  if (/\s/.test(text)) return false;

  // 6. LaTeX syntax with no space: f_x, force_x, v_{max}, x^2, T_{rms}.
  if (/[_^{}]/.test(text)) return true;

  // 7. A bare symbol: m, F, x1, F'.
  if (/^[A-Za-z][A-Za-z\d]{0,3}['′]?$/.test(text)) return true;

  return false;
}

const TEX_ESCAPES = {
  '\\': '\\textbackslash{}',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
  '%': '\\%', '&': '\\&', '#': '\\#',
  _: '\\_', '{': '\\{', '}': '\\}', $: '\\$',
};

/**
 * Escapes the characters LaTeX treats as special in text mode.
 * One pass, so a replacement's own braces are never escaped again.
 */
export function escapeTex(source) {
  return String(source ?? '').replace(/[\\^~%&#_{}$]/g, (character) => TEX_ESCAPES[character]);
}

/**
 * Wraps the source for a TikZ node.
 * A formula keeps its LaTeX source and enters math mode. Prose is escaped and
 * stays in text mode.
 */
export function toTikz(source) {
  const text = String(source ?? '').trim();
  if (!text) return '';

  // The author may set the mode themselves, but only if the dollars pair up
  // and the braces balance. A lone "$" would otherwise open math and never
  // close it, taking the rest of the document with it.
  if (text.includes('$')) {
    return dollarsBalanced(text) && bracesBalanced(text) ? text : escapeTex(text);
  }
  return looksLikeMath(text) ? `$${text}$` : escapeTex(text);
}
