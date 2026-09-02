# ScAInce Draw

A GUI for mathematics and physics diagrams. It exports SVG, PNG and TikZ.

No build step. No dependencies. Vanilla ES modules and SVG.

## Run it

```sh
python -m http.server 8124 --bind 127.0.0.1
```

Then open http://127.0.0.1:8124/.

```sh
npm test             # 1848 logic and robustness checks, no browser needed
npm run chrome &     # Chrome with a debugging port, serving the app
npm run test:browser    # 146 end-to-end checks through real mouse and key events
npm run test:components # audits all 48 components, field by field
npm run test:ui         # audits all 48 components, grip by grip
```

## The core idea

One JSON Schema per element type drives four things:

| The schema drives | Where |
|---|---|
| The SVG render | `type.render(element, ctx)` |
| The properties panel | `src/ui/inspector.js` builds every field from the schema |
| The TikZ export | `type.tikz(element, ctx)` |
| The WebMCP tool (phase 2) | The schema becomes the tool `inputSchema` |

Add a type to the registry once. The palette entry, the panel, both exports and
the future agent tool all follow. `src/ui/inspector.js` contains no knowledge of
a force or a lens.

## Plots

A plot carries its own coordinate system, and that is where most of the traps
in this app have been.

**Only the plot types take an `axesId`.** Everything else lives in document
units, so annotating a graph meant converting by hand, once per axis, because
the two axes rarely share a scale. Eight rectangles for a Riemann sum,
computed in data units and handed to `add_element`, landed in a heap in the
corner of the sheet at a fraction of their size. `place_in_axes` converts
position through the mapping and width and height through their own axis, and
takes a list so a whole series is one undoable edit.

**A data slope is not a page angle.** `curveTangent` exists because a velocity
arrow set to the launch angle left the trajectory it was drawn tangent to by
thirteen degrees: the curve's slope was 1, but the axes carried 1.208 document
units per unit of x against 1.939 per unit of y, so the tangent draws at 58.
`place_in_axes` reports `isotropic`, which is the quickest way to know whether
a stated angle will be the drawn one.

**`area` takes a lower edge.** `lowerExpression` makes the band lie between two
curves. Without it the fill always dropped to the axis, so the commonest
integral figure in a calculus course could not be drawn at all.

**A curve can carry a direction.** `head` puts an arrowhead at the end or the
middle. A Carnot cycle or a phase-portrait trajectory is meaningless without
one.

**Tick labels can read in multiples of pi.** `tickUnit: 'pi'` turns 3.1416 and
6.2832 into pi and 2pi. Halves, thirds, quarters and sixths are covered;
anything else falls back to a number.

## Anchors

Every type can name the points on it that something else may attach to:
`center`, `left`, `top-right`, `start`, `end`, `rope-left`. A type declares
`anchors(element, lookup)` if its shape needs specific ones; otherwise they are
derived from whichever geometry fields the element carries — endpoints for a
line, a point list for a path, the two terminals of a two-terminal part.

`anchorsOf()` in `src/registry.js` returns the list plus the shape's own
`along` and `normal` axes, exact and unrounded. A direction is intermediate
maths: rounding one to three decimals put a box 0.002 units off a surface it
had been placed flush against, because the corners were computed from the exact
axis and measured against the rounded one.

**These lived in `src/webmcp.js` and were moved here.** That was the wrong side
of the seam. Anchors describe the shape, so they belong beside `render()` and
`handles()`, where the renderer can reach them to place a label and the
inspector can show them. `boxAnchors`, `surfaceAnchors` and `wheelAnchors` are
the three shape families that need their own; everything else derives.

## Mirrors

`mirror-rays` is the twin of `lens-rays`, and the mirror equation is the same
with one difference that matters: light comes back, so a real image forms in
front of the mirror rather than behind it.

The sign convention comes from the mirror's `kind` — concave converges, convex
diverges. Focal length is always the trace element's own, because the `mirror`
type's `curvature` is a drawing bulge and deriving a focal length from it would
invent a physical meaning the field does not carry. That is the same trap the
lens tracer had, where reading `focal` without `kind` made a diverging lens
converge.

## The screen previews the export

A stroke width and a font size are pixel values. They used to stay the same
size at any zoom while the geometry shrank, so at the default 30 px/unit text
looked about **30 per cent larger against the drawing** than in an export,
which always renders at `EXPORT_SCALE`. The editor was not showing you what you
were going to get.

`buildContext` now computes `scale / EXPORT_SCALE` and shrinks pixel
measurements by it. At the export scale the factor is 1, so **an export is
byte-identical to before** — the tests assert the source is unchanged across
the whole zoom range. Measured on the sample document, the text-to-sheet
proportion is now within 2 per cent of the export instead of 30.

Two details worth keeping:

- The factor lives in module state in `types/shared.js`, because `strokeAttrs`
  is called from a hundred places with no render context to hand. Renders are
  synchronous and never interleave, so the value is always the one for the pass
  in progress.
- Palette icons pass `previewScale: false`. An icon is fitted to its box, not
  previewing an export, and shrinking its strokes by that fitted scale left the
  glyph too faint to read.

Dashes scale with their stroke, and both have a floor, so a line never thins to
nothing at the minimum zoom.

## The sheet sits in the middle

`.canvas-host` was `display: block`, so a sheet shorter than the pane sat
against the top with the rest of the desk empty below it. It is a centred flex
container now, and the sheet keeps `margin: auto` — with a scrolling flex
parent, `align-items` would clip a sheet taller than the pane, and margin is
the one centring that still lets it scroll.

## When an element fails to draw

`renderDocument` catches a per-element failure and carries on, which is right:
one broken shape should not blank the sheet. But it used to only warn to the
console. Four curves once vanished from a Carnot diagram — a missing `DEG`
import threw inside the new arrowhead code — and the audit reported the figure
clean.

`renderFailures()` now returns what failed and why, and the audit reports each
as an **error** naming the element. The report needs a render to have happened,
which is true in the app and in the export path; the headless suite checks the
contract and `browser.test.mjs` checks it end to end against a type that throws
on purpose.

## The pulley

A rope run is a **direction**, not a vertical drop. Each side carries a length
and an angle:

| Field | Meaning |
|---|---|
| `ropeLeft`, `ropeLeftAngle` | Length and heading of the left run. 270 hangs straight down |
| `ropeRight`, `ropeRightAngle` | The same for the right run |
| `showBracket`, `mountAngle`, `mountLength` | The mount that fixes the wheel to its support |

The straight part of a rope is tangent to the wheel, so the radius to the touch
point is perpendicular to the run — `wheelRuns()` computes it, turning one way
for the left run and the other for the right, which is what makes the rope wrap
over the top instead of cutting through the wheel. The tests assert that
property over a spread of angle pairs rather than checking a few positions.

Two bugs are fixed by this. The runs used to start at the wheel's plain left and
right points and always head straight down, so a pulley at the top of an incline
drew a stray vertical line into the hillside while the real cord ran up the
slope — two ropes disagreeing in one figure. And `mountLength` used to be
`radius * 2.2`, so resizing the wheel dragged the bracket with it. The default
1.3 matches the old value at the default radius, so nothing moves unless you
ask it to.

A run of zero length draws nothing, which is how you get a single-sided pulley.

**Editing.** The wheel has four drag grips: the radius, the far end of each
rope run, and the end of the mount. Dragging a rope end sets both its length
and its angle, so following a slope is a drag rather than two numbers. The
grips are declared through the same `handles()` contract every other type uses,
so the grip audit checks them.

Anchors follow: `rope-left` and `rope-right` are the real touch points,
`rope-left-end` and `rope-right-end` are where the runs finish, and `mount` is
where the mount meets its support. Because the ends are anchors, a cord can be
sized from where the masses actually are — the incline figure sets each run's
length from the distance to the block face and to the hanging mass, so nothing
is drawn twice and nothing is guessed.

## Where a label sits

A type whose label would otherwise be dead centre carries `labelPlace`, naming
one of its own anchors. `body`, `block` and `shape` have it.

This exists because of one figure. A free-body diagram puts every force at the
centre of mass, so the block's own `m` competed with three arrow tails for a
single point, and nothing could separate them — no two labels overlapped, so
the audit called it clean while three shafts ran through the letter.

Two things follow from naming the position rather than the coordinate:

- The label moves with the shape. `labelPlace: 'left'` on a block tilted 28
  degrees means down-slope, not left on the page, because the anchors are in
  the shape's own frame.
- `auto_place_labels` can solve it. The pass tries every position field a type
  offers — `labelSide` for an attached label, `labelPlace` for a shape — and
  keeps whichever leaves fewest collisions. On the incline figure it chose
  `labelPlace: 'left'` unprompted.

A collision now counts lines, not only other labels. A segment drawn through a
label box is what actually crowds a body's label, and comparing text to text
could never see it.

Without a renderer the placer estimates a label box from the schema — the
anchor, the font size and a width estimate. The audit does not: it reports only
what it measured, because a warning built on an estimate is a warning a caller
cannot trust. The placer may act on one, because its move is checked and
reversible.

## The element types

| Group | Types |
|---|---|
| Common | `label`, `arrow`, `polyline`, `angle`, `dimension`, `text-box`, `brace`, `shape`, `axis-frame` |
| Mechanics | `body`, `force`, `moment`, `surface`, `spring`, `damper`, `support`, `pulley` |
| Plots | `axes`, `curve`, `marker`, `area`, `parametric`, `polar`, `scatter` |
| Fields | `vector-field`, `charge`, `wave` |
| Circuit | `resistor`, `capacitor`, `inductor`, `source`, `switch`, `diode`, `lamp`, `meter`, `ground`, `wire` |
| Schematic | `container`, `block`, `link`, `node` |
| Optics | `optical-axis`, `lens`, `mirror`, `ray`, `object-arrow`, `screen`, `prism` |

A `force` attaches to a `body` by id. A `curve`, a `marker` and an `area` attach
to an `axes` by id. A `link` attaches to two `block` elements and stops at each
border. Delete the target and the reference clears itself.

## Controls

| Action | Result |
|---|---|
| Drag a palette shape onto the drawing | Place it where you drop it |
| Click a palette shape | Place it in the middle of the canvas |
| Type in the palette search box | Filter the shapes by name or purpose |
| Click | Select |
| Shift-click | Add to or remove from the selection |
| Sweep the background | Marquee select everything the box touches |
| Drag | Move the whole selection by the same amount |
| Drag a square handle | Set a length and an angle, for example a force vector |
| Drag the round grip | Rotate. Hold Shift for 15 degree steps |
| Ctrl and the wheel | Zoom, keeping the point under the cursor |
| Middle-drag, or space and drag | Pan |
| Right-click | Menu: duplicate, copy, paste, reorder, delete |
| Ctrl+D / Ctrl+C / Ctrl+V | Duplicate / copy / paste |
| Ctrl+A | Select everything |
| Arrow key | Nudge by a quarter grid step |
| Shift plus an arrow key | Nudge by one grid step |
| Delete | Remove the selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Escape | Clear the selection |
| The **Shortcuts** button | The full reference, in the status bar |

A duplicate or a paste remaps references inside the copied set. Copy a body
together with its forces and the copies point at the copied body. A reference
to something outside the set is kept as it was.

The work autosaves to `localStorage` on every change. There is no project file.

## The properties panel

Fields are generated from the schema, but they are not shown raw. A key is
turned into a readable name (`strokeWidth` becomes "Line width", `bodyId`
becomes "Acts on body") and grouped into four sections: Links, Geometry, Style
and Label. A field with both a minimum and a maximum also gets a slider beside
its number box, because dragging beats typing for an angle or an opacity.

Select two or more shapes and the panel changes: it offers align, distribute,
and any style field the whole selection has in common.

Align and distribute read the real drawn extent from the live SVG through
`getBBox()`, so the tip of an arrowhead and the hatch under a surface count.
A per-type `bounds()` would need thirty-eight implementations and would still
be an estimate.

## Circuits

Every two-terminal part shares one geometry: a centre, a total lead-to-lead
length and an angle. The symbol sits in the middle and the leads fill the rest,
so parts chain together on the grid. Each carries a `label` and a `value`, drawn
on opposite sides of the wire.

**Circuit parts export as circuitikz, not as hand-drawn paths.**

```latex
% Preamble:
%   \usepackage{tikz}
%   \usepackage{circuitikz}

\draw[draw=c0, line width=0.80pt] (3,6) to[R, l={$R_1$}, a={$10\,\mathrm{k\Omega}$}] (7,6);
\draw[draw=c0, line width=0.80pt] (1,2) to[battery1, l={$V_s$}] (1,6);
\draw (1,2) node[ground] {};
```

That is how a circuit is written in LaTeX, and the printed symbol then follows
the package's own conventions. Two consequences are worth knowing:

- On screen the symbol size follows the `size` field. In the PDF, circuitikz
  decides it. Use `\ctikzset{bipoles/length=...}` if you need to match exactly.
- The label and the value are braced — `l={...}`, not `l=...` — so a comma or an
  equals sign inside a label cannot be read as another package option.

The `wire` type routes at right angles between its corners and can drop solder
dots at the ends or at every corner.

## The drawing space

Three things make the space bigger, because "the sheet is too small" has three
different causes.

| Want | Do |
|---|---|
| A bigger **sheet** — more room in diagram units | Drag any edge grip or corner grip |
| The sheet to **fill the window** | Press **Fit** in the toolbar |
| A bigger **window** for the sheet | Drag a panel divider, or collapse a panel |

There are eight grips: four edges and four corners. The document origin is the
bottom left corner, so growing from the **top or right** simply adds space.
Growing from the **bottom or left** would put the origin somewhere new, so the
sheet grows *and* every shape shifts by the same amount — the drawing stays
exactly where it was on the page. A whole resize drag is one undo step.

Panel dividers drag to resize and double click to collapse; the two buttons at
the left of the toolbar do the same. Widths persist per browser.

One trap worth recording, because it cost a blank canvas: the panes are grid
items, and `display: none` on a grid item removes it from auto-placement, so
every later item shifts one track left. Collapsing a panel put the canvas in a
5px splitter column. Every item now names its own `grid-column`.


Two bugs in the Fields group were found this way:

- **Every plot type built its own axes.** Only `curve`, `marker` and `area`
  reused an existing one; the list was hard coded. Adding a vector field beside
  a polar curve stacked two frames on top of each other. The check is now
  "does this type have an `axesId`", which is the actual question.
- **The vector field mixed two coordinate frames.** The arrow tip was computed
  by adding a *data-space* vector to an *already-mapped document-space* point.
  It looked right only because the default axes happens to map one data unit to
  one document unit. The tip is now computed in data space and mapped
  afterwards, so any axes range and box size gives correct directions.


### From the QA report

An external pass found nine issues. Seven were real; two were not.

| Reported | Verdict | Root cause |
|---|---|---|
| Shapes panel collapses to 23px | **Real** | See below — one bug behind three reports |
| Panel toggle never restores a usable width | **Real** | Same bug |
| Splitters are 0px and cannot be dragged | **Real** | Same bug |
| Force rotation grip draws at the origin | **Real** | `force.anchor` returned the raw `x,y` and ignored `bodyId` |
| Canvas width field keeps an invalid value | **Real** | A refused edit left the box showing what the document did not hold |
| A blank title is persisted | **Real** | No fallback |
| Search with no hits shows nothing | **Real** | No empty state |
| Clear has no confirmation | **Not reproduced** | `window.confirm` is there. It *blocks the JS thread*, which is why an automated `Runtime.evaluate` appears to hang — the dialog has to be observed through `Page.javascriptDialogOpening` |
| Properties panel does not repaint in dark mode | **Not reproduced** | Screenshots at 968px and 1400px show the correct dark background in both the idle and selected states |

**The layout bug behind the first three reports.** A media query resolves `rem`
against the **initial** 16px font size, not the 15px on `:root` — so the
threshold is 1024px, and any window narrower than that is in "narrow" mode.
Narrow mode declared `grid-template-columns: 1fr`, a single column, while every
pane was pinned to an explicit `grid-column: 1` to `5`. Columns two to five
became **implicit auto tracks**: the shapes panel shrank to the width of its own
scrollbar (23px) and both splitters to zero. The reporter's own measurements —
`23.3px 0px 662.9px 0px 281.8px` — are exactly that.

The explicit `grid-column` was itself added to fix an earlier bug, where hiding
a pane shifted the canvas into a 5px splitter track. Both now hold: narrow mode
releases the column pins and stacks the three panes into rows instead.

One more thing that cost a screenshot: the responsive block now sits at the
**end** of the stylesheet. A media query carries no extra specificity, so its
rules must come after the ones they override — the palette tile override had no
effect while the block sat above the palette section.

### Bugs this hunt found

| Bug | Why it was invisible |
|---|---|
| **Every SVG numbered its markers from zero.** `arrow-0` existed sixteen times on the page; `url(#arrow-0)` resolves against the whole document, so canvas arrowheads took a *palette icon's* colour | The shape was identical, only the colour was wrong |
| **`typeof NaN` is `"number"`,** so `NaN` and `Infinity` passed validation and reached the SVG and the TikZ export as literal text | Nothing threw; the output was simply broken |
| **A transaction did not suppress nested history.** `removeElement` pushes its own undo entry, so deleting three hundred shapes created three hundred and one entries | Undo appeared to work — it just undid one shape at a time |
| **A saved document holding `null` entries crashed on load** | Only a corrupt save triggers it |
| **A lone `{` or `$` in a label produced LaTeX that will not compile** | The figure looked fine on screen |

## Followers

Some shapes have no geometry of their own. A curve is drawn on its axes; a
force is drawn relative to its body. Each such type declares what it follows:

```js
attachedTo: (element) => element.axesId,
```

That one declaration fixes three separate things:

- **Dragging redirects to the parent.** Grabbing a curve moves the axes it is
  drawn on. Before, `move()` returned nothing and the shape simply would not
  budge — seven types were immovable.
- **A parent and its follower move once, not twice.** Selecting a body together
  with its force used to shift the body by the drag delta *and* the force's
  offset by the same delta, so the force travelled twice as far.
- **Growing the sheet from the left or bottom** shifts only the parents, for
  the same reason.

A new plot shape also builds itself a set of axes if none exists, because
without one it has no coordinates and renders at the origin.

## The interface

The app is chrome around a figure. The figure carries colour, so the chrome does
not: one near-neutral ramp of ten steps, one ink-blue accent, and nothing else.

- **The drawing is a sheet of paper on a desk.** The workspace is grey, the
  figure sits on white with a shadow. It stays white in dark mode too, because a
  figure is made for print and you should see it as it will be printed.
- **One primary button.** TikZ, the reason the app exists. Undo, zoom and the
  other exports are segmented controls of equal, quiet weight.
- **Numbers are tabular.** Every coordinate field and the status bar use
  `font-variant-numeric: tabular-nums`, so columns of numbers line up.
- **Three text weights only** — `--text`, `--muted`, `--faint` — and one spacing
  scale. Nothing is spaced by eye.

### Theme

Light, dark, or follow the system. The button in the toolbar steps through the
three. The choice is an attribute on the root element, so the stylesheet decides
every colour and none is computed in JavaScript. It is applied before the first
paint, so there is no flash of the wrong theme.

`?theme=dark` in the URL overrides the saved choice, which is how the dark
screenshots for this README were taken.

## Coordinates

The document uses mathematical coordinates. The origin sits at the bottom left
and y grows upward. One function, `S()` in `src/render.js`, maps to SVG screen
coordinates. No SVG transform flips the canvas, because a flip would mirror
every text label.

TikZ receives the document coordinates unchanged. The picture carries a single
`scale=` option, computed from the requested printed width.

### The grid

The default step is 0.5 units, with a stronger line every fifth step. A finer
grid buys finer placement without shrinking anything: the shape defaults are
unchanged, only the ruling behind them is denser.

`gridLayer` in `src/render.js` drops the minor lines once a step falls below
4 screen pixels, so a very fine grid thins out instead of filling solid. At the
default step the minor lines survive every zoom the app allows.

The step is declared in `emptyDocument()` in `src/store.js` and nowhere else.
`sampleDocument()` imports the canvas rather than restating it, so the starter
document cannot drift out of step with a blank one.

## Labels

A label holds LaTeX source, for example `\vec{F}_{net}` or `\theta`.

- The screen shows an approximation: real Unicode symbols and `<tspan>`
  subscripts. The supported subset is `\symbol`, `_sub`, `^sup`, `{groups}`,
  `\vec{}`, `\hat{}`, `\bar{}` and `\text{}`.
- TikZ receives the exact source. A fraction or a root looks plain on screen but
  exports correctly.

### What is set in italic

LaTeX slants variables and leaves everything else upright, and the renderer now
does the same. A run of letters is italic; digits, operators, spaces and
uppercase Greek are not. `m_1 = 4.0` therefore sets *m* in italic with an
upright 1, an upright 4.0, and `f_k` keeps its *k* slanted because it names a
variable rather than a number.

`\text{}` and `\mathrm{}` force a run upright, so `4.0\text{ kg}` prints the
unit as prose. `\,` `\:` `\;` and `\ ` are spacing, not characters: before
this, `10\,k\Omega` drew a comma between the number and its unit on every
circuit value in the app.

`30^\circ` prints a degree sign. Drawn literally as a superscript ring operator
it reads "30o".

### Prose that contains formulas

Wrap the formula in dollars:

```
Area under $f$ from $x = 0.4$ to $x = 2.6$
```

The sentence stays upright and only the delimited spans slant. Without any
dollars the whole label is one mode, chosen by the heuristic below — and a
label with three or more ordinary words is now read as a sentence whatever
punctuation it carries. An equals sign used to be enough to slant an entire
caption.

### Halo

Every label is drawn with a white stroke under its fill, through
`paint-order: stroke fill`. A normal-force label lying across a filled body was
legible only by accident before; now it is legible by construction. The sheet
is white in every theme, which is what makes one fixed halo colour safe.

### Staying on the sheet

`ctx.text` nudges a label back inside the sheet before drawing it. Types place
labels at a point that suits the shape — for a curve that is its last sample —
and near the edge the text simply ran off and the export cut it in half. The
anchor is preserved, so the type's intent survives the nudge. Rotated text is
left alone, because its box is not axis aligned.

### Math mode or text mode

The label field holds LaTeX, so `f_x` must reach the document as `$f_x$`. If it
were escaped to `f\_x` instead, LaTeX would print a literal underscore and the
subscript would be lost. A caption, on the other hand, must not enter math mode,
or the words run together in italic and a stray `%` or `&` stops the build.

The export decides by inspection, in this order:

| Rule | Example | Mode |
|---|---|---|
| 1. Holds a LaTeX command | `\theta`, `\vec{F}_{net}` | math |
| 2. Cannot compile as math | `a_1_2`, `x^2^3` | text |
| 3. Holds a relation or a sum | `E=mc^2`, `a+b` | math |
| 4. Digits and operators only | `2.5`, `(3)` | math |
| 5. Holds a space | `Block on an incline`, `Solar_Array status` | text |
| 6. Holds LaTeX syntax, no space | `f_x`, `force_x`, `v_{max}`, `x^2` | math |
| 7. A bare symbol | `m`, `F'`, `x1` | math |
| 8. Anything else | `A&B` | text |

Rule 2 covers the one thing LaTeX genuinely rejects: a **second script on the
same atom**. `a_1_2` is ambiguous and raises "Double subscript", so it falls
back to escaped text and the document still builds. Scripts on *different*
atoms are fine and stay in math mode: `Solar_Array_1` and `a_1 + b_2` both
compile.

Text mode escapes `\ ^ ~ % & # _ { } $` in one pass.

On screen, a subscript shifts by an absolute pixel amount, not by `em`. An `em`
value resolves against the tspan's own reduced font size, so the shift back up
would fall short and the baseline would drift across a label like `x_1y`.

This is why the app does not use KaTeX. KaTeX renders through a
`<foreignObject>`, which a canvas cannot rasterise, so the PNG export would
break. If you want true LaTeX rendering on screen, swap `src/mathtext.js` and
accept that PNG export needs another route.

## Ray diagrams

`lens-rays` traces the three principal rays through a thin lens and draws the
image they form. The construction is written once, so the drawing cannot
disagree with the arithmetic:

| Ray | In | Out |
|---|---|---|
| parallel | along the axis | through the far focal point |
| chief | through the centre | straight on |
| focal | through the near focal point | parallel to the axis |

Positions come from `1/f = 1/d + 1/di`. A virtual image falls out of the same
formulae with no separate branch, and its dashed back-extensions are drawn
because that is what makes the figure readable. A ray that would enter above
the rim is dropped rather than drawn passing through thin air.

One trap worth recording: the `lens` type stores `focal` as a magnitude and
carries the sign in `kind`, so reading `focal` alone made a diverging lens
converge. The tests assert the thin lens equation, the magnification, and that
all three rays actually cross at the image point.

Point it at a lens with `lensId`, or leave that empty and it traces from its
own position and focal length — a component that needs a second element before
it draws anything is useless in the palette.

## The expression parser

`src/expr.js` compiles an expression with a tokenizer and a shunting-yard
parser. It never calls `eval` or the `Function` constructor. It is a whitelist:
a name that is not a listed function, a listed constant or the variable `x` is
rejected before the first evaluation.

The lookups use `Object.hasOwn`. A plain object inherits `constructor` and
`toString` from `Object.prototype`, so an `in` check would let those names pass
a whitelist. This matters for phase 2, where an agent supplies the expression.

`-x^2` evaluates to `-4` at `x = 2`. The unary minus binds tighter than `*` and
looser than `^`, which is the usual mathematical convention.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page shell and the TikZ dialog |
| `gallery.html` | A dev page: every shape drawn large, for a visual check |
| `styles.css` | Styles, light and dark |
| `src/main.js` | The entry point. It registers the types and wires the panels |
| `src/registry.js` | The type registry, the schema defaults and the validator |
| `src/store.js` | The document, the undo history and the autosave |
| `src/render.js` | The document to SVG renderer and the render context |
| `src/interact.js` | Select, drag, handles and the keyboard |
| `src/expr.js` | The safe expression parser |
| `src/mathtext.js` | LaTeX-lite to SVG, and the LaTeX mode decision |
| `src/sample.js` | The starter document |
| `src/dom.js` | Element helpers and the download helper |
| `src/types/*.js` | The fifty element types |
| `src/icons.js` | The palette icon framing table |
| `src/ui/*.js` | The palette, the properties panel, the outline, the menu, the theme, the splitters and the arrange tools |
| `src/export/*.js` | The SVG, PNG and TikZ exporters |
| `test/render.test.mjs` | The parser, the registry contract and the TikZ export |
| `test/svg.test.mjs` | The SVG render, through a small DOM stub |
| `test/texlint.mjs` | A LaTeX validator run over every exported line |
| `test/cdp.mjs` | A dependency-free Chrome DevTools Protocol driver |
| `test/browser.test.mjs` | End-to-end tests through real mouse and key events |
| `test/components.test.mjs` | A per-component audit: every field must change the drawing |
| `test/robustness.test.mjs` | Corrupt data, dangling references, hostile numbers, fuzzing, scale |
| `test/ui-components.test.mjs` | A per-component grip audit: handles must land on the shape and work |

### Attaching to the right tab

Two things made the browser suites flaky when run one after another, and both
showed up as `1 of 0 checks failed` — a suite dying before its first check.

`Browser.attach` took the first page target Chrome listed, which after an
earlier run can be a stray blank tab. It now prefers a target serving the app.
And `close()` was followed by `process.exit()` on the next line, so the socket
never flushed and Chrome could still hold the old client when the next suite
attached. `close()` returns a promise now, and every suite awaits it.

### The cache trap

`test/cdp.mjs` disables the network cache on every `open()`. Without it Chrome
reuses a cached ES module across a navigation, so a source change already saved
to disk is invisible and the test silently checks the old code. This was found
the hard way: a fix to the label renderer passed in Node, and the browser kept
drawing the previous version for three rounds of screenshots.

### End to end, in a real browser

`test/browser.test.mjs` drives Chrome over the DevTools Protocol. Node 22 ships
both `fetch` and `WebSocket`, so `test/cdp.mjs` is a complete driver in about a
hundred lines and the suite needs no dependencies at all.

Every interaction is a synthesised mouse or key event, so it exercises the real
pointer handlers, the real CSS layout and the real SVG hit testing: click and
shift-click to select, marquee sweep, drag to move, the square handle, the
rotation grip, the sheet edge grips, the panel splitters, Ctrl and the wheel,
middle-drag panning, the context menu, the export dialogs, and a reload to
prove the document survives.

It ends by adding **all 48 shapes** one at a time through the palette, then for
each one checking that it draws, that it does not land stuck in the bottom left
corner, and that a real mouse drag actually moves something.

Two rules learned the hard way:

- **Scan for a hittable point.** The centre of a shape's bounding box is often
  empty air — a diagonal arrow's box is mostly nothing, and a label pushes the
  centre off the geometry. Worse, a shape drawn later may cover that pixel.
  `pointOn()` scans whole pixels for one whose topmost element really is the
  target. Whole pixels, because a synthesised event is dispatched at integer
  coordinates and rounding slides off a two-pixel line.
- **Clear `localStorage` at both ends.** The app autosaves, so one run's last
  action becomes the next run's starting document.
- **Inflate the scan box.** A perfectly vertical line has a zero-width
  `getBoundingClientRect`, so `ceil(left) > floor(right)` and the scan never
  runs. Two pixels of slack fixes it.

### The component audit

`test/components.test.mjs` answers a question the other suites cannot:
**is this component actually working?** "It draws something" is weak — a shape
can draw a stub and still be broken. For each of the 48 types it checks:

1. it can be added through the palette
2. it draws real primitives, not an empty group
3. it lands on the sheet, not at the origin
4. **every geometry field in its schema changes the drawing**
5. it exports at least one real TikZ command

Rule 4 is the one that matters. A field that changes nothing is either dead or
wired to the wrong thing, and that is exactly how a component looks broken to
somebody using it. The audit prints a table of ink, field count, TikZ lines and
bounding box for all 48, so a regression is visible at a glance.

Two refinements make rule 4 honest:

- **An enum is dead only if no value changes anything.** `object-arrow.kind`
  has three values and two of them draw identically, which is correct optics —
  an object and a real image look the same, only a virtual one is dashed.
- **A conditional field is not a dead field.** `shape.sides` does nothing to a
  circle; `wire.dotSize` does nothing when the dots are off. The `GATES` table
  names each such dependency and satisfies it before testing, which also serves
  as documentation of which fields depend on which.

### Robustness

`test/robustness.test.mjs` asks what happens when the happy path does not hold.
Every check exists because the failure it guards against would be **silent**.

| Area | What it does |
|---|---|
| Corrupt documents | Eleven malformed saves — not JSON, a bare number, `elements` holding nulls, a canvas that is not an object — must load into something usable |
| Dangling references | Delete an axes under its curve, a body under its force; reference an id that never existed; link a block to itself |
| Hostile numbers | Every numeric field of all 48 types must reject `NaN` and `±Infinity`; extremes must export without exponent notation |
| Identity | Ids stay unique after restoring high ids, after fifty additions, after thirty chained duplications |
| Undo and redo | Twenty deep, redo cleared by a new action, the hundred-step cap, a transaction as one step, undo across a resize that shifted the drawing |
| Expression fuzzing | Four thousand pseudo-random strings, plus 500-deep nesting and a 2000-term chain; and no prototype name may pass the whitelist |
| Exports | Determinism, LaTeX linting, balanced braces and brackets, every colour defined, no poison values |
| Labels | Thirty awkward strings — a lone `{`, a lone `$`, a 500-character label — must all produce compilable LaTeX |
| Scale | Four hundred shapes export in under five seconds; a 2000-sample curve is thinned so the source stays readable |

The browser suite adds the DOM-level classes: duplicate element ids, SVG export
that must parse as XML, three hundred shapes rendering under a time budget,
rapid clicking, a drag released off-window, and `localStorage` that throws on
every access the way a private window does.

### The grip audit

`test/components.test.mjs` asks whether a shape's **data** works.
`test/ui-components.test.mjs` asks whether its **handles** work — the layer a
user actually touches. It generalises the force-anchor bug, where the anchor
grip and the rotation grip drew at the document origin while the shape sat
three hundred pixels away.

For all 48 types, with a real mouse:

1. the anchor grip lands on the shape, not somewhere else
2. every square handle lands on the shape
3. no two grips sit on top of each other, which would hide one
4. dragging the anchor grip changes the document
5. dragging the rotation grip changes the angle, for every type that has one
6. delete then undo restores the shape and it draws again
7. a document holding all 48 types survives a reload byte for byte

It also enforces two affordance rules that had been quietly broken:

- **Every rotatable type offers a rotation grip.** The grip used to key off a
  field literally named `angle`, so a `label` — which calls it `rotate` — could
  be turned by typing a number but not by dragging. Both the renderer and the
  audit now ask `rotationField(type)`.
- **Every box type can be resized by dragging.** `body`, `block`, `axes` and
  `text-box` all had a width and a height and no size grip, so the only way to
  resize them was to type two numbers.

A follower's anchor is measured against its parent's box as well as its own: a
curve's anchor is its axes corner, which is correct but outside the curve.

## What the tests cover

`test/render.test.mjs` runs the parser, the math text, the registry contract and
the TikZ export. It builds a document holding one of every registered type and
asserts that the output contains no `NaN`, no `undefined` and no
`[object Object]`. It then puts fifteen awkward labels — `f_x`, `a_1_2`,
`100% load`, `A&B` — on every type in turn and runs `test/texlint.mjs` over the
result, so a label can never again produce LaTeX that will not compile. The
linter is itself checked against fifteen lines that must fail and must pass.

`test/svg.test.mjs` stubs `document.createElementNS`, so Node can execute every
`render()` function. It checks the same poison values in every SVG attribute and
it renders every palette icon and feeds fifteen awkward inputs: a curve with a pole, a polyline with one point,
a force pointing at a deleted body, an axes with a zero span.

The two Node suites open no browser; `test/browser.test.mjs` does. Open
`gallery.html` to see every shape drawn large on one page — that is how the
brace and the dimension arrowheads were caught.

## WebMCP

`src/webmcp.js` registers 32 tools on `document.modelContext`. The registry is
the seam: schemas come from `allTypes()`, writes go through the same store the
GUI uses, so the agent path and the GUI path cannot drift. Every tool is
unregistered through its own `AbortController`, and the six read tools carry
`readOnlyHint: true`. A pill in the toolbar shows the count, or "WebMCP
unavailable" when no host is present.

### Geometry, not coordinates

The first version handed an agent raw geometry: `arrow` with `x1,y1,x2,y2`,
`body` with `x,y`, `polyline` with `points`. That forces the caller to invent
every coordinate, and arrows end up floating near the object they belong to
instead of attached to it. These tools exist so it does not have to:

| Tool | What it answers |
|---|---|
| `get_visual_bounds` | Where is this actually drawn? Measured from the live SVG. |
| `get_anchor_points` | Named attachment points: `center`, `top`, `bottom-left`, `rope-right`, `start`, `end`, plus `along` and `normal` direction vectors. |
| `add_vector` | An arrow from an anchor in a named direction, for example `normal-element` or `towards-element`. |
| `add_connector` | A rope or wire from anchor to anchor, with waypoints and an orthogonal route. |
| `replace_diagram` | The whole document in one transaction, so nothing is left hidden off the sheet. |
| `check_visual_layout` | Off-sheet elements, clipped elements, colliding text, and text sitting on a filled shape. |
| `auto_place_labels` | Moves standalone text, flips attached labels to a clearer side, and reports what it could not fix. |
| `fit_canvas_to_content` | Crops the sheet to the drawing, so the export has no band of blank paper down one side. |
| `place_on_element` | Seats one element on another: a block on an incline, a mass on a table, a part along a wire. |
| `add_two_terminal` | Adds a circuit part spanning exactly two points. Centre, length and angle are derived. |
| `check_connections` | Reports circuit terminals that nearly touch another one without joining it. |
| `place_in_axes` | Positions and sizes any element in a plot's data coordinates. |

`add_vector` also takes `offset`, which shifts the whole arrow perpendicular to
its direction. An attached label is drawn at the shaft midpoint and its only
other knob is which side it sits on, so when a shaft runs through a body no
side clears that body's own label. Moving the arrow is the fix, not the text.

### Connections

`add_element` takes a raw `length`, so a part that should bridge two nodes is a
distance the caller computes. In the Wheatstone figure four resistors went
through a local helper and measured **0.000** at every joint; the galvanometer
was the one part written out by hand, with `length: distance - 1.4` for
cosmetic reasons, and both its leads ended **0.700** short of the nodes. The
detector hung unwired and every diagnostic reported the diagram clean.

The moment a caller writes that helper, the API is missing a primitive.
`add_two_terminal` is that primitive:

```js
add_two_terminal({ type: 'meter', from: B, to: D, values: { kind: 'galvanometer' } })
// -> span 4.8, joins: both ends joinedTo a neighbouring terminal
```

It derives the centre, the length and the angle, and **refuses** `x`, `y`,
`length` or `angle` in `values` rather than silently overriding them — being
ignored is how a part stops reaching its nodes. It returns a `joins` list, so
the caller sees the connection instead of assuming it.

### The connection model

`check_connections` and the audit share one model, scoped to the Circuit group
and derived from the group rather than a list, so a new part is covered the day
it is defined. Outside circuits the same rule would be noise: an arrow tip
landing near a shape is ordinary.

Two kinds of point, and the distinction is the whole check:

| | |
|---|---|
| **ends** | must connect. A part's two terminals, a wire's first and last vertex, a ground symbol's attachment point. |
| **targets** | things an end may connect *to*. All of the above, plus a wire's interior bends, plus any point along a wire segment. |

A wire's interior bend is already connected — to the rest of its own wire.
Treating every vertex as an end reported each corner that happened to sit near
a component, which is how the first version produced a false positive on a
correct figure. Including points *along* a segment is what lets a ground tap
into the middle of a rail.

An end is reported only when another target sits between 0.02 and 1.0 units
away: joined below that, deliberately open above it. A probe point, an antenna
or a symbol drawn alone has nothing near it and is never mentioned. That gate
is what keeps the check worth reading.

Verified on six circuits. Three built with `add_two_terminal` came back with
every end joined. One built by hand in an earlier session turned out to have a
capacitor 0.2 short of its rail, undetected through three rounds of review. One
reproduced the original mistake and was reported as two leads, each 0.700 out,
naming the resistor each should have met.

### Seating

`add_element` takes a raw `x` and `y`, so putting a block on a 28 degree incline
was a sine and a cosine done by hand. A caller doing trigonometry gets it wrong
sometimes: in one figure the block sat 0.63 units inside the slope — nearly half
its own height — with the surface hatching drawn straight through it.

`place_on_element` removes the arithmetic. Give it the element, the host, and a
distance along that host; it lands touching, rotated to match:

```js
place_on_element({ elementId: 'blk', hostId: 'slope', distance: 4.6 })
// -> placed { x: 5.234, y: 4.376, angle: 28 }
//    contact { nearest: 0, furthest: 1.4 }
```

`contact` is the check. Resting on a surface means the near corners read zero
and the far corners read exactly one height; anything else is floating or
buried. The standoff defaults to half the element's height, which is what makes
"resting on it" the default rather than something to calculate.

The audit now measures it too. Every solid is tested against every surface by
the signed distance of its rotated corners from the surface line, and a solid
with corners on both sides is reported as buried, with the depth. That figure
had passed as clean while carrying the most obvious error in it.

### Control characters

A LaTeX command written with one backslash too few becomes a control character:
`'m\vec{g}'` in a JavaScript string is `m`, a vertical tab, then `ec{g}`. It
draws a tofu box that is easy to miss in a screenshot, so `diagnose_diagram`
reports it as an error and names the field. This one came from the generating
script, not the app — which is the point: the diagnostics have to catch the
caller's mistakes, not only their own.

### Diagnostics that mean something

`diagnose_diagram` runs the visual audit as well as the schema, reference,
expression and TikZ checks. It used to report "Ready" for any document that
merely exported cleanly, which is how leftovers parked at (40, 40) passed.

The audit measures each rendered `<text>` node on its own. `boundsOf()` returns
one box per element, so a label attached to an arrow is hidden inside the
arrow's own box, and a box-versus-box comparison can never see it. That is why
`N` could sit on top of `m_1` while the layout reported clean.

`auto_place_labels` reports an `unresolved` list. When no side helps, silence
would read as "nothing was wrong", and the caller would have no reason to move
the objects apart.

Two labels that merely touch are as hard to read as two that overlap, so the
audit requires a small gap between them rather than only reporting a genuine
intersection. Text is compared against filled shapes only: a wire is a thin
line whose bounding box spans half the diagram, and testing text against that
box reported collisions with empty paper.

### Bounds without a renderer

`visualBoundsOf` prefers the live SVG and falls back to an estimate. The
estimator does not assume `x,y` is a centre: it is a centre for a `body` but a
corner for `axes`, and guessing wrong put an on-sheet plot half off the sheet.
The type's own drag handles settle it — whichever candidate box contains them
is the right one.
