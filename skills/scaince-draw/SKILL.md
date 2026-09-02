---
name: scaince-draw
description: Create and verify editable scientific diagrams in ScAInce Draw through its WebMCP tools. Use for physics, circuits, geometry, optics, fields, plots, and diagram exports.
---

# ScAInce Draw

Use the live editor at `https://scaince-draw.kalinadoseva.chatgpt.site/`.

ScAInce Draw is an editable scientific-diagram editor. Its WebMCP tools create
structured diagrams, inspect the result, check layout and connections, and
export SVG or TikZ without relying on fragile screen-coordinate clicking.

## Start Safely

1. Open the live app in an available browser and fetch its WebMCP tools.
2. Fetch tools again after navigation or reload; earlier tool snapshots become stale.
3. Inspect the current diagram before changing it.
4. Do not delete or replace existing work unless the user explicitly asks to
   clean, replace, redraw from scratch, or create a new diagram.

Use `inspect_diagram` for the full document and `list_elements` for a compact
inventory. Use `get_element_schema` before setting fields on an unfamiliar
element type.

## Build Structurally

Prefer domain tools over hand-placed lines and guessed coordinates.

- Use `replace_diagram` for a complete new diagram. It is atomic and removes
  the previous diagram in one undoable operation.
- Use `apply_operations` for related edits that should stay together as one
  undoable operation.
- Use `get_anchor_points` and `get_visual_bounds` before precise placement or
  connection work.
- Use `add_vector` for forces and directions attached to an object.
- Use `add_connector` for ropes, wires, and links between element anchors.
- Use `place_on_element` to seat an object on a surface or incline.
- Use `add_two_terminal` for circuit parts spanning two endpoints.
- Use `place_in_axes` for elements positioned by plot data coordinates.

Use mechanics elements for bodies, forces, surfaces, springs, dampers,
supports, and pulleys. Use circuit elements for electrical diagrams and optics
elements for lenses, mirrors, rays, screens, and prisms.

## Labels And Math

Write ordinary LaTeX in mathematical labels: `\\theta`, `v_0`, `x^2`, and
`\\frac{R_1}{R_2}` are valid. Do not write `\\_` for a subscript; it produces a
literal underscore instead.

Keep labels short. For circuit parts, use `label` for the component name and
`value` for its measured quantity.

## Verify The Result

After material edits, run `diagnose_diagram` and `check_visual_layout`. For
circuit work, also run `check_connections`.

Run `auto_place_labels` after the geometry is settled when text is crowded.
Use `fit_canvas_to_content` only when a tight export frame is wanted. Return
SVG with `export_svg` or TikZ with `export_tikz` when requested.

If a diagnostic identifies a safe common structural issue, use
`fix_common_issues`; otherwise correct the relevant geometry or labels. When a
user asks for visual verification, inspect the rendered editor and, when
relevant, the exported SVG rather than relying only on structural diagnostics.
