/**
 * Node tests for the parts that need no DOM: the expression parser, the math
 * text parser, the registry contract and the TikZ export.
 *
 * The SVG render needs a browser and is not covered here.
 */

import { compile } from '../src/expr.js';
import { plain, toRuns, toTikz, hasDoubleScript } from '../src/mathtext.js';
import {
  allTypes, createElement, defaultsFor, fieldName, getType, sectionsFor, validate,
} from '../src/registry.js';
import { toTikzSource } from '../src/export/tikz.js';
import { sampleDocument } from '../src/sample.js';
import { iconFor } from '../src/icons.js';
import { lintTex } from './texlint.mjs';
import { store } from '../src/store.js';

// Registering the types is a side effect of the imports.
import '../src/types/common.js';
import '../src/types/annotation.js';
import '../src/types/mechanics.js';
import '../src/types/mechanics-parts.js';
import '../src/types/plots.js';
import '../src/types/plots-extra.js';
import '../src/types/schematic.js';
import '../src/types/optics.js';
import '../src/types/optics-parts.js';
import '../src/types/fields.js';
import '../src/types/geometry.js';
import '../src/types/circuit.js';

let failures = 0;
let checks = 0;

function check(label, condition, extra = '') {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
}

function near(a, b, tolerance = 1e-9) {
  return Math.abs(a - b) < tolerance;
}

function section(name) {
  console.log(`\n${name}`);
}

/* ---------------------- 1. the expression parser ---------------------- */

section('expression parser');
{
  const cases = [
    ['x^2-1', 3, 8],
    ['2*(x+1)', 3, 8],
    ['-x^2', 2, -4],          // unary minus binds looser than the power
    ['2^3^2', 0, 512],        // the power is right associative
    ['10-3-2', 0, 5],         // subtraction is left associative
    ['max(x,2)', 5, 5],
    ['min(x,2)', 5, 2],
    ['sqrt(x)', 9, 3],
    ['abs(-x)', 4, 4],
    ['pi', 0, Math.PI],
    ['sin(pi/2)', 0, 1],
    ['exp(0)+ln(1)', 0, 1],
  ];

  for (const [source, input, expected] of cases) {
    const { fn, error } = compile(source);
    check(`compiles "${source}"`, fn && !error, error || '');
    if (fn) check(`"${source}" at x=${input} is ${expected}`, near(fn(input), expected, 1e-9), String(fn(input)));
  }

  const rejects = [
    ['foo(x)', 'Unknown function'],
    ['y+1', 'Unknown name'],
    ['(x', 'unbalanced'],
    ['x)', 'unbalanced'],
    ['x @ 2', 'Unexpected character'],
  ];
  for (const [source, fragment] of rejects) {
    const { fn, error } = compile(source);
    check(`rejects "${source}"`, !fn && String(error).includes(fragment), error || 'no error');
  }

  // The parser must never reach the JavaScript runtime.
  for (const attack of ['constructor', 'globalThis', 'process', 'require("fs")']) {
    const { fn } = compile(attack);
    check(`refuses "${attack}"`, !fn);
  }

  // A division by zero yields a non-finite value, not a throw.
  const divide = compile('1/x').fn;
  check('1/x at x=0 is not finite', divide && !Number.isFinite(divide(0)));
}

/* ------------------------- 2. the math text -------------------------- */

section('math text');
{
  check('a Greek command becomes a symbol', plain('\\alpha') === 'α', plain('\\alpha'));
  check('\\theta works', plain('\\theta') === 'θ');
  check('an accent attaches', plain('\\vec{F}') === 'F⃗', JSON.stringify(plain('\\vec{F}')));
  check('a subscript is a separate run', (() => {
    const runs = toRuns('F_1');
    return runs.length === 2 && runs[0].shift === 'base' && runs[1].shift === 'sub' && runs[1].text === '1';
  })());
  check('a braced subscript keeps every character', (() => {
    const runs = toRuns('\\vec{f}_{k}');
    return runs[runs.length - 1].text === 'k' && runs[runs.length - 1].shift === 'sub';
  })());
  check('a superscript is marked', toRuns('x^2')[1].shift === 'sup');
  check('a braced superscript keeps every character', (() => {
    const runs = toRuns('x^{n+1}');
    return runs[0].text === 'x'
      && runs.slice(1).every((run) => run.shift === 'sup')
      && runs.slice(1).map((run) => run.text).join('') === 'n+1';
  })());
  check('a fraction is a structured run', (() => {
    const runs = toRuns('\\frac{1}{2}');
    return runs.length === 1 && runs[0].frac
      && runs[0].frac.numerator === '1'
      && runs[0].frac.denominator === '2'
      && runs[0].text === '1/2';
  })());
  check('a compact fraction reads two token arguments', plain('\\frac12') === '1/2', plain('\\frac12'));
  check('a fraction has a plain fallback', plain('\\frac{1}{2}') === '1/2', plain('\\frac{1}{2}'));
  check('an unknown command shows its name', plain('\\wobble') === 'wobble', plain('\\wobble'));
  check('plain text passes through', plain('m g') === 'm g');
  check('TikZ wraps in math mode', toTikz('\\theta') === '$\\theta$');
  check('TikZ keeps fraction source', toTikz('\\frac{1}{2}') === '$\\frac{1}{2}$', toTikz('\\frac{1}{2}'));
  check('TikZ keeps powers inside fractions', toTikz('\\frac{x^2}{3}') === '$\\frac{x^2}{3}$',
    toTikz('\\frac{x^2}{3}'));
  check('TikZ leaves existing math alone', toTikz('$a$') === '$a$');
  check('TikZ returns empty for empty', toTikz('') === '');

  // A subscript written in LaTeX must reach math mode. If it is escaped to
  // "\_" instead, LaTeX prints a literal underscore and the subscript is lost.
  const mathy = [
    '\\theta', 'm', 'F', "F'", '2+2', '2.5', 'E=mc^2', 'x^2',
    'f_x', 'force_x', 'F_net', 'v_max', 'theta_max',
    'T_{rms}', 'v_{max}', '\\vec{F}_{1}', '\\frac{1}{2}', '\\frac{x^2}{3}',
    'Solar_Array_1', 'a_1 + b_2',
  ];
  const prose = [
    'Block on an incline', 'Input stage', 'Solar array', 'Add a plot',
    'Solar_Array status', '50% duty', 'A&B',
  ];
  for (const source of mathy) {
    check(`"${source}" enters math mode`, toTikz(source).startsWith('$'), toTikz(source));
  }
  for (const source of prose) {
    check(`"${source}" stays text`, !toTikz(source).startsWith('$'), toTikz(source));
  }
  check('a subscript survives verbatim', toTikz('f_x') === '$f_x$', toTikz('f_x'));
  check('a long base keeps its subscript', toTikz('force_x') === '$force_x$', toTikz('force_x'));
  check('a percent sign is escaped in text', toTikz('50% duty') === '50\\% duty', toTikz('50% duty'));
  check('an ampersand is escaped in text', toTikz('A & B') === 'A \\& B', toTikz('A & B'));

  // Only a second script on the SAME atom is invalid LaTeX.
  check('a_1_2 is a double subscript', hasDoubleScript('a_1_2'));
  check('x^2^3 is a double superscript', hasDoubleScript('x^2^3'));
  check('Solar_Array_1 is not a double subscript', !hasDoubleScript('Solar_Array_1'));
  check('a_1 + b_2 is not a double subscript', !hasDoubleScript('a_1 + b_2'));
  check('x_1^2 is not a double script', !hasDoubleScript('x_1^2'));
  check('\\vec{F}_{net} is not a double subscript', !hasDoubleScript('\\vec{F}_{net}'));
  check('a double subscript falls back to text', toTikz('a_1_2') === 'a\\_1\\_2', toTikz('a_1_2'));
}

/* --------------- 2b. the LaTeX linter used by section 4 --------------- */

// A linter that reported nothing would make section 4 pass silently, so it is
// checked against lines that must fail and lines that must not.
section('LaTeX linter');
{
  const mustFail = [
    ['a double subscript', '\\node {$a_1_2$};'],
    ['a double superscript', '\\node {$x^2^3$};'],
    ['a repeated braced subscript', '\\node {$v_{max}_{min}$};'],
    ['a bare underscore in text', '\\node {a_1};'],
    ['a bare ampersand in text', '\\node {A&B};'],
    ['an odd number of dollars', '\\node {$a};'],
    ['unbalanced braces', '\\node {$a$;'],
  ];
  const mustPass = [
    ['scripts on different atoms', '\\node {$Solar_Array_1$};'],
    ['a sum of two subscripted terms', '\\node {$a_1 + b_2$};'],
    ['one subscript and one superscript', '\\node {$x_1^2$};'],
    ['a braced subscript after a command', '\\node {$\\vec{F}_{net}$};'],
    ['an escaped underscore in text', '\\node {a\\_1};'],
    ['two separate math groups', '\\node {$a$ and $b$};'],
    ['a comment holding specials', '% a comment with _ and & and $'],
    ['a plain draw command', '\\draw[draw=c0, ->] (0,0) -- (1,1);'],
  ];

  for (const [label, line] of mustFail) {
    const found = lintTex(line);
    check(`the linter rejects ${label}`, found.length > 0, line);
  }
  for (const [label, line] of mustPass) {
    const found = lintTex(line);
    check(`the linter accepts ${label}`, found.length === 0,
      found.map((problem) => problem.kind).join(', '));
  }
}

/* ------------------------- 3. the registry --------------------------- */

section('registry');
{
  const types = allTypes();
  check('all fifty types registered', types.length === 50, `got ${types.length}`);

  // Tick labels as multiples of pi. An axis reading 3.1416 and 6.2832 is a
  // number the reader has to decode.
  const { tickLabel, traceMirror } = await import('../src/types/plots.js')
    .then(async (plots) => ({ ...plots, ...(await import('../src/types/optics.js')) }));

  check('a whole multiple of pi', tickLabel(Math.PI, 'pi') === '\\pi', tickLabel(Math.PI, 'pi'));
  check('two pi', tickLabel(2 * Math.PI, 'pi') === '2\\pi', tickLabel(2 * Math.PI, 'pi'));
  check('a half', tickLabel(Math.PI / 2, 'pi') === '\\pi/2', tickLabel(Math.PI / 2, 'pi'));
  check('a negative third', tickLabel(-Math.PI / 3, 'pi') === '-\\pi/3', tickLabel(-Math.PI / 3, 'pi'));
  check('three halves', tickLabel(3 * Math.PI / 2, 'pi') === '3\\pi/2', tickLabel(3 * Math.PI / 2, 'pi'));
  check('zero stays zero', tickLabel(0, 'pi') === '0');
  check('number mode is untouched', tickLabel(2.5, 'number') === '2.5');
  check('an unrelated value falls back to a number',
    tickLabel(1.234, 'pi') === '1.234', tickLabel(1.234, 'pi'));

  // The mirror equation, and the sign convention that comes from the kind.
  const mirrorAt = (kind) => ({ x: 10, y: 5, kind, height: 8, curvature: 0.8 });
  {
    const trace = traceMirror(
      { mirrorId: 'M', focal: 2.4, objectDistance: 5, objectHeight: 1.6 },
      () => mirrorAt('concave'),
    );
    const di = (5 * 2.4) / (5 - 2.4);
    check('a concave mirror forms a real image', trace.real === true);
    check('the mirror equation holds',
      Math.abs(1 / 2.4 - (1 / 5 + 1 / trace.imageDistance)) < 1e-9);
    check('the image distance matches', Math.abs(trace.imageDistance - di) < 1e-9);
    check('the image is inverted', trace.imageHeight < 0);
    check('the image lies in front of the mirror', trace.image.x < 10, String(trace.image.x));
    check('three rays are traced', trace.rays.length === 3, String(trace.rays.length));
    check('every ray passes through the image point', trace.rays.every((ray) => {
      const [from, to] = ray.outgoing;
      const t = (trace.image.x - from.x) / (to.x - from.x);
      return Math.abs(from.y + (to.y - from.y) * t - trace.image.y) < 1e-6;
    }));
  }
  {
    const trace = traceMirror(
      { mirrorId: 'M', focal: 2.4, objectDistance: 5, objectHeight: 1.6 },
      () => mirrorAt('convex'),
    );
    check('a convex mirror reads as negative focal', trace.focal === -2.4, String(trace.focal));
    check('a convex mirror always gives a virtual image', trace.real === false);
    check('a convex image is upright', trace.imageHeight > 0);
    check('a convex image is smaller', Math.abs(trace.magnification) < 1);
    check('a virtual image draws a dashed extension per ray',
      trace.virtualLines.length === trace.rays.length);
  }
  check('the drawing bulge does not set the focal length',
    traceMirror({ mirrorId: 'M', focal: 3, objectDistance: 5, objectHeight: 1 },
      () => mirrorAt('concave')).focal === 3);
  check('a mirror trace with no mirror and no position is skipped',
    traceMirror({ objectDistance: 3, objectHeight: 1 }, () => null) === null);

  // A curve can carry a direction, and the arrowhead is a real path.
  {
    const axes = createElement('axes',
      { id: 'cax', x: 0, y: 0, width: 8, height: 6, xMin: 0, xMax: 4, yMin: 0, yMax: 4 }, new Set());
    const withHead = createElement('curve',
      { id: 'ch', axesId: 'cax', expression: 'x', from: 0, to: 3, head: 'end' }, new Set());
    const plain = createElement('curve',
      { id: 'cp', axesId: 'cax', expression: 'x', from: 0, to: 3 }, new Set());
    check('a curve accepts a head', withHead.head === 'end');
    check('a curve defaults to no head', plain.head === 'none');
    void axes;
  }

  // The area type can stop at a second curve instead of the axis.
  {
    const band = createElement('area',
      { id: 'ab', expression: '4 - x^2', lowerExpression: 'x', from: -2, to: 1 }, new Set());
    check('area takes a lower edge', band.lowerExpression === 'x');
    const plain = createElement('area', { id: 'ap', expression: 'x', from: 0, to: 1 }, new Set());
    check('area defaults to the axis', plain.lowerExpression === '');
  }

  // A curve's tangent, in document units. A data slope is not a page angle:
  // axes rarely carry the same scale on both directions, and a velocity arrow
  // set to the data angle left the trajectory it was drawn tangent to.
  const { curvePoint, curveTangent } = await import('../src/types/plots.js');
  const headingOf = (v) => Math.atan2(v.y, v.x) * 180 / Math.PI;

  {
    // Deliberately stretched: 1.2083 units of x, 1.9394 of y.
    const stretched = createElement('axes',
      { id: 'sx', x: 0, y: 0, width: 11.6, height: 6.4, xMin: -0.4, xMax: 9.2, yMin: -0.3, yMax: 3 },
      new Set());
    const curve = createElement('curve',
      { id: 'cv', axesId: 'sx', expression: 'x - 0.12*x^2', from: 0, to: 8.3333 }, new Set());

    const ratio = (stretched.height / (stretched.yMax - stretched.yMin))
      / (stretched.width / (stretched.xMax - stretched.xMin));
    const tangent = curveTangent(curve, stretched, 0);
    check('the tangent is a unit vector',
      Math.abs(Math.hypot(tangent.x, tangent.y) - 1) < 1e-9);
    check('a data slope of 1 is not 45 degrees on a stretched plot',
      Math.abs(headingOf(tangent) - 45) > 10, String(headingOf(tangent)));
    check('the drawn tangent follows the axis scale ratio',
      Math.abs(headingOf(tangent) - Math.atan(ratio) * 180 / Math.PI) < 0.01,
      `${headingOf(tangent)} vs ${Math.atan(ratio) * 180 / Math.PI}`);

    // At the apex the slope is zero, which is why only one arrow looked wrong.
    const apex = curveTangent(curve, stretched, 1 / 0.24);
    check('a zero slope is horizontal whatever the scales',
      Math.abs(headingOf(apex)) < 0.01, String(headingOf(apex)));

    const at0 = curvePoint(curve, stretched, 0);
    check('curvePoint maps a data x onto the axes',
      Math.abs(at0.x - (stretched.x + (0.4 / 9.6) * 11.6)) < 1e-9, JSON.stringify(at0));
  }

  {
    // Equal scales: now the data angle and the page angle agree.
    const square = createElement('axes',
      { id: 'sq', x: 0, y: 0, width: 9.6, height: 3.3, xMin: -0.4, xMax: 9.2, yMin: -0.3, yMax: 3 },
      new Set());
    const curve = createElement('curve',
      { id: 'cv2', axesId: 'sq', expression: 'x - 0.12*x^2', from: 0, to: 8.3333 }, new Set());
    check('an isotropic plot draws a data slope of 1 at 45 degrees',
      Math.abs(headingOf(curveTangent(curve, square, 0)) - 45) < 0.01,
      String(headingOf(curveTangent(curve, square, 0))));
  }

  {
    // A curve had no anchors at all, so nothing could attach to one.
    const axes = createElement('axes',
      { id: 'ax2', x: 0, y: 0, width: 10, height: 5, xMin: 0, xMax: 10, yMin: 0, yMax: 5 }, new Set());
    const curve = createElement('curve',
      { id: 'cv3', axesId: 'ax2', expression: 'x/2', from: 0, to: 8 }, new Set());
    const registry = await import('../src/registry.js');
    const names = registry.anchorsOf(curve, (id) => (id === 'ax2' ? axes : null)).anchors.map((a) => a.name);
    check('a curve exposes its ends and midpoint',
      ['start', 'middle', 'end'].every((n) => names.includes(n)), names.join(','));
  }

  // The pulley. A rope run is a direction, not a vertical drop: the straight
  // part is tangent to the wheel, so the radius to the touch point has to be
  // perpendicular to the run. Drawing the run from the wheel's side instead
  // put a stray vertical line into an incline the rope was meant to follow.
  const { wheelRuns } = await import('../src/registry.js');
  const wheelOf = (values) => createElement('pulley',
    { id: `w${Math.random().toString(36).slice(2, 7)}`, x: 10, y: 8, radius: 0.6, ...values }, new Set());

  {
    // The default is a rope hanging off each side, which must be unchanged.
    const runs = wheelRuns(wheelOf({}));
    check('a hanging run touches the plain left point',
      Math.abs(runs.left.touch.x - 9.4) < 1e-9 && Math.abs(runs.left.touch.y - 8) < 1e-9,
      JSON.stringify(runs.left.touch));
    check('a hanging run touches the plain right point',
      Math.abs(runs.right.touch.x - 10.6) < 1e-9 && Math.abs(runs.right.touch.y - 8) < 1e-9,
      JSON.stringify(runs.right.touch));
    check('a hanging run ends its own length below',
      Math.abs(runs.left.end.y - (8 - 2.5)) < 1e-9, JSON.stringify(runs.left.end));
    check('the mount length no longer follows the radius',
      Math.abs(runs.mount.span - 1.3) < 1e-9, String(runs.mount.span));
    check('the mount points up by default',
      Math.abs(runs.mount.end.x - 10) < 1e-9 && runs.mount.end.y > 8);
  }

  {
    // The defining property, for any pair of angles: the touch radius is
    // perpendicular to the run.
    let square = true;
    let outside = true;
    for (const leftAngle of [270, 210, 195, 150, 300, -60]) {
      for (const rightAngle of [270, 250, 315, 20]) {
        const runs = wheelRuns(wheelOf({ ropeLeftAngle: leftAngle, ropeRightAngle: rightAngle }));
        for (const [run, way] of [[runs.left, runs.left.way], [runs.right, runs.right.way]]) {
          const radial = { x: run.touch.x - 10, y: run.touch.y - 8 };
          if (Math.abs(radial.x * way.x + radial.y * way.y) > 1e-9) square = false;
          if (Math.abs(Math.hypot(radial.x, radial.y) - 0.6) > 1e-9) outside = false;
        }
      }
    }
    check('every touch radius is perpendicular to its run', square);
    check('every touch point is on the rim', outside);
  }

  {
    // Following a 30 degree incline: the run heads down-slope and the rope
    // grazes the upper side of the wheel.
    const runs = wheelRuns(wheelOf({ ropeLeftAngle: 210, ropeLeft: 4 }));
    check('a run down a slope touches above the centre',
      runs.left.touch.y > 8 && runs.left.touch.x < 10, JSON.stringify(runs.left.touch));
    check('the run ends its own length down the slope',
      Math.abs(Math.hypot(runs.left.end.x - runs.left.touch.x, runs.left.end.y - runs.left.touch.y) - 4) < 1e-9);
  }

  {
    const type = getType('pulley');
    check('a pulley has drag handles', typeof type.handles === 'function');
    check('four grips with everything switched on',
      type.handles(wheelOf({}), () => null).length === 4,
      String(type.handles(wheelOf({}), () => null).length));
    check('a zero-length run drops its grip',
      type.handles(wheelOf({ ropeLeft: 0 }), () => null).length === 3);
    check('hiding the mount drops its grip',
      type.handles(wheelOf({ showBracket: false }), () => null).length === 3);

    // Dragging a grip must give back the values that put it there.
    const wheel = wheelOf({});
    const grips = type.handles(wheel, () => null);
    const radiusGrip = grips[0];
    check('the radius grip sets the radius it was dragged to',
      Math.abs(radiusGrip.set({ x: 10, y: 9.5 }).radius - 1.5) < 0.01,
      JSON.stringify(radiusGrip.set({ x: 10, y: 9.5 })));

    const leftGrip = grips[1];
    const dragged = leftGrip.set({ x: 9.4, y: 5 });
    check('the left rope grip sets a length and a direction',
      Math.abs(dragged.ropeLeft - 3) < 0.01 && Math.abs(dragged.ropeLeftAngle - (-90)) < 0.2,
      JSON.stringify(dragged));

    const mountGrip = grips[3];
    const raised = mountGrip.set({ x: 10, y: 10 });
    check('the mount grip sets a length and a direction',
      Math.abs(raised.mountLength - 2) < 0.01 && Math.abs(raised.mountAngle - 90) < 0.2,
      JSON.stringify(raised));
  }

  // Anchors belong to the type, not to a consumer. They used to live in the
  // WebMCP bridge, where the renderer could not reach them to place a label.
  const { anchorsOf, boxCorners } = await import('../src/registry.js');
  const { labelPointOf } = await import('../src/types/shared.js');

  {
    const body = createElement('body',
      { id: 'b', x: 5, y: 4, width: 3, height: 2, angle: 0 }, new Set());
    const { anchors, along, normal } = anchorsOf(body, () => null);
    const named = Object.fromEntries(anchors.map((a) => [a.name, a]));

    check('a body reports its centre and its four edges',
      ['center', 'left', 'right', 'top', 'bottom'].every((n) => named[n]),
      anchors.map((a) => a.name).join(','));
    check('a body reports its four corners',
      ['top-left', 'top-right', 'bottom-left', 'bottom-right'].every((n) => named[n]));
    check('the right edge is half a width away',
      Math.abs(named.right.x - 6.5) < 1e-9 && Math.abs(named.right.y - 4) < 1e-9,
      JSON.stringify(named.right));
    check('the bottom edge is half a height away',
      Math.abs(named.bottom.y - 3) < 1e-9, JSON.stringify(named.bottom));
    check('the axes are exact unit vectors',
      Math.abs(Math.hypot(along.x, along.y) - 1) < 1e-12
      && Math.abs(Math.hypot(normal.x, normal.y) - 1) < 1e-12);
    check('the normal is the along vector turned a quarter turn',
      Math.abs(along.x * normal.x + along.y * normal.y) < 1e-12);
  }

  {
    // Rotated: the anchors follow the shape's own frame, not the page.
    const tilted = createElement('body',
      { id: 't', x: 0, y: 0, width: 4, height: 2, angle: 90 }, new Set());
    const named = Object.fromEntries(anchorsOf(tilted, () => null).anchors.map((a) => [a.name, a]));
    check('a rotated body puts its right edge along its own axis',
      Math.abs(named.right.x) < 1e-9 && Math.abs(named.right.y - 2) < 1e-9,
      JSON.stringify(named.right));
  }

  {
    // The reason labelPlace exists: arrows leave the centre of mass, so a
    // label drawn dead centre has nowhere to go.
    const body = createElement('body',
      { id: 'p', x: 5, y: 4, width: 3, height: 2, angle: 0 }, new Set());
    const centre = labelPointOf(body, () => null);
    check('a label sits at the centre by default',
      centre.x === 5 && centre.y === 4, JSON.stringify(centre));

    const left = labelPointOf({ ...body, labelPlace: 'left' }, () => null);
    check('labelPlace moves the label toward that anchor',
      left.x < 5 && Math.abs(left.y - 4) < 1e-9, JSON.stringify(left));
    check('the label stays inside the shape',
      left.x > 3.5, JSON.stringify(left));

    const rotated = labelPointOf({ ...body, angle: 90, labelPlace: 'left' }, () => null);
    check('labelPlace follows the shape rotation',
      Math.abs(rotated.x - 5) < 1e-9 && rotated.y < 4, JSON.stringify(rotated));

    check('an anchor a type does not have falls back to the centre',
      labelPointOf({ ...body, labelPlace: 'rope-left' }, () => null).x === 5);
  }

  {
    const corners = boxCorners(
      { x: 0, y: 0, width: 2, height: 2, angle: 45 }, 2, 2);
    check('boxCorners rotates about the centre',
      corners.length === 4
      && corners.every((c) => Math.abs(Math.hypot(c.x, c.y) - Math.SQRT2) < 1e-9),
      JSON.stringify(corners));
  }

  // The thin lens construction. A ray diagram whose lines do not satisfy
  // 1/f = 1/d + 1/di is a drawing of nothing, so the arithmetic is asserted
  // rather than eyeballed.
  const { traceLens } = await import('../src/types/optics.js');
  const lensAt = (kind, focal) => ({ x: 8, y: 4, focal, kind, height: 6 });

  {
    // Object outside the focal length: real, inverted, on the far side.
    const trace = traceLens({ objectDistance: 5, objectHeight: 1.6, lensId: 'L' },
      () => lensAt('converging', 2.4));
    const di = (5 * 2.4) / (5 - 2.4);
    check('a converging lens forms a real image', trace.real === true);
    check('the image distance obeys the thin lens equation',
      Math.abs(trace.imageDistance - di) < 1e-9, `${trace.imageDistance} vs ${di}`);
    check('1/f = 1/d + 1/di holds',
      Math.abs(1 / 2.4 - (1 / 5 + 1 / trace.imageDistance)) < 1e-9);
    check('the image is inverted', trace.imageHeight < 0, String(trace.imageHeight));
    check('the magnification matches -di/d',
      Math.abs(trace.magnification - (-di / 5)) < 1e-9);
    check('three principal rays are traced', trace.rays.length === 3, String(trace.rays.length));
    check('a real image needs no dashed extension', trace.virtualLines.length === 0);

    // Every ray must actually pass through the image point.
    const through = trace.rays.every((ray) => {
      const [from, to] = ray.outgoing;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const t = (trace.image.x - from.x) / dx;
      return Math.abs(from.y + dy * t - trace.image.y) < 1e-6;
    });
    check('all three rays cross at the image point', through);
  }

  {
    // Object inside the focal length: virtual, upright, magnified.
    const trace = traceLens({ objectDistance: 1.5, objectHeight: 1.2, lensId: 'L' },
      () => lensAt('converging', 2.4));
    check('an object inside f gives a virtual image', trace.real === false);
    check('a virtual image is upright', trace.imageHeight > 0, String(trace.imageHeight));
    check('a virtual image sits on the object side', trace.imageDistance < 0);
    check('a magnifier enlarges', Math.abs(trace.magnification) > 1, String(trace.magnification));
    check('a virtual image draws a dashed extension per ray',
      trace.virtualLines.length === trace.rays.length && trace.virtualLines.length > 0,
      `${trace.virtualLines.length} for ${trace.rays.length} rays`);

    // A ray that would enter above the rim is not drawn. The focal ray here
    // needs 3.2 units of aperture and the lens offers 3, so it is dropped
    // rather than drawn passing through thin air.
    check('a ray wider than the aperture is dropped', trace.rays.length === 2,
      trace.rays.map((r) => r.key).join(','));
    const tall = traceLens({ objectDistance: 1.5, objectHeight: 1.2, lensId: 'L' },
      () => ({ x: 8, y: 4, focal: 2.4, kind: 'converging', height: 9 }));
    check('a taller lens accepts all three rays', tall.rays.length === 3,
      String(tall.rays.length));
  }

  {
    // The lens type stores focal as a magnitude and the sign in `kind`.
    const trace = traceLens({ objectDistance: 4.5, objectHeight: 1.6, lensId: 'L' },
      () => lensAt('diverging', 2.6));
    check('a diverging lens is read as negative focal', trace.focal === -2.6, String(trace.focal));
    check('a diverging lens always gives a virtual image', trace.real === false);
    check('a diverging image is upright', trace.imageHeight > 0, String(trace.imageHeight));
    check('a diverging image is smaller', Math.abs(trace.magnification) < 1, String(trace.magnification));
    check('a diverging image lies between the lens and F',
      trace.imageDistance < 0 && Math.abs(trace.imageDistance) < 2.6,
      String(trace.imageDistance));
  }

  {
    // At the focal point the rays leave parallel and there is no image.
    const trace = traceLens({ objectDistance: 2.4, objectHeight: 1, lensId: 'L' },
      () => lensAt('converging', 2.4));
    check('an object at f forms no image', trace.focused === false && trace.image === null);
  }

  check('a trace with no lens and no position is skipped',
    traceLens({ objectDistance: 3, objectHeight: 1 }, () => null) === null);

  // The width key must mean geometric width. Spreading STROKE after a
  // geometric "width" once clobbered it, so an axes silently became 2 units
  // wide and used the same number as its line width.
  for (const type of types) {
    const property = type.schema.properties.width;
    if (!property) continue;
    check(`${type.name}.width is a geometric width, not a line width`,
      !/line width/i.test(property.description), property.description);
  }
  check('an axes is eight units wide by default', defaultsFor(getType('axes').schema).width === 8);
  check('a stroke width lives under strokeWidth',
    defaultsFor(getType('axes').schema).strokeWidth === 2);

  // The palette icon table must cover every type, or an entry shows a "?".
  for (const type of types) {
    const icon = iconFor(type.name);
    check(`${type.name} has an icon framing`, icon.w > 0 && icon.h > 0);
  }

  for (const type of types) {
    check(`${type.name} has a schema object`, type.schema && type.schema.type === 'object');
    check(`${type.name} has render, tikz, anchor and move`,
      ['render', 'tikz', 'anchor', 'move'].every((key) => typeof type[key] === 'function'));

    for (const [key, property] of Object.entries(type.schema.properties)) {
      check(`${type.name}.${key} has a description`, typeof property.description === 'string' && property.description);
      check(`${type.name}.${key} has a type`, typeof property.type === 'string');
    }

    // Every required field must be covered by the defaults, or a new element
    // would fail its own validation.
    const fresh = createElement(type.name, {}, new Set());
    const problems = validate(type.schema, fresh);
    check(`${type.name} defaults pass their own schema`, problems.length === 0, problems.join(' '));
  }

  check('defaults read the schema', defaultsFor(getType('force').schema).magnitude === 2);
  check('an id is generated', /^force-\d+$/.test(createElement('force', {}, new Set()).id));
  check('an enum violation is caught',
    validate(getType('force').schema, { ...defaultsFor(getType('force').schema), style: 'wavy' }).length === 1);
  check('a type violation is caught',
    validate(getType('force').schema, { ...defaultsFor(getType('force').schema), magnitude: 'big' }).length >= 1);
  check('a minimum is enforced',
    validate(getType('force').schema, { ...defaultsFor(getType('force').schema), magnitude: -5 }).length >= 1);
}

/* ------------- 3b. field presentation and the store ------------------ */

section('field presentation');
{
  const cases = [
    ['x', 'X'], ['strokeWidth', 'Line width'], ['labelSide', 'Label side'],
    ['bodyId', 'Acts on body'], ['hatchStep', 'Hatch spacing'],
    ['xExpression', 'x(t)'], ['uExpression', 'u(x,y)'],
    ['coils', 'Coils'], ['fillOpacity', 'Fill opacity'],
    ['rounded', 'Rounded'], ['showGrid', 'Grid'],
  ];
  for (const [key, expected] of cases) {
    check(`"${key}" reads as "${expected}"`, fieldName(key) === expected, fieldName(key));
  }
  check('a raw key never leaks a camel hump',
    allTypes().every((type) => Object.keys(type.schema.properties)
      .every((key) => !/[a-z][A-Z]/.test(fieldName(key)))));

  // Every field must land in exactly one section, or the panel would drop it.
  for (const type of allTypes()) {
    const grouped = sectionsFor(type.schema).flatMap(([, fields]) => fields.map(([key]) => key));
    const declared = Object.keys(type.schema.properties);
    check(`${type.name}: every field is in a section`,
      grouped.length === declared.length && declared.every((key) => grouped.includes(key)),
      `${grouped.length} of ${declared.length}`);
  }
}

section('store: duplicate, copy and paste');
{
  store.replaceDocument({
    title: 'test',
    canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
    elements: [],
  }, { history: false });

  const body = store.addElement('body', { x: 5, y: 5 });
  const force = store.addElement('force', { bodyId: body.id, magnitude: 2, angle: 90 });
  const stray = store.addElement('force', { bodyId: body.id, magnitude: 1, angle: 0 });

  // Duplicating a body together with one of its forces must repoint that copy
  // at the copied body. The force left behind must keep pointing at the
  // original.
  store.select([body.id, force.id]);
  const clones = store.duplicate();
  check('duplicate returns two clones', clones.length === 2, String(clones.length));

  const clonedBody = clones.find((element) => element.type === 'body');
  const clonedForce = clones.find((element) => element.type === 'force');
  check('the clones get fresh ids', clonedBody.id !== body.id && clonedForce.id !== force.id);
  check('the copied force points at the copied body',
    clonedForce.bodyId === clonedBody.id, `${clonedForce.bodyId} vs ${clonedBody.id}`);
  check('the original force is untouched', store.byId(force.id).bodyId === body.id);
  check('a reference outside the copied set is kept',
    store.byId(stray.id).bodyId === body.id);
  check('the clones are offset from the originals',
    clonedBody.x !== body.x || clonedBody.y !== body.y,
    `${clonedBody.x},${clonedBody.y}`);
  check('the clones become the selection',
    store.selection.length === 2 && store.selection.includes(clonedBody.id));

  const before = store.doc.elements.length;
  check('undo removes the whole duplicate in one step',
    store.undo() && store.doc.elements.length === before - 2, String(store.doc.elements.length));

  // Copy and paste follow the same remapping.
  store.select([body.id, force.id]);
  check('copy reports what it took', store.copy() === 2);
  check('canPaste is true after a copy', store.canPaste());
  const pasted = store.paste();
  check('paste adds the same number', pasted.length === 2);
  check('the pasted force points at the pasted body',
    pasted.find((e) => e.type === 'force').bodyId === pasted.find((e) => e.type === 'body').id);

  // Selection helpers.
  store.select([body.id]);
  store.toggleSelected(force.id);
  check('toggle adds to the selection', store.selection.length === 2);
  store.toggleSelected(force.id);
  check('toggle removes again', store.selection.length === 1);

  check('duplicate with nothing selected is a no-op',
    (store.select([]), store.duplicate().length === 0));

  // A sheet resize drag pushes one undo entry, then updates without history.
  const startWidth = store.doc.canvas.width;
  store.setCanvas({ width: startWidth + 4 });
  check('setCanvas records history by default',
    store.undo() && store.doc.canvas.width === startWidth);

  store.transaction('resize sheet', () => {});
  store.setCanvas({ width: 30 }, { history: false });
  store.setCanvas({ width: 40 }, { history: false });
  check('a whole resize drag undoes in one step',
    store.undo() && store.doc.canvas.width === startWidth, String(store.doc.canvas.width));
}

/* -------------------------- 4. TikZ export --------------------------- */

section('TikZ export');
{
  const view = { scale: 40, panX: 0, panY: 0 };

  // 4a. the sample document
  const sample = sampleDocument();
  const source = toTikzSource(sample, view, { widthCm: 12 });

  check('opens a tikzpicture', source.includes('\\begin{tikzpicture}'));
  check('closes the tikzpicture', source.includes('\\end{tikzpicture}'));
  check('sets a scale', /scale=[\d.]+/.test(source));
  check('defines the colours it uses', source.includes('\\definecolor{c0}{HTML}{'));
  check('draws the first bridge resistor', source.includes('% R1 (resistor)'));
  check('draws the galvanometer', source.includes('% G (meter)'));
  check('names every element in a comment',
    sample.elements.every((element) => source.includes(`% ${element.id} (${element.type})`)));

  // 4b. one of every type, so no renderer can emit rubbish unnoticed
  const taken = new Set();
  const everything = {
    title: 'All types',
    canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
    elements: allTypes().map((type) => {
      const element = createElement(type.name, {}, taken);
      taken.add(element.id);
      return element;
    }),
  };
  const wide = toTikzSource(everything, view, { widthCm: 12 });

  for (const poison of ['NaN', 'undefined', 'Infinity', '[object Object]', 'null']) {
    check(`the output holds no ${poison}`, !wide.includes(poison),
      wide.split('\n').find((line) => line.includes(poison)) || '');
  }
  check('every type produced at least one line',
    everything.elements.every((element) => wide.includes(`% ${element.id} (${element.type})`)));
  check('no export threw', !wide.includes('the export failed'),
    wide.split('\n').find((line) => line.includes('the export failed')) || '');

  // 4c. a curve with a broken expression degrades to a comment
  const broken = {
    ...everything,
    elements: [createElement('curve', { id: 'bad', expression: 'wobble(x)' }, new Set())],
  };
  const brokenSource = toTikzSource(broken, view, {});
  check('a bad expression becomes a comment, not a crash',
    brokenSource.includes('invalid expression'), brokenSource);

  // 4d. the scale option tracks the requested width
  const narrow = toTikzSource(sample, view, { widthCm: 6 });
  const scaleOf = (text) => Number(/scale=([\d.]+)/.exec(text)[1]);
  check('half the width gives half the scale',
    near(scaleOf(narrow) * 2, scaleOf(source), 1e-3),
    `${scaleOf(narrow)} vs ${scaleOf(source)}`);

  // 4d2. a circuit part exports as circuitikz, and its label is braced so a
  // comma inside it cannot be read as another package option.
  {
    const taken = new Set();
    const parts = ['resistor', 'capacitor', 'inductor', 'source', 'switch', 'diode', 'lamp', 'meter']
      .map((name) => {
        const element = createElement(name, {
          label: 'R_1', value: '10\\,k\\Omega, 1%',
        }, taken);
        taken.add(element.id);
        return element;
      });

    const circuit = toTikzSource({
      title: 'circuit',
      canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
      elements: parts,
    }, view, { widthCm: 10 });

    check('a circuit asks for circuitikz in the preamble',
      circuit.includes('%   \\usepackage{circuitikz}'), '');
    check('the package note appears once',
      (circuit.match(/usepackage\{circuitikz\}/g) || []).length === 1);
    check('a resistor becomes to[R, ...]', /to\[R, /.test(circuit));
    check('a capacitor becomes to[C, ...]', /to\[C, /.test(circuit));
    check('an inductor becomes to[L, ...]', /to\[L, /.test(circuit));
    check('a battery becomes to[battery1, ...]', /to\[battery1, /.test(circuit));
    check('every label is braced', !/l=\$/.test(circuit),
      (circuit.split('\n').find((line) => /l=\$/.test(line)) || ''));
    check('every value is braced', !/a=\$/.test(circuit));
    check('a comma in a value stays inside its braces',
      /a=\{\$10\\,k\\Omega, 1%\$\}/.test(circuit)
      || /a=\{[^}]*1\\%[^}]*\}/.test(circuit),
      (circuit.split('\n').find((line) => line.includes('a=')) || ''));
    check('a ground uses a circuitikz node',
      toTikzSource({
        title: 'g',
        canvas: { width: 8, height: 8, grid: 1, showGrid: false, snap: false },
        elements: [createElement('ground', {}, new Set())],
      }, view, {}).includes('node[ground]'));
  }

  // 4e. the output must be valid LaTeX, whatever the user typed in a label.
  const LABELS = [
    'f_x', 'force_x', 'F_net', 'theta_max', 'v_{max}', 'x^2',
    '\\vec{F}_{net}', 'Solar_Array_1', 'a_1_2', 'x^2^3',
    '100% load', 'A&B', 'cost #4', 'a_1 + b_2', 'Block on an incline',
  ];

  for (const label of LABELS) {
    const taken = new Set();
    const elements = allTypes().map((type) => {
      const values = { label };
      // Fill whichever text-bearing field this type happens to have.
      for (const key of ['text', 'title', 'xLabel', 'yLabel']) {
        if (Object.hasOwn(type.schema.properties, key)) values[key] = label;
      }
      const element = createElement(type.name, values, taken);
      taken.add(element.id);
      return element;
    });

    const output = toTikzSource({
      title: label,
      canvas: { width: 24, height: 16, grid: 1, showGrid: true, snap: true },
      elements,
    }, view, { widthCm: 12 });

    const problems = lintTex(output);
    check(`label ${JSON.stringify(label)} produces valid LaTeX on every type`,
      problems.length === 0,
      problems.slice(0, 2).map((problem) => `${problem.kind}: ${problem.text.slice(0, 90)}`).join(' | '));
  }
}

/* ----------------------------- summary ------------------------------- */

console.log(
  failures === 0
    ? `\nAll ${checks} checks passed.`
    : `\n${failures} of ${checks} checks failed.`,
);
process.exit(failures === 0 ? 0 : 1);
