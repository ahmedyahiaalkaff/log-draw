# AGENTS.md

## Project goal

The project is a browser-based JavaScript/TypeScript library for drawing and editing composite wireline-log layouts as SVG. Library source lives in `src/`, generated package output in `dist/`, sample datasets in `data/`, and runnable demos in `examples/`.

Log data is provided as a `LogData` object with a required numeric `depth` array and numeric arrays keyed by log name. Layouts are described with `LayoutConfig` and contain ordered tracks and their log configurations.

## Design

The main rendering classes are:

- `CompositeLog`: Owns the SVG chart, shared header and depth track, and ordered `LogTrack` instances. It accepts a container, `LayoutConfig`, log headers, `LogData`, and an optional well-name string for the composite header.
- `LogTrack`: Renders one configured track and its ordered `Log` curves. Track settings include width, linear or logarithmic value scale, and optional grid display. It creates and draws `LogShading` instances from the track's shading configuration.
- `Log`: Maps and draws one named curve using its configured range, color, line weight, and wrap behavior. Non-positive values are gaps on logarithmic tracks.
- `LogShading`: Represents one filled shading rule. `TrackConfig.leftShadings` and `rightShadings` configure fills from a source log to the corresponding track edge, the previous log, or another named log. Each rule has a color and opacity. Curve-to-curve fills appear only on the requested side and are clipped to the plot.

`DepthTrack` and `CompositeLogHeader` render the shared depth column and chart header. Keep the public configuration types (`LayoutConfig`, `TrackConfig`, `LogConfig`, `LogData`, and shading types) aligned with the runtime classes.

Preserve existing behavior when optional layout settings are omitted. Keep rendering changes consistent between the library and the interactive layout editor in `examples/interactive_layout_editor/`.