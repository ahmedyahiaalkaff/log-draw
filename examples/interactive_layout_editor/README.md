# React example

This Vite app demonstrates creating and updating a `LayoutConfig` and rendering
it with `CompositeLog`. It imports the library source from the repository's
`src/` folder and uses generated sample data, so no LAS file is needed. The
sample well name is passed separately to the `CompositeLog` constructor.

Use the editor to change chart and header settings, add or remove tracks, and
edit each track's logs. The SVG preview and the read-only JSON view update from
the current configuration. **Download JSON** exports the layout config; edits
are kept in page state and are not saved across reloads.

Toggle **Show track grid** in any track's settings to display its grid in the
preview. Grid lines are configured per track and are off by default. Linear
tracks use evenly spaced vertical lines, while logarithmic tracks use
logarithmically positioned 1, 2, and 5 multiples by decade based on the first
log's range.

In the preview, drag a track header left or right to reorder it. Drag a vertical
track border to adjust widths, the composite header's lower border to change
its height, or the shared track-header row's lower border to resize that row.
The shared row keeps the depth and log plots aligned. The same resize boundaries
support arrow keys; track order can also be changed with the Move left/Move
right controls. Select a track in the preview or settings, then press Delete
to remove it after confirming the prompt. The Delete selected track button
uses the same confirmation.

Select a curve in the preview to highlight its matching log editor. Log curves
can also be selected with Enter or Space when focused.

For logarithmic track scale, set each log's minimum to a positive value.
Non-positive samples are omitted from the curve.

From this directory, install dependencies and start the dev server:

```sh
npm install
npm run dev
```

To type-check and build the example:

```sh
npm run build
```
