# ScAInce Draw

ScAInce Draw is an editable browser-based diagram editor for science, maths,
and engineering. It is designed for people and AI agents to work on the same
diagram.

**Live editor:** [scaince-draw.kalinadoseva.chatgpt.site](https://scaince-draw.kalinadoseva.chatgpt.site/)

## Features

- Physics, circuit, optics, geometry, plot, and vector-field diagrams
- SVG, PNG, and TikZ export
- LaTeX labels rendered with MathJax
- Editable SVG canvas with selection, snapping, undo/redo, and autosave
- 32 WebMCP tools for creating, inspecting, validating, and exporting diagrams

## WebMCP

ScAInce Draw exposes 32 WebMCP tools through
`document.modelContext.registerTool()`.

The tools are designed around the workflows an agent needs to create a
trustworthy scientific diagram:

- **Discover:** inspect the diagram, available element schemas, bounds, and anchors.
- **Create:** add elements, vectors, connectors, circuit parts, and complete diagrams.
- **Arrange:** attach objects to surfaces, position content in plot axes, and place labels.
- **Verify:** check visual layout, diagram diagnostics, and circuit connections.
- **Export:** generate SVG and TikZ from the final editable diagram.

Tools operate on the same document store as the graphical editor, so changes
made by an agent immediately appear in the canvas and remain editable by the
user.

## Run locally

```sh
python -m http.server 8124 --bind 127.0.0.1
```

Open `http://127.0.0.1:8124/`.

## Test

```sh
npm test
npm run test:browser
npm run test:components
npm run test:ui
```

## License

[MIT](LICENSE)
