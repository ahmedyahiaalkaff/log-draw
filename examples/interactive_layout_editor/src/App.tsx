import { useEffect, useRef, useState } from "react";
import {
  CompositeLog,
  type LayoutConfig,
  type LogConfig,
  type LogData,
  type LogShadingConfig,
  type LogShadingTarget,
  type TrackConfig,
} from "../../../src/log_draw";

const sampleCount = 61;
const wellName = "Well123";
const initialLogData: LogData = {
  depth: Array.from({ length: sampleCount }, (_, index) => 1500 + index),
  GR: Array.from(
    { length: sampleCount },
    (_, index) => 55 + 28 * Math.sin(index / 5) + 10 * Math.cos(index / 2.7),
  ),
  RDEP: Array.from(
    { length: sampleCount },
    (_, index) => 2 + 1.3 * Math.sin(index / 6) + 0.7 * Math.cos(index / 2.3),
  ),
};

const initialLayout: LayoutConfig = {
  width: 516,
  scale: 200,
  depthUnits: "ft",
  depthTrackWidth: 76,
  trackHeaderHeight: 100,
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
      scale: "linear",
      width: 220,
    },
    {
      logs: [
        {
          name: "RDEP",
          aliases: [],
          color: "#2563eb",
          weight: 2,
          min: 0,
          max: 6,
          wrap: false,
        },
      ],
      scale: "linear",
      width: 220,
    },
  ],
};

interface EditorState {
  layout: LayoutConfig;
  logData: LogData;
  nextCurve: number;
}

interface PointerGesture {
  action: string;
  pointerId: number;
  startX: number;
  startY: number;
  trackIndex?: number;
  guide: SVGLineElement;
}

const MIN_TRACK_WIDTH = 60;
const MIN_DEPTH_TRACK_WIDTH = 40;
const MIN_HEADER_HEIGHT = 32;
const MIN_TRACK_HEADER_HEIGHT = 48;

function getSvgPoint(event: PointerEvent, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM();
  if (!matrix) {
    return null;
  }
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createLogConfig(index: number): LogConfig {
  const colors = ["#15803d", "#9333ea", "#0891b2", "#db2777"];
  return {
    name: `LOG ${index + 1}`,
    aliases: [],
    color: colors[index % colors.length],
    weight: 2,
    min: 0,
    max: 150,
    wrap: false,
  };
}

function createCurve(index: number): readonly number[] {
  return Array.from(
    { length: sampleCount },
    (_, sample) =>
      60 +
      25 * Math.sin(sample / (4 + index)) +
      12 * Math.cos(sample / (2.5 + index / 2)),
  );
}

function getLogName(log: LogConfig): string {
  return String(log.name);
}

type ShadingSide = "left" | "right";

function getShadingKey(side: ShadingSide) {
  return side === "left" ? "leftShadings" : "rightShadings";
}

function getShadingTargetValue(target: LogShadingTarget): string {
  switch (target.type) {
    case "edge":
      return "edge";
    case "previous":
      return "previous";
    case "log":
      return `log:${target.name}`;
  }
}

function parseShadingTarget(value: string): LogShadingTarget | null {
  if (value === "edge") {
    return { type: "edge" };
  }
  if (value === "previous") {
    return { type: "previous" };
  }
  if (value.startsWith("log:")) {
    return { type: "log", name: value.slice(4) };
  }
  return null;
}

function retainLogData(logData: LogData, usedNames: Set<string>): LogData {
  const curves = Object.fromEntries(
    Object.entries(logData).filter(
      ([name]) => name !== "depth" && usedNames.has(name),
    ),
  );
  return { depth: logData.depth, ...curves };
}

function getLayoutError(layout: LayoutConfig): string | null {
  if (!Number.isFinite(layout.scale) || layout.scale <= 0) {
    return "Scale must be greater than zero.";
  }
  if (
    !Number.isFinite(layout.depthTrackWidth) ||
    (layout.depthTrackWidth ?? 0) <= 0
  ) {
    return "Depth track width must be greater than zero.";
  }
  if (
    !Number.isFinite(layout.trackHeaderHeight) ||
    (layout.trackHeaderHeight ?? 0) <= 0
  ) {
    return "Track header height must be greater than zero.";
  }
  if (!Number.isFinite(layout.header.height) || layout.header.height <= 0) {
    return "Header height must be greater than zero.";
  }
  for (const [trackIndex, track] of layout.tracks.entries()) {
    if (!Number.isFinite(track.width) || track.width <= 0) {
      return `Track ${trackIndex + 1} width must be greater than zero.`;
    }
    for (const log of track.logs) {
      if (track.scale === "logarithmic" && log.min <= 0) {
        return `${getLogName(log)} must have a positive minimum on a logarithmic track.`;
      }
      if (
        !Number.isFinite(log.min) ||
        !Number.isFinite(log.max) ||
        log.max <= log.min
      ) {
        return `${getLogName(log)} must have a finite maximum greater than its minimum.`;
      }
      if (!Number.isFinite(log.weight) || log.weight <= 0) {
        return `${getLogName(log)} line weight must be greater than zero.`;
      }
    }
    const logNames = track.logs.map(getLogName);
    for (const [side, shadings] of [
      ["left", track.leftShadings ?? []],
      ["right", track.rightShadings ?? []],
    ] as const) {
      for (const shading of shadings) {
        const sourceIndex = logNames.indexOf(shading.sourceLog);
        if (sourceIndex === -1) {
          return `Track ${trackIndex + 1} ${side} shading refers to a missing source log.`;
        }
        if (
          shading.target.type === "log" &&
          (!logNames.includes(shading.target.name) ||
            shading.target.name === shading.sourceLog)
        ) {
          return `Track ${trackIndex + 1} ${side} shading must target a different log in the same track.`;
        }
        if (shading.target.type === "previous" && sourceIndex === 0) {
          return `Track ${trackIndex + 1} ${side} shading needs a previous log.`;
        }
        if (
          !Number.isFinite(shading.opacity) ||
          shading.opacity < 0 ||
          shading.opacity > 1
        ) {
          return `Track ${trackIndex + 1} ${side} shading opacity must be between 0 and 1.`;
        }
        if (typeof shading.color !== "string" || !shading.color.trim()) {
          return `Track ${trackIndex + 1} ${side} shading needs a color.`;
        }
      }
    }
  }
  return null;
}

function App() {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const keyboardFocusRef = useRef<{
    action: string;
    trackIndex?: string;
  } | null>(null);
  const [editor, setEditor] = useState<EditorState>({
    layout: initialLayout,
    logData: initialLogData,
    nextCurve: 2,
  });
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(
    null,
  );
  const [selectedLogName, setSelectedLogName] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const layoutError = getLayoutError(editor.layout);
  const layout: LayoutConfig = {
    ...editor.layout,
    width:
      (editor.layout.depthTrackWidth ?? 70) +
      editor.layout.tracks.reduce((width, track) => width + track.width, 0),
  };
  const layoutJson = JSON.stringify(layout, null, 2);
  const logCount = layout.tracks.reduce(
    (count, track) => count + track.logs.length,
    0,
  );

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      throw new Error("Missing log container.");
    }
    container.replaceChildren();
    if (layoutError) {
      return;
    }

    const compositeLog = new CompositeLog(
      container,
      layout,
      ["DEPTH", ...Object.keys(editor.logData).filter((name) => name !== "depth")],
      editor.logData,
      wellName,
    );
    compositeLog.draw();

    const preview = container.querySelector("svg");
    if (!(preview instanceof SVGSVGElement)) {
      throw new Error("CompositeLog did not create an SVG preview.");
    }
    const svg: SVGSVGElement = preview;
    const keyboardFocus = keyboardFocusRef.current;
    if (keyboardFocus) {
      const handle = Array.from(
        svg.querySelectorAll<SVGElement>(".layout-interaction-handle"),
      ).find(
        (candidate) =>
          candidate.dataset.layoutAction === keyboardFocus.action &&
          candidate.dataset.trackIndex === keyboardFocus.trackIndex,
      );
      handle?.focus();
      keyboardFocusRef.current = null;
    }

    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const target = event.target.closest<SVGElement>("[data-layout-action]");
      const action = target?.dataset.layoutAction;
      if (!target || !action) {
        return;
      }

      if (action === "select-log") {
        const trackIndex = Number(target.dataset.trackIndex);
        const logName = target.dataset.logName;
        if (Number.isInteger(trackIndex) && logName) {
          setSelectedTrackIndex(trackIndex);
          setSelectedLogName(logName);
        }
        return;
      }

      const point = getSvgPoint(event, svg);
      if (!point) {
        return;
      }
      const trackIndex = Number(target.dataset.trackIndex);
      if (action === "reorder-track" && Number.isInteger(trackIndex)) {
        setSelectedTrackIndex(trackIndex);
      }
      if (
        action === "reorder-track" &&
        (point.y < layout.header.height ||
          point.y >
            layout.header.height +
              (layout.trackHeaderHeight ?? 100) ||
          !Number.isInteger(trackIndex))
      ) {
        return;
      }
      if (
        action !== "reorder-track" &&
        ![
          "resize-header-height",
          "resize-track-header-height",
          "resize-depth-track-width",
          "resize-track-width",
        ].includes(action)
      ) {
        return;
      }

      event.preventDefault();
      const guide = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      guide.setAttribute("class", "layout-drag-guide");
      guide.setAttribute("pointer-events", "none");
      const horizontal =
        action === "resize-header-height" ||
        action === "resize-track-header-height";
      guide.setAttribute("x1", horizontal ? "0" : point.x.toString());
      guide.setAttribute("x2", horizontal ? layout.width.toString() : point.x.toString());
      guide.setAttribute(
        "y1",
        horizontal
          ? point.y.toString()
          : (action === "reorder-track" ? layout.header.height : 0).toString(),
      );
      guide.setAttribute(
        "y2",
        horizontal
          ? point.y.toString()
          : (action === "reorder-track"
              ? layout.header.height + (layout.trackHeaderHeight ?? 100)
              : compositeLog.size.height
            ).toString(),
      );
      svg.appendChild(guide);
      pointerGestureRef.current = {
        action,
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        trackIndex: Number.isInteger(trackIndex) ? trackIndex : undefined,
        guide,
      };
      svg.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      const point = getSvgPoint(event, svg);
      if (!point) {
        return;
      }
      const horizontal =
        gesture.action === "resize-header-height" ||
        gesture.action === "resize-track-header-height";
      gesture.guide.setAttribute(
        "x1",
        horizontal ? "0" : point.x.toString(),
      );
      gesture.guide.setAttribute(
        "x2",
        horizontal ? layout.width.toString() : point.x.toString(),
      );
      gesture.guide.setAttribute(
        "y1",
        horizontal
          ? point.y.toString()
          : (gesture.action === "reorder-track"
              ? layout.header.height
              : 0
            ).toString(),
      );
      gesture.guide.setAttribute(
        "y2",
        horizontal
          ? point.y.toString()
          : (gesture.action === "reorder-track"
              ? layout.header.height + (layout.trackHeaderHeight ?? 100)
              : compositeLog.size.height
            ).toString(),
      );
    }

    function onPointerUp(event: PointerEvent) {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      const point = getSvgPoint(event, svg);
      gesture.guide.remove();
      pointerGestureRef.current = null;
      if (!point) {
        return;
      }

      const deltaX = point.x - gesture.startX;
      const deltaY = point.y - gesture.startY;
      if (
        gesture.action === "reorder-track" &&
        Math.abs(deltaX) < 4 &&
        Math.abs(deltaY) < 4
      ) {
        return;
      }
      if (gesture.action === "reorder-track") {
        const fromIndex = gesture.trackIndex;
        if (fromIndex !== undefined && layout.tracks[fromIndex]) {
          let insertionIndex = 0;
          let trackLeft = layout.depthTrackWidth ?? 70;
          for (const track of layout.tracks) {
            if (point.x < trackLeft + track.width / 2) {
              break;
            }
            insertionIndex++;
            trackLeft += track.width;
          }
          setSelectedTrackIndex(
            insertionIndex > fromIndex
              ? insertionIndex - 1
              : insertionIndex,
          );
        }
      }
      setEditor((current) => {
        const currentLayout = current.layout;
        if (gesture.action === "resize-header-height") {
          const height = clamp(
            currentLayout.header.height + deltaY,
            MIN_HEADER_HEIGHT,
            500,
          );
          return {
            ...current,
            layout: {
              ...currentLayout,
              header: { ...currentLayout.header, height },
            },
          };
        }
        if (gesture.action === "resize-track-header-height") {
          const trackHeaderHeight = clamp(
            (currentLayout.trackHeaderHeight ?? 100) + deltaY,
            MIN_TRACK_HEADER_HEIGHT,
            300,
          );
          return {
            ...current,
            layout: { ...currentLayout, trackHeaderHeight },
          };
        }
        if (gesture.action === "resize-depth-track-width") {
          const depthTrackWidth = clamp(
            (currentLayout.depthTrackWidth ?? 70) + deltaX,
            MIN_DEPTH_TRACK_WIDTH,
            400,
          );
          return {
            ...current,
            layout: { ...currentLayout, depthTrackWidth },
          };
        }
        if (gesture.action === "resize-track-width") {
          const index = gesture.trackIndex;
          if (index === undefined) {
            return current;
          }
          const left = currentLayout.tracks[index];
          const right = currentLayout.tracks[index + 1];
          if (!left) {
            return current;
          }
          if (!right) {
            const tracks = currentLayout.tracks.map((track, trackIndex) =>
              trackIndex === index
                ? {
                    ...track,
                    width: clamp(
                      track.width + deltaX,
                      MIN_TRACK_WIDTH,
                      1200,
                    ),
                  }
                : track,
            );
            return { ...current, layout: { ...currentLayout, tracks } };
          }
          const widthChange = clamp(
            deltaX,
            MIN_TRACK_WIDTH - left.width,
            right.width - MIN_TRACK_WIDTH,
          );
          const tracks = currentLayout.tracks.map((track, trackIndex) => {
            if (trackIndex === index) {
              return { ...track, width: track.width + widthChange };
            }
            if (trackIndex === index + 1) {
              return { ...track, width: track.width - widthChange };
            }
            return track;
          });
          return { ...current, layout: { ...currentLayout, tracks } };
        }
        if (gesture.action === "reorder-track") {
          const fromIndex = gesture.trackIndex;
          if (fromIndex === undefined || !currentLayout.tracks[fromIndex]) {
            return current;
          }
          let insertionIndex = 0;
          let trackLeft = currentLayout.depthTrackWidth ?? 70;
          for (const track of currentLayout.tracks) {
            if (point.x < trackLeft + track.width / 2) {
              break;
            }
            insertionIndex++;
            trackLeft += track.width;
          }
          const tracks = [...currentLayout.tracks];
          const [draggedTrack] = tracks.splice(fromIndex, 1);
          const targetIndex =
            insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
          tracks.splice(targetIndex, 0, draggedTrack);
          return {
            ...current,
            layout: { ...currentLayout, tracks },
          };
        }
        return current;
      });
    }

    function onPointerCancel(event: PointerEvent) {
      const gesture = pointerGestureRef.current;
      if (gesture?.pointerId === event.pointerId) {
        gesture.guide.remove();
        pointerGestureRef.current = null;
      }
    }

    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const logTarget = event.target.closest<SVGPathElement>(
        ".layout-log-hit-target",
      );
      if (!logTarget) {
        return;
      }
      const trackIndex = Number(logTarget.dataset.trackIndex);
      const logName = logTarget.dataset.logName;
      if (!Number.isInteger(trackIndex) || !logName) {
        return;
      }
      setSelectedTrackIndex(trackIndex);
      setSelectedLogName(logName);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const logTarget = event.target.closest<SVGPathElement>(
        ".layout-log-hit-target",
      );
      if (
        logTarget &&
        (event.key === "Enter" || event.key === " ")
      ) {
        const trackIndex = Number(logTarget.dataset.trackIndex);
        const logName = logTarget.dataset.logName;
        if (Number.isInteger(trackIndex) && logName) {
          event.preventDefault();
          setSelectedTrackIndex(trackIndex);
          setSelectedLogName(logName);
        }
        return;
      }
      const trackGroup = event.target.closest<SVGGElement>(
        '[data-layout-action="reorder-track"]',
      );
      if (
        trackGroup &&
        (event.key === "Enter" || event.key === " ")
      ) {
        const trackIndex = Number(trackGroup.dataset.trackIndex);
        if (Number.isInteger(trackIndex)) {
          event.preventDefault();
          setSelectedTrackIndex(trackIndex);
        }
        return;
      }
      const handle = event.target.closest<SVGElement>(
        ".layout-interaction-handle",
      );
      const action = handle?.dataset.layoutAction;
      if (!handle || !action) {
        return;
      }
      const step = event.shiftKey ? 10 : 5;
      const horizontalAction =
        action === "resize-header-height" ||
        action === "resize-track-header-height";
      const relevantKey = horizontalAction
        ? event.key === "ArrowUp" || event.key === "ArrowDown"
        : event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!relevantKey) {
        return;
      }
      event.preventDefault();
      const direction =
        event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const delta = direction * step;
      const trackIndex = Number(handle.dataset.trackIndex);
      keyboardFocusRef.current = {
        action,
        trackIndex: handle.dataset.trackIndex,
      };

      setEditor((current) => {
        const currentLayout = current.layout;
        if (action === "resize-header-height") {
          return {
            ...current,
            layout: {
              ...currentLayout,
              header: {
                ...currentLayout.header,
                height: clamp(
                  currentLayout.header.height + delta,
                  MIN_HEADER_HEIGHT,
                  500,
                ),
              },
            },
          };
        }
        if (action === "resize-track-header-height") {
          return {
            ...current,
            layout: {
              ...currentLayout,
              trackHeaderHeight: clamp(
                (currentLayout.trackHeaderHeight ?? 100) + delta,
                MIN_TRACK_HEADER_HEIGHT,
                300,
              ),
            },
          };
        }
        if (action === "resize-depth-track-width") {
          return {
            ...current,
            layout: {
              ...currentLayout,
              depthTrackWidth: clamp(
                (currentLayout.depthTrackWidth ?? 70) + delta,
                MIN_DEPTH_TRACK_WIDTH,
                400,
              ),
            },
          };
        }
        if (action === "resize-track-width" && Number.isInteger(trackIndex)) {
          const track = currentLayout.tracks[trackIndex];
          if (!track) {
            return current;
          }
          const neighbor = currentLayout.tracks[trackIndex + 1];
          if (neighbor) {
            const change = clamp(
              delta,
              MIN_TRACK_WIDTH - track.width,
              neighbor.width - MIN_TRACK_WIDTH,
            );
            const tracks = currentLayout.tracks.map((entry, index) => {
              if (index === trackIndex) {
                return { ...entry, width: entry.width + change };
              }
              if (index === trackIndex + 1) {
                return { ...entry, width: entry.width - change };
              }
              return entry;
            });
            return { ...current, layout: { ...currentLayout, tracks } };
          }
          const tracks = currentLayout.tracks.map((entry, index) =>
            index === trackIndex
              ? {
                  ...entry,
                  width: clamp(entry.width + delta, MIN_TRACK_WIDTH, 1200),
                }
              : entry,
          );
          return { ...current, layout: { ...currentLayout, tracks } };
        }
        return current;
      });
    }

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerCancel);
    svg.addEventListener("click", onClick);
    svg.addEventListener("keydown", onKeyDown);

    return () => {
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerCancel);
      svg.removeEventListener("click", onClick);
      svg.removeEventListener("keydown", onKeyDown);
      pointerGestureRef.current?.guide.remove();
      pointerGestureRef.current = null;
      container.replaceChildren();
    };
  }, [editor.layout, editor.logData, layoutError]);

  useEffect(() => {
    logContainerRef.current
      ?.querySelectorAll<SVGGElement>('[data-layout-action="reorder-track"]')
      .forEach((trackGroup, trackIndex) => {
        trackGroup.classList.toggle(
          "layout-track-selected",
          trackIndex === selectedTrackIndex,
        );
      });
    logContainerRef.current
      ?.querySelectorAll<SVGPathElement>("path[data-log-name]")
      .forEach((logPath) => {
        logPath.classList.toggle(
          "layout-log-selected",
          logPath.dataset.logName === selectedLogName,
        );
        logPath.classList.toggle(
          "layout-log-selected-curve",
          !logPath.classList.contains("layout-log-hit-target") &&
            logPath.dataset.logName === selectedLogName,
        );
      });
  }, [editor.layout, selectedLogName, selectedTrackIndex]);

  useEffect(() => {
    function onDeleteKey(event: KeyboardEvent) {
      if (
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        selectedTrackIndex === null ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const target = event.target;
      if (
        (target instanceof HTMLElement && target.isContentEditable) ||
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      event.preventDefault();
      if (selectedLogName !== null) {
        const selectedTrack = editor.layout.tracks[selectedTrackIndex];
        const selectedLogIndex = selectedTrack?.logs.findIndex(
          (log) => getLogName(log) === selectedLogName,
        );
        if (selectedLogIndex !== undefined && selectedLogIndex !== -1) {
          removeLog(selectedTrackIndex, selectedLogIndex);
        }
        return;
      }
      removeTrack(selectedTrackIndex);
    }

    window.addEventListener("keydown", onDeleteKey);
    return () => window.removeEventListener("keydown", onDeleteKey);
  }, [editor.layout.tracks, selectedLogName, selectedTrackIndex]);

  function updateLayout(patch: Partial<LayoutConfig>) {
    setEditor((current) => ({
      ...current,
      layout: { ...current.layout, ...patch },
    }));
  }

  function updateTrack(trackIndex: number, patch: Partial<TrackConfig>) {
    setEditor((current) => ({
      ...current,
      layout: {
        ...current.layout,
        tracks: current.layout.tracks.map((track, index) =>
          index === trackIndex ? { ...track, ...patch } : track,
        ),
      },
    }));
  }

  function updateLog(
    trackIndex: number,
    logIndex: number,
    patch: Partial<LogConfig>,
  ) {
    const tracks = editor.layout.tracks;
    const existing = tracks[trackIndex]?.logs[logIndex];
    if (!existing) {
      return;
    }

    const oldName = getLogName(existing);
    const newName =
      patch.name === undefined ? oldName : String(patch.name).trim();
    const nameIsTaken =
      newName === "depth" ||
      tracks.some((track, currentTrackIndex) =>
        track.logs.some(
          (log, currentLogIndex) =>
            (currentTrackIndex !== trackIndex || currentLogIndex !== logIndex) &&
            getLogName(log) === newName,
        ),
      );
    if (!newName || nameIsTaken) {
      setEditError(
        !newName
          ? "Log names cannot be empty."
          : `A log named "${newName}" already exists.`,
      );
      return;
    }

    setEditError(null);
    setSelectedLogName((selectedName) =>
      selectedName === oldName ? newName : selectedName,
    );
    setEditor((current) => {
      const currentLog = current.layout.tracks[trackIndex]?.logs[logIndex];
      if (!currentLog) {
        return current;
      }
      const nextLog = { ...currentLog, ...patch, name: newName };
      const nextTracks = current.layout.tracks.map((track, currentTrackIndex) =>
        currentTrackIndex === trackIndex
          ? {
              ...track,
              logs: track.logs.map((log, currentLogIndex) =>
                currentLogIndex === logIndex ? nextLog : log,
              ),
              leftShadings: track.leftShadings?.map((shading) => ({
                ...shading,
                sourceLog:
                  shading.sourceLog === oldName ? newName : shading.sourceLog,
                target:
                  shading.target.type === "log" &&
                  shading.target.name === oldName
                    ? { ...shading.target, name: newName }
                    : shading.target,
              })),
              rightShadings: track.rightShadings?.map((shading) => ({
                ...shading,
                sourceLog:
                  shading.sourceLog === oldName ? newName : shading.sourceLog,
                target:
                  shading.target.type === "log" &&
                  shading.target.name === oldName
                    ? { ...shading.target, name: newName }
                    : shading.target,
              })),
            }
          : track,
      );
      const logData: LogData = { ...current.logData };
      if (oldName !== newName) {
        logData[newName] = current.logData[oldName];
        delete logData[oldName];
      }
      return {
        ...current,
        layout: { ...current.layout, tracks: nextTracks },
        logData,
      };
    });
  }

  function addShading(trackIndex: number, logIndex: number, side: ShadingSide) {
    const log = editor.layout.tracks[trackIndex]?.logs[logIndex];
    if (!log) {
      return;
    }
    const key = getShadingKey(side);
    const shading: LogShadingConfig = {
      sourceLog: getLogName(log),
      target: { type: "edge" },
      color: String(log.color),
      opacity: 0.25,
    };
    const track = editor.layout.tracks[trackIndex];
    updateTrack(trackIndex, {
      [key]: [...(track[key] ?? []), shading],
    });
    setEditError(null);
  }

  function updateShading(
    trackIndex: number,
    side: ShadingSide,
    shadingIndex: number,
    patch: Partial<LogShadingConfig>,
  ) {
    const key = getShadingKey(side);
    const track = editor.layout.tracks[trackIndex];
    if (!track?.[key]?.[shadingIndex]) {
      return;
    }
    updateTrack(trackIndex, {
      [key]: track[key]!.map((shading, index) =>
        index === shadingIndex ? { ...shading, ...patch } : shading,
      ),
    });
    setEditError(null);
  }

  function removeShading(
    trackIndex: number,
    side: ShadingSide,
    shadingIndex: number,
  ) {
    const key = getShadingKey(side);
    const track = editor.layout.tracks[trackIndex];
    if (!track?.[key]?.[shadingIndex]) {
      return;
    }
    updateTrack(trackIndex, {
      [key]: track[key]!.filter((_, index) => index !== shadingIndex),
    });
    setEditError(null);
  }

  function addTrack() {
    setEditor((current) => {
      const log = createLogConfig(current.nextCurve);
      return {
        layout: {
          ...current.layout,
          tracks: [
            ...current.layout.tracks,
            { logs: [log], scale: "linear", width: 220 },
          ],
        },
        logData: {
          ...current.logData,
          [getLogName(log)]: createCurve(current.nextCurve),
        },
        nextCurve: current.nextCurve + 1,
      };
    });
    setEditError(null);
  }

  function addLog(trackIndex: number) {
    setEditor((current) => {
      const log = createLogConfig(current.nextCurve);
      return {
        ...current,
        layout: {
          ...current.layout,
          tracks: current.layout.tracks.map((track, index) =>
            index === trackIndex
              ? { ...track, logs: [...track.logs, log] }
              : track,
          ),
        },
        logData: {
          ...current.logData,
          [getLogName(log)]: createCurve(current.nextCurve),
        },
        nextCurve: current.nextCurve + 1,
      };
    });
    setEditError(null);
  }

  function removeTrack(trackIndex: number) {
    const track = editor.layout.tracks[trackIndex];
    if (!track) {
      return;
    }
    const logNames = track.logs.map(getLogName);
    if (logNames.includes(selectedLogName ?? "")) {
      setSelectedLogName(null);
    }
    const description =
      logNames.length > 0 ? ` and its logs (${logNames.join(", ")})` : "";
    if (
      !window.confirm(
        `Delete track ${trackIndex + 1}${description}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setEditor((current) => {
      const tracks = current.layout.tracks.filter(
        (_, index) => index !== trackIndex,
      );
      const usedNames = new Set(
        tracks.flatMap((track) => track.logs.map(getLogName)),
      );
      const logData = retainLogData(current.logData, usedNames);
      return {
        ...current,
        layout: { ...current.layout, tracks },
        logData,
      };
    });
    setSelectedTrackIndex((selectedIndex) => {
      if (selectedIndex === null || selectedIndex === trackIndex) {
        return null;
      }
      return selectedIndex > trackIndex ? selectedIndex - 1 : selectedIndex;
    });
    setEditError(null);
  }

  function moveTrack(trackIndex: number, offset: number) {
    setEditor((current) => {
      const destination = trackIndex + offset;
      if (
        destination < 0 ||
        destination >= current.layout.tracks.length
      ) {
        return current;
      }
      const tracks = [...current.layout.tracks];
      const [track] = tracks.splice(trackIndex, 1);
      tracks.splice(destination, 0, track);
      return {
        ...current,
        layout: { ...current.layout, tracks },
      };
    });
    setSelectedTrackIndex((selectedIndex) => {
      if (selectedIndex === trackIndex) {
        return trackIndex + offset;
      }
      if (
        selectedIndex !== null &&
        trackIndex < selectedIndex &&
        trackIndex + offset >= selectedIndex
      ) {
        return selectedIndex - 1;
      }
      if (
        selectedIndex !== null &&
        trackIndex > selectedIndex &&
        trackIndex + offset <= selectedIndex
      ) {
        return selectedIndex + 1;
      }
      return selectedIndex;
    });
  }

  function removeLog(trackIndex: number, logIndex: number) {
    const removedLog = editor.layout.tracks[trackIndex]?.logs[logIndex];
    if (
      !removedLog ||
      !window.confirm(
        `Delete log ${getLogName(removedLog)}? This cannot be undone.`,
      )
    ) {
      return;
    }
    if (getLogName(removedLog) === selectedLogName) {
      setSelectedLogName(null);
    }
    setEditor((current) => {
      const tracks = current.layout.tracks.map((track, index) =>
        index === trackIndex
          ? {
              ...track,
              logs: track.logs.filter((_, currentIndex) => currentIndex !== logIndex),
              leftShadings: track.leftShadings?.filter(
                (shading) =>
                  shading.sourceLog !== getLogName(removedLog) &&
                  !(
                    shading.target.type === "log" &&
                    shading.target.name === getLogName(removedLog)
                  ),
              ),
              rightShadings: track.rightShadings?.filter(
                (shading) =>
                  shading.sourceLog !== getLogName(removedLog) &&
                  !(
                    shading.target.type === "log" &&
                    shading.target.name === getLogName(removedLog)
                  ),
              ),
            }
          : track,
      );
      const usedNames = new Set(
        tracks.flatMap((track) => track.logs.map(getLogName)),
      );
      const logData = retainLogData(current.logData, usedNames);
      return {
        ...current,
        layout: { ...current.layout, tracks },
        logData,
      };
    });
    setEditError(null);
  }

  function downloadLayout() {
    const blob = new Blob([layoutJson], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "composite-layout.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function selectLogFromTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return;
    }
    const logTarget = target.closest<SVGPathElement>(
      ".layout-log-hit-target",
    );
    if (!logTarget) {
      return;
    }
    const trackIndex = Number(logTarget.dataset.trackIndex);
    const logName = logTarget.dataset.logName;
    if (!Number.isInteger(trackIndex) || !logName) {
      return;
    }
    setSelectedTrackIndex(trackIndex);
    setSelectedLogName(logName);
  }

  function renderShadingEditor(
    track: TrackConfig,
    trackIndex: number,
    log: LogConfig,
    logIndex: number,
    side: ShadingSide,
  ) {
    const key = getShadingKey(side);
    const sourceLog = getLogName(log);
    const shadings = (track[key] ?? [])
      .map((shading, shadingIndex) => ({ shading, shadingIndex }))
      .filter(({ shading }) => shading.sourceLog === sourceLog);

    return (
      <section
        className="shading-settings"
        aria-label={`${side} shading for ${sourceLog}`}
      >
        <div className="shading-heading">
          <h6>{side === "left" ? "Left shading" : "Right shading"}</h6>
          <button
            className="text-button"
            type="button"
            onClick={() => addShading(trackIndex, logIndex, side)}
          >
            + Add
          </button>
        </div>
        {shadings.map(({ shading, shadingIndex }) => (
          <div className="shading-rule" key={shadingIndex}>
            <label>
              Fill to
              <select
                aria-label={`${side} shading target for ${sourceLog}`}
                value={getShadingTargetValue(shading.target)}
                onChange={(event) => {
                  const target = parseShadingTarget(event.target.value);
                  if (target) {
                    updateShading(trackIndex, side, shadingIndex, { target });
                  }
                }}
              >
                <option value="edge">
                  {side === "left" ? "Left track edge" : "Right track edge"}
                </option>
                <option value="previous" disabled={logIndex === 0}>
                  Previous log
                </option>
                {track.logs.map((candidate) => (
                  <option
                    key={getLogName(candidate)}
                    value={`log:${getLogName(candidate)}`}
                    disabled={getLogName(candidate) === sourceLog}
                  >
                    {getLogName(candidate)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shading color
              <input
                className="color-input"
                type="color"
                aria-label={`${side} shading color for ${sourceLog}`}
                value={shading.color}
                onChange={(event) =>
                  updateShading(trackIndex, side, shadingIndex, {
                    color: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Opacity
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                aria-label={`${side} shading opacity for ${sourceLog}`}
                value={shading.opacity}
                onChange={(event) =>
                  updateShading(trackIndex, side, shadingIndex, {
                    opacity: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              className="text-button remove-button"
              type="button"
              aria-label={`Remove ${side} shading for ${sourceLog}`}
              onClick={() =>
                removeShading(trackIndex, side, shadingIndex)
              }
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    );
  }

  return (
    <main className="page">
      <header className="intro">
        <p className="eyebrow">log-draw · React layout editor</p>
        <h1>Composite wireline log</h1>
        <p>
          Edit the layout configuration and see the composite log update as you
          work. Download the configuration as JSON when you are done.
        </p>
      </header>

      <div className="workspace">
        <aside className="editor" aria-label="Layout configuration editor">
          <div className="editor-heading">
            <div>
              <p className="section-eyebrow">Configuration</p>
              <h2>Layout settings</h2>
            </div>
            <button
              className="download-button"
              onClick={downloadLayout}
              disabled={Boolean(layoutError)}
            >
              Download JSON
            </button>
          </div>

          <section className="settings-section">
            <h3>Chart and header</h3>
            <div className="field-grid">
              <label>
                Depth scale
                <input
                  type="number"
                  min="1"
                  value={editor.layout.scale}
                  onChange={(event) =>
                    updateLayout({ scale: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Depth units
                <select
                  value={editor.layout.depthUnits}
                  onChange={(event) =>
                    updateLayout({
                      depthUnits: event.target.value as "m" | "ft",
                    })
                  }
                >
                  <option value="ft">Feet (ft)</option>
                  <option value="m">Meters (m)</option>
                </select>
              </label>
              <label>
                Depth track width
                <input
                  type="number"
                  min="1"
                  value={editor.layout.depthTrackWidth}
                  onChange={(event) =>
                    updateLayout({
                      depthTrackWidth: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Track header height
                <input
                  type="number"
                  min={MIN_TRACK_HEADER_HEIGHT}
                  value={editor.layout.trackHeaderHeight}
                  onChange={(event) =>
                    updateLayout({
                      trackHeaderHeight: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Header height
                <input
                  type="number"
                  min="1"
                  value={editor.layout.header.height}
                  onChange={(event) =>
                    updateLayout({
                      header: {
                        ...editor.layout.header,
                        height: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Header font size
                <input
                  type="number"
                  min="1"
                  value={editor.layout.header.well_name.font_size}
                  onChange={(event) =>
                    updateLayout({
                      header: {
                        ...editor.layout.header,
                        well_name: {
                          ...editor.layout.header.well_name,
                          font_size: Number(event.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                Header font family
                <input
                  type="text"
                  value={editor.layout.header.well_name.font}
                  onChange={(event) =>
                    updateLayout({
                      header: {
                        ...editor.layout.header,
                        well_name: {
                          ...editor.layout.header.well_name,
                          font: event.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                Header text left
                <input
                  type="number"
                  value={editor.layout.header.well_name.location.left}
                  onChange={(event) =>
                    updateLayout({
                      header: {
                        ...editor.layout.header,
                        well_name: {
                          ...editor.layout.header.well_name,
                          location: {
                            ...editor.layout.header.well_name.location,
                            left: Number(event.target.value),
                          },
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                Header text top
                <input
                  type="number"
                  value={editor.layout.header.well_name.location.top}
                  onChange={(event) =>
                    updateLayout({
                      header: {
                        ...editor.layout.header,
                        well_name: {
                          ...editor.layout.header.well_name,
                          location: {
                            ...editor.layout.header.well_name.location,
                            top: Number(event.target.value),
                          },
                        },
                      },
                    })
                  }
                />
              </label>
            </div>
          </section>

          <div className="tracks-heading">
            <h3>Tracks and logs</h3>
            <button className="secondary-button" onClick={addTrack}>
              Add track
            </button>
          </div>
          <div className="track-editors">
            {editor.layout.tracks.map((track, trackIndex) => (
              <section
                className={`track-editor${selectedTrackIndex === trackIndex ? " selected" : ""}`}
                key={trackIndex}
                onClick={() => setSelectedTrackIndex(trackIndex)}
                onFocus={() => setSelectedTrackIndex(trackIndex)}
                tabIndex={0}
                aria-label={`Track ${trackIndex + 1}`}
                aria-current={
                  selectedTrackIndex === trackIndex ? "true" : undefined
                }
              >
                <div className="track-heading">
                  <h4>Track {trackIndex + 1}</h4>
                  <div className="track-actions">
                    <button
                      className="text-button"
                      onClick={() => moveTrack(trackIndex, -1)}
                      disabled={trackIndex === 0}
                      aria-label={`Move track ${trackIndex + 1} left`}
                    >
                      Move left
                    </button>
                    <button
                      className="text-button"
                      onClick={() => moveTrack(trackIndex, 1)}
                      disabled={trackIndex === editor.layout.tracks.length - 1}
                      aria-label={`Move track ${trackIndex + 1} right`}
                    >
                      Move right
                    </button>
                    <button
                      className="text-button remove-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeTrack(trackIndex);
                      }}
                      aria-label={`Remove track ${trackIndex + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="field-grid">
                  <label>
                    Track width
                    <input
                      type="number"
                      min="1"
                      value={track.width}
                      onChange={(event) =>
                        updateTrack(trackIndex, {
                          width: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Track scale
                    <select
                      value={track.scale}
                      onChange={(event) =>
                        updateTrack(trackIndex, {
                          scale: event.target.value as TrackConfig["scale"],
                        })
                      }
                    >
                      <option value="linear">Linear</option>
                      <option value="logarithmic">Logarithmic</option>
                    </select>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={track.showGrid ?? false}
                      onChange={(event) =>
                        updateTrack(trackIndex, {
                          showGrid: event.target.checked,
                        })
                      }
                    />
                    Show track grid
                  </label>
                </div>

                <div className="logs-heading">
                  <h5>Logs</h5>
                  <button
                    className="text-button"
                    onClick={() => addLog(trackIndex)}
                  >
                    + Add log
                  </button>
                </div>
                {track.logs.map((log, logIndex) => (
                  <div
                    className={`log-editor${selectedLogName === getLogName(log) ? " selected" : ""}`}
                    key={logIndex}
                    onClick={() => {
                      setSelectedTrackIndex(trackIndex);
                      setSelectedLogName(getLogName(log));
                    }}
                    onFocus={() => {
                      setSelectedTrackIndex(trackIndex);
                      setSelectedLogName(getLogName(log));
                    }}
                    tabIndex={0}
                    aria-label={`Edit log ${getLogName(log)}`}
                    aria-current={
                      selectedLogName === getLogName(log) ? "true" : undefined
                    }
                  >
                    <div className="log-heading">
                      <span>{getLogName(log)}</span>
                      <button
                        className="text-button remove-button"
                        onClick={() => removeLog(trackIndex, logIndex)}
                        aria-label={`Remove ${getLogName(log)}`}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="field-grid log-fields">
                      <label>
                        Name
                        <input
                          type="text"
                          value={getLogName(log)}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Line color
                        <input
                          className="color-input"
                          type="color"
                          value={String(log.color)}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              color: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Minimum
                        <input
                          type="number"
                          value={log.min}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              min: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Maximum
                        <input
                          type="number"
                          value={log.max}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              max: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Line weight
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={log.weight}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              weight: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={log.wrap}
                          onChange={(event) =>
                            updateLog(trackIndex, logIndex, {
                              wrap: event.target.checked,
                            })
                          }
                        />
                        Wrap values above maximum
                      </label>
                    </div>
                    <div className="log-shading-editors">
                      {renderShadingEditor(
                        track,
                        trackIndex,
                        log,
                        logIndex,
                        "left",
                      )}
                      {renderShadingEditor(
                        track,
                        trackIndex,
                        log,
                        logIndex,
                        "right",
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {editor.layout.tracks.length === 0 && (
              <p className="empty-state">Add a track to start building a layout.</p>
            )}
          </div>
        </aside>

        <section className="preview-column" aria-label="Layout preview">
          <div className="preview-heading">
            <div>
              <p className="section-eyebrow">Live preview</p>
              <h2>Composite log</h2>
            </div>
            <span className="preview-count">
              {layout.tracks.length} tracks · {logCount} logs
            </span>
          </div>
          <div className="track-selection-bar">
            <p aria-live="polite">
              {selectedTrackIndex === null
                ? "Select a track in the preview or settings to remove it."
                : selectedLogName
                  ? `Log ${selectedLogName} selected. Press Delete or Backspace to remove it.`
                  : `Track ${selectedTrackIndex + 1} selected. Press Delete or Backspace to remove it.`}
            </p>
            <button
              className="text-button remove-button"
              onClick={() => {
                if (selectedTrackIndex !== null) {
                  removeTrack(selectedTrackIndex);
                }
              }}
              disabled={selectedTrackIndex === null}
            >
              Delete selected track
            </button>
          </div>
          {editError && <p className="editor-error">{editError}</p>}
          {layoutError && <p className="editor-error">{layoutError}</p>}
          <div className="log-card" aria-label="Composite wireline log">
            <div className="log-scroll">
              <div
                ref={logContainerRef}
                className="log-container"
                onClick={(event) => selectLogFromTarget(event.target)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    selectLogFromTarget(event.target);
                  }
                }}
              />
            </div>
            <p className="caption">
              Generated sample data · Depth in {layout.depthUnits}. Drag track
              headers to reorder; drag chart borders to resize.
            </p>
          </div>

          <details className="json-panel">
            <summary>View layout JSON</summary>
            <pre>{layoutJson}</pre>
          </details>
        </section>
      </div>
    </main>
  );
}

export default App;
