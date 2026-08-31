/**
 * A small LaTeX sanity checker for generated TikZ source.
 *
 * It does not parse LaTeX. It catches the specific mistakes this exporter can
 * make, all of which stop a real build:
 *
 *   - an unescaped _ ^ # & % outside math mode
 *   - two subscripts or two superscripts at the same brace depth inside one
 *     math group, which raises "Double subscript"
 *   - an odd number of $ on a line
 *   - unbalanced braces on a line
 */

const SPECIALS = ['_', '^', '#', '&'];

/** Strips a trailing comment, honouring an escaped percent sign. */
function stripComment(line) {
  let out = '';
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '\\') { out += line.slice(index, index + 2); index++; continue; }
    if (character === '%') return out;
    out += character;
  }
  return out;
}

/** Every problem found in one line of TikZ source. */
export function lintLine(line, number) {
  const problems = [];
  const body = stripComment(line);
  if (!body.trim()) return problems;

  const dollars = (body.match(/(?<!\\)\$/g) || []).length;
  if (dollars % 2 !== 0) {
    problems.push({ line: number, kind: 'odd-dollar', text: line.trim() });
    return problems; // the math split below would be meaningless
  }

  // Split on unescaped $. Odd segments are math, even segments are text.
  const segments = body.split(/(?<!\\)\$/);

  segments.forEach((segment, index) => {
    const isMath = index % 2 === 1;

    if (!isMath) {
      for (const special of SPECIALS) {
        const unescaped = new RegExp(`(?<!\\\\)\\${special}`);
        if (unescaped.test(segment)) {
          problems.push({ line: number, kind: `bare-${special}-in-text`, text: line.trim() });
        }
      }
      return;
    }

    // Inside math, only a SECOND script on the SAME atom is an error.
    // "$a_1 + b_2$" and "$Solar_Array_1$" are valid: their scripts attach to
    // different atoms. "$a_1_2$" is not.
    //
    // The scan below finds "marker, argument, same marker" by matching the
    // argument shapes directly, so it stays independent of the exporter's own
    // hasDoubleScript(). A shared helper could hide a bug in both.
    const ARGUMENT = String.raw`(?:\{(?:[^{}\\]|\\.)*\}|\\[a-zA-Z]+|\\.|[^\\{}])`;
    for (const marker of ['_', '^']) {
      const pattern = new RegExp(`\\${marker}${ARGUMENT}\\${marker}`);
      if (pattern.test(segment)) {
        problems.push({
          line: number,
          kind: marker === '_' ? 'double-subscript' : 'double-superscript',
          text: line.trim(),
        });
      }
    }
  });

  let depth = 0;
  for (let position = 0; position < body.length; position++) {
    if (body[position] === '\\') { position++; continue; }
    if (body[position] === '{') depth++;
    if (body[position] === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) problems.push({ line: number, kind: 'unbalanced-braces', text: line.trim() });

  return problems;
}

/** Lints a whole TikZ source string. */
export function lintTex(source) {
  return source
    .split('\n')
    .flatMap((line, index) => lintLine(line, index + 1));
}
