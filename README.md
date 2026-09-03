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

The editor registers tools through `document.modelContext.registerTool()`.
Agents can create diagrams, add elements and connectors, inspect anchors,
check visual layout and circuit connections, and export SVG or TikZ. The
ScAInce Draw Codex skill is in [`skills/scaince-draw`](skills/scaince-draw/).

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
