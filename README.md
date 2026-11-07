# log-draw

A browser library for drawing composite wireline logs as SVG.

## Install

```sh
npm install log-draw
```

## Usage

Import the classes into a browser application and provide an element to contain
the SVG output:

```ts
import { CompositeLog, type LayoutConfig, type LogData } from "log-draw";

const container = document.getElementById("log-container");
if (!container) {
  throw new Error('Missing element with id "log-container".');
}

const layout: LayoutConfig = {
  width: 250,
  scale: 200,
  depthUnits: "ft",
  header: {
    well_name: {
      font: "Arial",
      font_size: 16,
      location: { left: 16, top: 28 },
    },
    logo: "none",
    height: 64,
  },
  tracks: [
    {
      width: 180,
      scale: "linear",
      logs: [
        {
          name: "GR",
          aliases: [],
          color: "#b45309",
          weight: 2,
          min: 0,
          max: 150,
          wrap: false,
        },
      ],
    },
  ],
};
const logHeaders = ["DEPTH", "GR"];
const logData: LogData = { depth: [100, 101, 102], GR: [40, 55, 35] };
const compositeLog = new CompositeLog(
  container,
  layout,
  logHeaders,
  logData,
  "Well 12",
);
compositeLog.draw();
```

The fifth constructor argument is the well name displayed in the composite
header. It defaults to `"Well-Name"` when omitted.

`Log`, `LogTrack`, and `CompositeLog` are exported from the package. `LogTrack`
accepts optional `meta` and `header` objects:

```js
const track = compositeLog.addTrack({
  meta: { name: "Gamma Ray" },
  header: { unit: "gAPI" }
});
```

The composite SVG includes a depth track with labels and ticks before the log
tracks. Its width defaults to 70 pixels and can be set with `depthTrackWidth`
in the layout configuration. The shared depth/track header row defaults to
100 pixels and can be set with `trackHeaderHeight`. Each log can set
`wrap: true` in its configuration to wrap values above its configured maximum
back from the left side of that track.

Set `showGrid: true` on an individual track to draw vertical value subdivisions
and horizontal depth grid lines aligned with the depth ticks. The grid is off by
default. Linear tracks use evenly spaced vertical subdivisions. Logarithmic
tracks use 1, 2, and 5 multiples by decade, positioned logarithmically; when a
track contains multiple logs, the grid uses the first log's configured range.

Tracks use a linear value scale by default. Set a track's `scale` to
`"logarithmic"` to map each log value by its logarithm between that log's
configured `min` and `max`. Logarithmic ranges must have a positive minimum;
non-positive sample values are treated as gaps.

The package is an ES module and requires a browser environment with the DOM and
SVG APIs. To add dependencies for development or runtime use, install them with
npm, for example `npm install <package>`.

## Development

```sh
npm install
npm run dev
npm run build
npm run check
```

`npm run dev` serves the demo with Vite, which resolves npm imports such as
`las-js`; the demo's sample LAS and JSON files are in `data/`. The TypeScript
library source is in `src/`. `npm run build` creates the distributable
JavaScript library and TypeScript declarations in `dist/`.
