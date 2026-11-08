const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CSS_PIXELS_PER_INCH = 96;
const INCHES_PER_METER = 100 / 2.54;
const LOG_TRACK_HEADER_HEIGHT = 100;
const LOG_PLOT_TOP_PADDING = 50;
const LOG_PLOT_BOTTOM_PADDING = 1;
const DEFAULT_DEPTH_TRACK_WIDTH = 70;
const DEPTH_TICK_TARGET_SPACING = 60;

export type DepthUnit = "m" | "ft";

function getDepthPixelsPerUnit(scale: number, depthUnit: DepthUnit): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Scale must be a finite positive number.");
  }

  let inchesPerDepthUnit: number;
  switch (depthUnit) {
    case "m":
      inchesPerDepthUnit = INCHES_PER_METER;
      break;
    case "ft":
      inchesPerDepthUnit = 12;
      break;
    default:
      throw new RangeError(`Unsupported depth unit: ${String(depthUnit)}`);
  }

  return inchesPerDepthUnit * CSS_PIXELS_PER_INCH / scale;
}

function getDepthTickInterval(depthPixelsPerUnit: number): number {
  const rawInterval = DEPTH_TICK_TARGET_SPACING / depthPixelsPerUnit;
  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const normalizedInterval = rawInterval / magnitude;
  const niceInterval = normalizedInterval <= 1
    ? 1
    : normalizedInterval <= 2
      ? 2
      : normalizedInterval <= 5
        ? 5
        : 10;

  return niceInterval * magnitude;
}

export interface LogData {
  depth: readonly number[];
  [key: string]: readonly number[];
}

export type LogShadingTarget =
  | { type: "edge" }
  | { type: "previous" }
  | { type: "log"; name: string };

export interface LogShadingConfig {
  sourceLog: string;
  target: LogShadingTarget;
  color: string;
  opacity: number;
}

export interface LogTrackOptions{
  meta?: any;
  header?: any;
}

export interface Location{
  left: number;
  top: number;
}
export interface Size{
  width: number;
  height: number;
}
export interface TextConfig {
  font: string;
  font_size: number;
  location: Location;
}

function mapLogValueToX(
  value: number,
  logConfig: LogConfig,
  scale: TrackConfig["scale"],
  left: number,
  width: number,
): number | null {
  const { min, max } = logConfig;
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min ||
    (scale === "logarithmic" && min <= 0) ||
    !Number.isFinite(value) ||
    value === -999.25 ||
    (scale === "logarithmic" && value <= 0) ||
    (!logConfig.wrap && value > max)
  ) {
    return null;
  }

  let normalizedValue: number;
  if (scale === "logarithmic") {
    const logMin = Math.log(min);
    const logRange = Math.log(max) - logMin;
    const logValue = Math.log(value);
    const plottedLogValue = logConfig.wrap && value > max
      ? logMin + ((logValue - logMin) % logRange)
      : logValue;
    normalizedValue = (plottedLogValue - logMin) / logRange;
  } else {
    const range = max - min;
    const plottedValue = logConfig.wrap && value > max
      ? min + ((value - min) % range)
      : value;
    normalizedValue = (plottedValue - min) / range;
  }
  return left + normalizedValue * width;
}

let nextLogShadingClipId = 0;

export class LogShading {
  constructor(
    readonly config: LogShadingConfig,
    readonly side: "left" | "right",
  ) {
    if (!config || typeof config !== "object") {
      throw new RangeError("A shading rule must be an object.");
    }
    if (side !== "left" && side !== "right") {
      throw new RangeError(`Unsupported shading side: ${String(side)}`);
    }
    if (typeof config.sourceLog !== "string" || !config.sourceLog.trim()) {
      throw new RangeError("A shading rule must name a source log.");
    }
    if (typeof config.color !== "string" || !config.color.trim()) {
      throw new RangeError("A shading rule must have a color.");
    }
    if (
      !Number.isFinite(config.opacity) ||
      config.opacity < 0 ||
      config.opacity > 1
    ) {
      throw new RangeError("Shading opacity must be between 0 and 1.");
    }
    if (!config.target || typeof config.target !== "object") {
      throw new RangeError("A shading rule must have a target.");
    }
    switch (config.target.type) {
      case "edge":
      case "previous":
        break;
      case "log":
        if (
          typeof config.target.name !== "string" ||
          !config.target.name.trim()
        ) {
          throw new RangeError("A log shading target must name a log.");
        }
        break;
      default:
        throw new RangeError("Unsupported shading target.");
    }
  }

  draw(
    svg: SVGGElement,
    trackConfig: TrackConfig,
    logData: LogData,
    location: Location,
    depthPixelsPerUnit: number,
    trackHeaderHeight: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    const sourceIndex = trackConfig.logs.findIndex(
      (log) => String(log.name) === this.config.sourceLog,
    );
    if (sourceIndex === -1) {
      throw new RangeError(
        `Shading source log "${this.config.sourceLog}" does not exist in this track.`,
      );
    }

    let targetConfig: LogConfig | undefined;
    let targetValues: readonly number[] | undefined;
    let targetIsEdge = false;
    const target = this.config.target;
    if (target.type === "log") {
      targetConfig = trackConfig.logs.find(
        (log) => String(log.name) === target.name,
      );
      if (!targetConfig || targetConfig === trackConfig.logs[sourceIndex]) {
        throw new RangeError(
          `Shading target log "${target.name}" must be a different log in this track.`,
        );
      }
      targetValues = logData[String(targetConfig.name)];
    } else if (target.type === "previous") {
      targetConfig = trackConfig.logs[sourceIndex - 1];
      if (!targetConfig) {
        return;
      }
      targetValues = logData[String(targetConfig.name)];
    } else {
      targetIsEdge = true;
    }

    const sourceConfig = trackConfig.logs[sourceIndex];
    const sourceValues = logData[this.config.sourceLog];
    if (!sourceValues) {
      throw new RangeError(
        `Shading source log "${this.config.sourceLog}" has no curve data.`,
      );
    }
    if (!targetIsEdge && !targetValues) {
      throw new RangeError(
        `Shading target log "${String(targetConfig?.name)}" has no curve data.`,
      );
    }

    const depth = logData.depth;
    const sampleCount = targetIsEdge
      ? Math.min(depth.length, sourceValues.length)
      : Math.min(depth.length, sourceValues.length, targetValues!.length);
    const plotTop =
      location.top + trackHeaderHeight + LOG_PLOT_TOP_PADDING;
    const leftEdge = location.left;
    const rightEdge = location.left + trackConfig.width;
    const edgeX = this.side === "left" ? leftEdge : rightEdge;
    const polygons: string[] = [];

    const getSample = (index: number) => {
      const sampleDepth = depth[index];
      if (!Number.isFinite(sampleDepth)) {
        return null;
      }
      const sourceX = mapLogValueToX(
        sourceValues[index],
        sourceConfig,
        trackConfig.scale,
        location.left,
        trackConfig.width,
      );
      const targetX = targetIsEdge
        ? edgeX
        : mapLogValueToX(
            targetValues![index],
            targetConfig!,
            trackConfig.scale,
            location.left,
            trackConfig.width,
          );
      if (sourceX === null || targetX === null) {
        return null;
      }
      return {
        sourceX,
        targetX,
        y: plotTop + (sampleDepth - minDepth) * depthPixelsPerUnit,
        sourceWasWrapped:
          sourceConfig.wrap && sourceValues[index] > sourceConfig.max,
        targetWasWrapped:
          !targetIsEdge &&
          targetConfig!.wrap &&
          targetValues![index] > targetConfig!.max,
      };
    };

    for (let index = 0; index < sampleCount - 1; index++) {
      const start = getSample(index);
      const end = getSample(index + 1);
      if (
        !start ||
        !end ||
        start.sourceWasWrapped !== end.sourceWasWrapped ||
        start.targetWasWrapped !== end.targetWasWrapped
      ) {
        continue;
      }

      const startDistance = this.side === "left"
        ? start.sourceX - start.targetX
        : start.targetX - start.sourceX;
      const endDistance = this.side === "left"
        ? end.sourceX - end.targetX
        : end.targetX - end.sourceX;
      if (startDistance <= 0 && endDistance <= 0) {
        continue;
      }

      let startPoint = start;
      let endPoint = end;
      if ((startDistance > 0) !== (endDistance > 0)) {
        const fraction =
          startDistance / (startDistance - endDistance);
        const crossingY = start.y + (end.y - start.y) * fraction;
        const crossingX =
          start.sourceX + (end.sourceX - start.sourceX) * fraction;
        const crossing = {
          sourceX: crossingX,
          targetX: crossingX,
          y: crossingY,
          sourceWasWrapped: start.sourceWasWrapped,
          targetWasWrapped: start.targetWasWrapped,
        };
        if (startDistance <= 0) {
          startPoint = crossing;
        } else {
          endPoint = crossing;
        }
      }

      polygons.push(
        `M ${startPoint.sourceX} ${startPoint.y} ` +
          `L ${endPoint.sourceX} ${endPoint.y} ` +
          `L ${endPoint.targetX} ${endPoint.y} ` +
          `L ${startPoint.targetX} ${startPoint.y} Z`,
      );
    }

    if (polygons.length === 0) {
      return;
    }

    const clipId = `log-shading-clip-${nextLogShadingClipId++}`;
    const defs = document.createElementNS(SVG_NAMESPACE, "defs");
    const clipPath = document.createElementNS(SVG_NAMESPACE, "clipPath");
    clipPath.setAttribute("id", clipId);
    clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
    const clipRect = document.createElementNS(SVG_NAMESPACE, "rect");
    clipRect.setAttribute("x", leftEdge.toString());
    clipRect.setAttribute("y", plotTop.toString());
    clipRect.setAttribute("width", trackConfig.width.toString());
    clipRect.setAttribute(
      "height",
      ((maxDepth - minDepth) * depthPixelsPerUnit).toString(),
    );
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("class", `log-shading-area log-shading-${this.side}`);
    path.setAttribute("data-shading-side", this.side);
    path.setAttribute("data-shading-source", this.config.sourceLog);
    path.setAttribute("data-shading-target", this.config.target.type);
    if (this.config.target.type === "log") {
      path.setAttribute("data-shading-target-log", this.config.target.name);
    }
    path.setAttribute("fill", this.config.color);
    path.setAttribute("fill-opacity", this.config.opacity.toString());
    path.setAttribute("stroke", "none");
    path.setAttribute("pointer-events", "none");
    path.setAttribute("clip-path", `url(#${clipId})`);
    path.setAttribute("d", polygons.join(" "));
    svg.appendChild(path);
  }
}

export class Log {
  private readonly svg: SVGSVGElement|SVGGElement;
  private readonly path: SVGPathElement;
  private readonly logData: LogData;
  private readonly logConfig: LogConfig;
  private readonly location: Location;
  private readonly trackWidth: number;
  private readonly depthPixelsPerUnit: number;
  private readonly scale: TrackConfig["scale"];
  private readonly trackIndex: number;
  private readonly logIndex: number;
  private readonly hitPath: SVGPathElement;

  constructor(
    svg: SVGSVGElement | SVGGElement,
    logConfig: LogConfig,
    logData: LogData,
    location: Location,
    trackWidth: number,
    depthPixelsPerUnit: number,
    scale: TrackConfig["scale"],
    trackIndex: number,
    logIndex: number
  ) {
    // this.svg = document.createElementNS(SVG_NAMESPACE, "svg");
    // this.svg.setAttribute("width", "5000");
    // this.svg.setAttribute("height", "5000");
    // this.svg.setAttribute("viewBox", "0 0 5000 5000");

    this.logConfig = logConfig;
    this.logData = logData;
    this.location = location;
    this.trackWidth = trackWidth;
    this.depthPixelsPerUnit = depthPixelsPerUnit;
    this.scale = scale;
    this.trackIndex = trackIndex;
    this.logIndex = logIndex;
    this.svg = svg;
    this.path = document.createElementNS(SVG_NAMESPACE, "path");
    this.path.setAttribute("fill", "none");
    this.path.setAttribute("stroke", logConfig.color.toString());
    this.path.setAttribute("stroke-width", logConfig.weight.toString());
    this.path.setAttribute("pointer-events", "none");
    this.path.setAttribute("data-log-index", logIndex.toString());
    this.path.setAttribute("data-log-name", String(logConfig.name));
    this.hitPath = document.createElementNS(SVG_NAMESPACE, "path");
    this.hitPath.setAttribute("class", "layout-log-hit-target");
    this.hitPath.setAttribute("fill", "none");
    this.hitPath.setAttribute("stroke", "#000000");
    this.hitPath.setAttribute("stroke-opacity", "0.01");
    this.hitPath.setAttribute("stroke-width", "12");
    this.hitPath.setAttribute("pointer-events", "stroke");
    this.hitPath.setAttribute("role", "button");
    this.hitPath.setAttribute("tabindex", "0");
    this.hitPath.setAttribute("data-layout-action", "select-log");
    this.hitPath.setAttribute("data-log-index", logIndex.toString());
    this.hitPath.setAttribute("data-log-name", String(logConfig.name));
    this.hitPath.setAttribute("aria-label", `Select log ${String(logConfig.name)}`);
    this.svg.appendChild(this.path);
    this.svg.appendChild(this.hitPath);
    // parentElement.appendChild(this.svg);
    console.log("Log location left", location.left);
  }
  drawPath(start: number): void {
    // const xStart = start + 75;
    // this.path.setAttribute(
    //   "d",
    //   `M ${xStart} 50 L ${xStart - 5} 75 L ${xStart} 100 L ${xStart} 10000`,
    // );
  }
  draw(): void {
    const { depth } = this.logData;
    const log = this.logData[this.logConfig.name as string];
    const {left, top} = this.location;
    console.log(`drawing log ${this.logConfig.name}, left: ${left}, top: ${top}, right: ${left+this.trackWidth}`);
    const {min, max} = this.logConfig;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new RangeError(`Log "${this.logConfig.name}" must have a finite range where max is greater than min.`);
    }
    if (this.scale === "logarithmic" && min <= 0) {
      throw new RangeError(
        `Log "${this.logConfig.name}" must have a positive minimum for a logarithmic track.`,
      );
    }

    const path = [];
    let startSegment = true;
    let previousValueWasWrapped = false;
    const xarray = [];
    let minDepth = Infinity;
    for (const value of depth) {
      if (Number.isFinite(value)) {
        minDepth = Math.min(minDepth, value);
      }
    }
    for (let i = 0; i < depth.length; i++) {
      const value = log[i];

      if (
        typeof depth[i] !== "number" ||
        !Number.isFinite(depth[i]) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value === -999.25 ||
        (this.scale === "logarithmic" && value <= 0)
      ) {
        startSegment = true;
        previousValueWasWrapped = false;
        continue;
      }

      if (!this.logConfig.wrap && value > max) {
        startSegment = true;
        previousValueWasWrapped = false;
        continue;
      }
      
      const valueWasWrapped = this.logConfig.wrap && value > max;
      if (valueWasWrapped !== previousValueWasWrapped) {
        startSegment = true;
      }

      const x = mapLogValueToX(
        value,
        this.logConfig,
        this.scale,
        left,
        this.trackWidth,
      );
      if (x === null) {
        startSegment = true;
        previousValueWasWrapped = false;
        continue;
      }
      const y = top + LOG_PLOT_TOP_PADDING + (depth[i] - minDepth) * this.depthPixelsPerUnit;
      xarray.push(x);
      path.push(`${startSegment ? "M" : "L"} ${x} ${y}`);
      startSegment = false;
      previousValueWasWrapped = valueWasWrapped;
    }

    const pathData = path.join(" ");
    this.path.setAttribute("d", pathData);
    this.hitPath.setAttribute("d", pathData);
    this.hitPath.setAttribute("data-track-index", this.trackIndex.toString());
    this.path.setAttribute("data-track-index", this.trackIndex.toString());
    console.log("xarray", xarray);
    this.svg.appendChild(this.path);
    this.svg.appendChild(this.hitPath);
  }
}

export class LogTrackHeader{
  private readonly svg:SVGSVGElement|SVGGElement;
  private readonly location: Location;
  private readonly trackConfig: TrackConfig;
  private readonly trackHeaderHeight: number;
  private readonly svgHeight: number;

  constructor(
    svg: SVGSVGElement | SVGGElement,
    location: Location,
    trackConfig: TrackConfig,
    trackHeaderHeight: number,
    svgHeight: number,
    trackIndex: number
  ) {
    this.svg = svg;
    this.location = location;
    this.trackConfig = trackConfig;
    this.trackHeaderHeight = trackHeaderHeight;
    this.svgHeight = svgHeight;
  }
  draw(): void {
    const headerBox = document.createElementNS(SVG_NAMESPACE, "rect");
    headerBox.setAttribute("class", "layout-track-header");
    headerBox.setAttribute("x", this.location.left.toString());
    headerBox.setAttribute("y", this.location.top.toString());
    headerBox.setAttribute("fill", "transparent");
    headerBox.setAttribute("stroke", "black");
    headerBox.setAttribute("width", this.trackConfig.width.toString());
    headerBox.setAttribute("height", this.trackHeaderHeight.toString());
    this.svg.appendChild(headerBox);

    const rowHeight = this.trackConfig.logs.length > 0
      ? this.trackHeaderHeight / this.trackConfig.logs.length
      : this.trackHeaderHeight;
    this.trackConfig.logs.forEach((log, index) => {
      const rowTop = this.location.top + index * rowHeight;
      const centerX = this.location.left + this.trackConfig.width / 2;
      const label = document.createElementNS(SVG_NAMESPACE, "text");
      label.setAttribute("x", centerX.toString());
      label.setAttribute("y", (rowTop + rowHeight * 0.25).toString());
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("font-size", "10");
      label.textContent = String(log.name);
      this.svg.appendChild(label);

      const line = document.createElementNS(SVG_NAMESPACE, "line");
      line.setAttribute("x1", (this.location.left + 8).toString());
      line.setAttribute("x2", (this.location.left + this.trackConfig.width - 8).toString());
      line.setAttribute("y1", (rowTop + rowHeight * 0.52).toString());
      line.setAttribute("y2", (rowTop + rowHeight * 0.52).toString());
      line.setAttribute("stroke", String(log.color));
      line.setAttribute("stroke-width", String(log.weight));
      this.svg.appendChild(line);

      const minLabel = document.createElementNS(SVG_NAMESPACE, "text");
      minLabel.setAttribute("x", (this.location.left + 5).toString());
      minLabel.setAttribute("y", (rowTop + rowHeight * 0.82).toString());
      minLabel.setAttribute("text-anchor", "start");
      minLabel.setAttribute("dominant-baseline", "middle");
      minLabel.setAttribute("font-size", "9");
      minLabel.textContent = String(log.min);
      this.svg.appendChild(minLabel);

      const maxLabel = document.createElementNS(SVG_NAMESPACE, "text");
      maxLabel.setAttribute("x", (this.location.left + this.trackConfig.width - 5).toString());
      maxLabel.setAttribute("y", (rowTop + rowHeight * 0.82).toString());
      maxLabel.setAttribute("text-anchor", "end");
      maxLabel.setAttribute("dominant-baseline", "middle");
      maxLabel.setAttribute("font-size", "9");
      maxLabel.textContent = String(log.max);
      this.svg.appendChild(maxLabel);
    });

    const plotBox = document.createElementNS(SVG_NAMESPACE, "rect");
    plotBox.setAttribute("x", this.location.left.toString());
    plotBox.setAttribute("y", (this.location.top + this.trackHeaderHeight).toString());
    plotBox.setAttribute("fill", "none");
    plotBox.setAttribute("stroke", "black");
    plotBox.setAttribute("width", this.trackConfig.width.toString());
    plotBox.setAttribute(
      "height",
      Math.max(0, this.svgHeight - this.location.top - this.trackHeaderHeight).toString()
    );
    this.svg.appendChild(plotBox);
  }
}

export class DepthTrack {
  private readonly group: SVGGElement;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly location: Location,
    private readonly width: number,
    private readonly height: number,
    private readonly minDepth: number,
    private readonly maxDepth: number,
    private readonly depthPixelsPerUnit: number,
    private readonly depthUnit: DepthUnit,
    private readonly trackHeaderHeight: number
  ) {
    this.group = document.createElementNS(SVG_NAMESPACE, "g");
    this.svg.appendChild(this.group);
  }

  draw(): void {
    this.group.replaceChildren();

    const header = document.createElementNS(SVG_NAMESPACE, "rect");
    header.setAttribute("x", this.location.left.toString());
    header.setAttribute("y", this.location.top.toString());
    header.setAttribute("width", this.width.toString());
    header.setAttribute("height", this.trackHeaderHeight.toString());
    header.setAttribute("fill", "none");
    header.setAttribute("stroke", "black");
    this.group.appendChild(header);

    const title = document.createElementNS(SVG_NAMESPACE, "text");
    title.setAttribute("x", (this.location.left + this.width / 2).toString());
    title.setAttribute("y", (this.location.top + this.trackHeaderHeight / 2).toString());
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("dominant-baseline", "middle");
    title.setAttribute("font-size", "12");
    title.textContent = `Depth (${this.depthUnit})`;
    this.group.appendChild(title);

    const plotTop = this.location.top + this.trackHeaderHeight + LOG_PLOT_TOP_PADDING;
    const plotBottom = plotTop + (this.maxDepth - this.minDepth) * this.depthPixelsPerUnit;

    const border = document.createElementNS(SVG_NAMESPACE, "rect");
    border.setAttribute("x", this.location.left.toString());
    border.setAttribute("y", (this.location.top + this.trackHeaderHeight).toString());
    border.setAttribute("width", this.width.toString());
    border.setAttribute("height", (this.height - this.trackHeaderHeight).toString());
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "black");
    this.group.appendChild(border);

    const tickInterval = getDepthTickInterval(this.depthPixelsPerUnit);
    const firstTick = Math.ceil(this.minDepth / tickInterval) * tickInterval;
    const ticks = this.minDepth === this.maxDepth
      ? [this.minDepth]
      : [];
    for (let depth = firstTick; depth <= this.maxDepth; depth += tickInterval) {
      ticks.push(depth);
    }

    for (const depth of ticks) {
      const y = plotTop + (depth - this.minDepth) * this.depthPixelsPerUnit;
      if (y > plotBottom) {
        break;
      }

      const tick = document.createElementNS(SVG_NAMESPACE, "line");
      tick.setAttribute("x1", (this.location.left + this.width - 6).toString());
      tick.setAttribute("x2", (this.location.left + this.width).toString());
      tick.setAttribute("y1", y.toString());
      tick.setAttribute("y2", y.toString());
      tick.setAttribute("stroke", "black");
      this.group.appendChild(tick);

      const label = document.createElementNS(SVG_NAMESPACE, "text");
      label.setAttribute("x", (this.location.left + this.width - 9).toString());
      label.setAttribute("y", y.toString());
      label.setAttribute("text-anchor", "end");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("font-size", "10");
      label.textContent = Number(depth.toPrecision(10)).toString();
      this.group.appendChild(label);
    }
  }
}

export class LogTrack {
  private readonly svg:SVGSVGElement;
  private readonly  logs: Log[] = [];
  readonly leftShadings: LogShading[];
  readonly rightShadings: LogShading[];
  private readonly location: Location;
  private readonly trackConfig: TrackConfig;
  private readonly logData: LogData;
  private readonly logTrackHeader: LogTrackHeader;
  private readonly trackHeaderHeight: number;
  private readonly trackSVGGroup: SVGGElement;
  private readonly depthPixelsPerUnit: number;
  private readonly minDepth: number;
  private readonly maxDepth: number;

  constructor(
    svg: SVGSVGElement,
    location: Location,
    trackConfig: TrackConfig,
    logData: LogData,
    depthPixelsPerUnit: number,
    svgHeight: number,
    trackHeaderHeight: number,
    trackIndex: number,
    minDepth: number,
    maxDepth: number
  ) {
    console.log("LogTrack location: ", location.left);
    this.svg = svg;
    this.location = location;
    this.trackConfig = trackConfig;
    this.logData = logData;
    this.trackHeaderHeight = trackHeaderHeight;
    this.depthPixelsPerUnit = depthPixelsPerUnit;
    this.minDepth = minDepth;
    this.maxDepth = maxDepth;
    this.leftShadings = (trackConfig.leftShadings ?? []).map(
      (config) => new LogShading(config, "left"),
    );
    this.rightShadings = (trackConfig.rightShadings ?? []).map(
      (config) => new LogShading(config, "right"),
    );
    this.trackSVGGroup = document.createElementNS(SVG_NAMESPACE, "g");
    this.trackSVGGroup.setAttribute("data-track-index", trackIndex.toString());
    this.trackSVGGroup.setAttribute("data-layout-action", "reorder-track");
    this.trackSVGGroup.setAttribute("role", "group");
    this.trackSVGGroup.setAttribute("tabindex", "0");
    this.trackSVGGroup.setAttribute("aria-label", `Select track ${trackIndex + 1}`);
    this.trackSVGGroup.setAttribute("width", trackConfig.width.toString());
    for (const [logIndex, logConfig] of trackConfig.logs.entries()) {
      let log = new Log(
        this.trackSVGGroup,
        logConfig,
        logData,
        {...location, top: location.top + this.trackHeaderHeight},
        this.trackConfig.width,
        depthPixelsPerUnit,
        this.trackConfig.scale,
        trackIndex,
        logIndex
      );
      this.logs.push(log);
    }
    this.logTrackHeader = new LogTrackHeader(
      this.trackSVGGroup,
      location,
      trackConfig,
      this.trackHeaderHeight,
      svgHeight,
      trackIndex
    );
    this.svg.appendChild(this.trackSVGGroup);
  }
  // readonly meta: Record<string, unknown>;
  // readonly header: Record<string, unknown>;

  // addLog(data: LogData): Log {
  //   const log = new Log(this.parentElement, data);
  //   this.logs.push(log);
  //   return log;
  // }
  draw(): void {
    this.trackSVGGroup.replaceChildren();
    if (this.trackConfig.showGrid) {
      this.drawGrid();
    }
    this.leftShadings.forEach((shading) =>
      shading.draw(
        this.trackSVGGroup,
        this.trackConfig,
        this.logData,
        this.location,
        this.depthPixelsPerUnit,
        this.trackHeaderHeight,
        this.minDepth,
        this.maxDepth,
      ),
    );
    this.rightShadings.forEach((shading) =>
      shading.draw(
        this.trackSVGGroup,
        this.trackConfig,
        this.logData,
        this.location,
        this.depthPixelsPerUnit,
        this.trackHeaderHeight,
        this.minDepth,
        this.maxDepth,
      ),
    );
    this.logTrackHeader.draw();
    this.logs.forEach((log) => log.draw());
  }

  private drawGrid(): void {
    const gridGroup = document.createElementNS(SVG_NAMESPACE, "g");
    gridGroup.setAttribute("class", "log-track-grid");
    gridGroup.setAttribute("pointer-events", "none");

    const plotTop =
      this.location.top + this.trackHeaderHeight + LOG_PLOT_TOP_PADDING;
    const plotBottom =
      plotTop + (this.maxDepth - this.minDepth) * this.depthPixelsPerUnit;
    const right = this.location.left + this.trackConfig.width;

    if (this.trackConfig.scale === "logarithmic") {
      const gridLog = this.trackConfig.logs[0];
      if (gridLog && gridLog.min > 0 && gridLog.max > gridLog.min) {
        const minLog = Math.log10(gridLog.min);
        const maxLog = Math.log10(gridLog.max);
        const firstDecade = Math.floor(minLog);
        const lastDecade = Math.ceil(maxLog);
        const decadeStep = Math.max(
          1,
          Math.ceil((lastDecade - firstDecade) / 30),
        );

        for (
          let decade = firstDecade;
          decade <= lastDecade;
          decade += decadeStep
        ) {
          for (const multiplier of [1, 2, 5]) {
            const value = multiplier * 10 ** decade;
            if (value <= gridLog.min || value >= gridLog.max) {
              continue;
            }
            const fraction =
              (Math.log10(value) - minLog) / (maxLog - minLog);
            const x = this.location.left + fraction * this.trackConfig.width;
            const line = document.createElementNS(SVG_NAMESPACE, "line");
            line.setAttribute("x1", x.toString());
            line.setAttribute("x2", x.toString());
            line.setAttribute("y1", plotTop.toString());
            line.setAttribute("y2", plotBottom.toString());
            line.setAttribute("stroke", "#d9e0e9");
            const isMajor = multiplier === 1;
            line.setAttribute("stroke-width", isMajor ? "1" : "0.6");
            line.setAttribute("data-grid-value", value.toString());
            line.setAttribute("data-grid-major", isMajor.toString());
            gridGroup.appendChild(line);
          }
        }
      }
    } else {
      for (let division = 1; division < 10; division++) {
        const x = this.location.left + (this.trackConfig.width * division) / 10;
        const line = document.createElementNS(SVG_NAMESPACE, "line");
        line.setAttribute("x1", x.toString());
        line.setAttribute("x2", x.toString());
        line.setAttribute("y1", plotTop.toString());
        line.setAttribute("y2", plotBottom.toString());
        line.setAttribute("stroke", "#d9e0e9");
        line.setAttribute("stroke-width", "0.75");
        gridGroup.appendChild(line);
      }
    }

    if (this.minDepth === this.maxDepth) {
      const line = document.createElementNS(SVG_NAMESPACE, "line");
      const y = plotTop;
      line.setAttribute("x1", this.location.left.toString());
      line.setAttribute("x2", right.toString());
      line.setAttribute("y1", y.toString());
      line.setAttribute("y2", y.toString());
      line.setAttribute("stroke", "#d9e0e9");
      line.setAttribute("stroke-width", "0.75");
      gridGroup.appendChild(line);
    } else {
      const tickInterval = getDepthTickInterval(this.depthPixelsPerUnit);
      const firstTick = Math.ceil(this.minDepth / tickInterval) * tickInterval;
      for (let depth = firstTick; depth <= this.maxDepth; depth += tickInterval) {
        const y =
          plotTop + (depth - this.minDepth) * this.depthPixelsPerUnit;
        const line = document.createElementNS(SVG_NAMESPACE, "line");
        line.setAttribute("x1", this.location.left.toString());
        line.setAttribute("x2", right.toString());
        line.setAttribute("y1", y.toString());
        line.setAttribute("y2", y.toString());
        line.setAttribute("stroke", "#d9e0e9");
        line.setAttribute("stroke-width", "0.75");
        gridGroup.appendChild(line);
      }
    }

    this.trackSVGGroup.appendChild(gridGroup);
  }
}

export class CompositeLog {
  readonly tracks: LogTrack[] = [];
  private readonly depthTrack: DepthTrack;
  layout: LayoutConfig;
  logHeaders: String[];
  logData: LogData;
  private readonly svg: SVGSVGElement;
  private header: CompositeLogHeader;
  size:Size;

  calculateHeight(depthLog: readonly number[], scale: number, depthUnit: DepthUnit): number {
    if (depthLog.length === 0) {
      throw new RangeError("At least one depth value is required to calculate height.");
    }

    const depthPixelsPerUnit = getDepthPixelsPerUnit(scale, depthUnit);
    let minDepth = Infinity;
    let maxDepth = -Infinity;
    for (const depth of depthLog) {
      if (!Number.isFinite(depth)) {
        throw new RangeError("Depth values must all be finite numbers.");
      }
      minDepth = Math.min(minDepth, depth);
      maxDepth = Math.max(maxDepth, depth);
    }

    const plotHeight = (maxDepth - minDepth) * depthPixelsPerUnit;
    const trackHeaderHeight = this.layout.trackHeaderHeight ?? LOG_TRACK_HEADER_HEIGHT;
    return this.layout.header.height +
      trackHeaderHeight +
      LOG_PLOT_TOP_PADDING +
      plotHeight +
      LOG_PLOT_BOTTOM_PADDING;
  }

  constructor(private readonly parentElement: HTMLElement,
     layout: LayoutConfig, logHeaders: String[], logData: LogData,
     wellName = "Well-Name") {
      this.svg = document.createElementNS(SVG_NAMESPACE, "svg");
      parentElement.appendChild(this.svg);
      this.layout = layout;
      this.logHeaders = logHeaders;
      this.logData = logData;
      const headerHeight = this.layout.header.height;
      const height = this.calculateHeight(logData.depth, layout.scale, layout.depthUnits);
      const width = this.layout.width;
      this.size = {width:width, height: height};
      this.header = new CompositeLogHeader(
        this.svg,
        layout.header,
        {left:0,top:0},
        {width:width, height: headerHeight},
        wellName
      )
      const depthPixelsPerUnit = getDepthPixelsPerUnit(layout.scale, layout.depthUnits);
      let minDepth = Infinity;
      let maxDepth = -Infinity;
      for (const depth of logData.depth) {
        minDepth = Math.min(minDepth, depth);
        maxDepth = Math.max(maxDepth, depth);
      }
      const depthTrackWidth = layout.depthTrackWidth ?? DEFAULT_DEPTH_TRACK_WIDTH;
      if (!Number.isFinite(depthTrackWidth) || depthTrackWidth <= 0) {
        throw new RangeError("Depth track width must be a finite positive number.");
      }
      const trackHeaderHeight = layout.trackHeaderHeight ?? LOG_TRACK_HEADER_HEIGHT;
      if (!Number.isFinite(trackHeaderHeight) || trackHeaderHeight <= 0) {
        throw new RangeError("Track header height must be a finite positive number.");
      }
      this.depthTrack = new DepthTrack(
        this.svg,
        {left: 0, top: headerHeight},
        depthTrackWidth,
        height - headerHeight,
        minDepth,
        maxDepth,
        depthPixelsPerUnit,
        layout.depthUnits,
        trackHeaderHeight
      );
      let location:Location = {left: depthTrackWidth, top: layout.header.height};
      for(const trackConfig of layout.tracks){
        let logTrack = new LogTrack(
          this.svg,
          {...location},
          trackConfig,
          logData,
          depthPixelsPerUnit,
          height,
          trackHeaderHeight,
          this.tracks.length,
          minDepth,
          maxDepth
        );
        this.tracks.push(logTrack);
        location.left += trackConfig.width;
      }
  }

  draw(): void {
    // setting the view box
    this.svg.setAttribute("width", this.size.width.toString());
    this.svg.setAttribute("height", this.size.height.toString());
    this.svg.setAttribute("viewBox", `0 0 ${this.size.width} ${this.size.height}`);
    this.header.draw();
    this.depthTrack.draw();
    for(let track of this.tracks){
      track.draw();
    }
    this.drawInteractionHandles();
  }

  private drawInteractionHandles(): void {
    this.svg.querySelectorAll(".layout-interaction-handle").forEach((handle) => handle.remove());

    const depthTrackWidth = this.layout.depthTrackWidth ?? DEFAULT_DEPTH_TRACK_WIDTH;
    const trackHeaderHeight = this.layout.trackHeaderHeight ?? LOG_TRACK_HEADER_HEIGHT;
    const headerHeight = this.layout.header.height;
    const addHandle = (
      action: string,
      x: number,
      y: number,
      width: number,
      height: number,
      label: string,
      trackIndex?: number
    ) => {
      const handle = document.createElementNS(SVG_NAMESPACE, "rect");
      handle.setAttribute("class", "layout-interaction-handle");
      handle.setAttribute("data-layout-action", action);
      if (trackIndex !== undefined) {
        handle.setAttribute("data-track-index", trackIndex.toString());
      }
      handle.setAttribute("x", x.toString());
      handle.setAttribute("y", y.toString());
      handle.setAttribute("width", width.toString());
      handle.setAttribute("height", height.toString());
      handle.setAttribute("fill", "transparent");
      handle.setAttribute("role", "separator");
      handle.setAttribute("tabindex", "0");
      handle.setAttribute(
        "aria-orientation",
        action.includes("height") ? "horizontal" : "vertical"
      );
      handle.setAttribute("aria-label", label);
      this.svg.appendChild(handle);
    };

    addHandle(
      "resize-header-height",
      0,
      Math.max(0, headerHeight - 5),
      this.size.width,
      10,
      "Resize composite header height"
    );
    addHandle(
      "resize-track-header-height",
      0,
      headerHeight + trackHeaderHeight - 5,
      this.size.width,
      10,
      "Resize shared track header height"
    );
    addHandle(
      "resize-depth-track-width",
      depthTrackWidth - 5,
      headerHeight,
      10,
      Math.max(0, this.size.height - headerHeight),
      "Resize depth track width"
    );

    let boundaryX = depthTrackWidth;
    for (let index = 0; index < this.layout.tracks.length; index++) {
      boundaryX += this.layout.tracks[index].width;
      addHandle(
        "resize-track-width",
        boundaryX - 5,
        headerHeight,
        10,
        Math.max(0, this.size.height - headerHeight),
        index + 1 < this.layout.tracks.length
          ? `Resize boundary between tracks ${index + 1} and ${index + 2}`
          : `Resize width of track ${index + 1}`,
        index
      );
    }
  }
}

export class CompositeLogHeader{
  svg:SVGSVGElement;
  headerConfig:HeaderConfig;
  location:Location;
  headerBox: SVGRectElement;
  headerGroup: SVGGElement;
  size: Size;
  constructor(
    svg: SVGSVGElement,
    headerConfig: HeaderConfig,
    location: Location,
    size: Size,
    private readonly wellName: string
  ){
    this.svg = svg;
    this.headerConfig = headerConfig;
    this.location = location;
    this.size = size;
    this.headerBox = document.createElementNS(SVG_NAMESPACE, "rect");
    this.headerGroup = document.createElementNS(SVG_NAMESPACE, "g");
  }
  draw(){
    // drawing the header
    this.headerBox.setAttribute("x", "0");
    this.headerBox.setAttribute("y", "0");
    this.headerBox.setAttribute("width", this.size.width.toString());
    this.headerBox.setAttribute("height", this.size.height.toString());
    this.headerBox.setAttribute("fill", "none");
    this.headerBox.setAttribute("stroke", "black");
    const well_name = document.createElementNS(SVG_NAMESPACE, "text");
    well_name.setAttribute("x", this.headerConfig.well_name.location.left.toString());
    well_name.setAttribute("y", this.headerConfig.well_name.location.top.toString());
    well_name.setAttribute("font-size", this.headerConfig.well_name.font_size.toString());
    well_name.setAttribute("font-family", this.headerConfig.well_name.font);
    well_name.setAttribute("fill", "black");
    well_name.appendChild(document.createTextNode(this.wellName));
    this.headerGroup.appendChild(this.headerBox);
    this.headerGroup.appendChild(well_name);
    this.svg.appendChild(this.headerGroup);
  }
}

/*

header configuration example in layout:
header well name location , top left , top right or others
tracks it will include

track configuration example in layout:
track width, track logs, color for each log, added shading configuration
is track linear or exponential, show grid or not, grid configuration, 
log min and max.

example: 
{
  header: {
    well_name: {
      font_size: 13px,
      font: arial,
      location: x, y
    }
    logo: {
      type: 
    }
  }
  tracks: [
    {
      logs: [
        gr: {
          color: red,
          weight: 1px,
          min: 10,
          max: 150,
        },
      ],
      growth: linear or exponential,
    }
  ]
}
*/
export interface HeaderConfig {
  well_name: TextConfig;
  logo: any;
  height: number;
}

export interface LogConfig {
  name: String;
  aliases: String[];
  color: String;
  weight: number;
  min: number;
  max: number;
  wrap: boolean;
}

export interface TrackConfig {
  logs: LogConfig[];
  scale: "linear" | "logarithmic";
  width: number;
  showGrid?: boolean;
  leftShadings?: LogShadingConfig[];
  rightShadings?: LogShadingConfig[];
}

export interface LayoutConfig {
  width: number;
  scale: number;
  depthUnits: DepthUnit;
  depthTrackWidth?: number;
  trackHeaderHeight?: number;
  header: HeaderConfig;
  tracks: TrackConfig[];
}

class Layout {
  header: Record<string, unknown> = {};
  tracks: LogTrack[] = [];
}
