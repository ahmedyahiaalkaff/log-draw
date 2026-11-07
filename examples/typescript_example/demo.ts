import { CompositeLog, type LogData, type LayoutConfig } from "../../src/log_draw";
import { Las } from "las-js";

function isLogData(value: unknown): value is LogData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.depth) &&
    data.depth.every((entry: unknown) => typeof entry === "number" && Number.isFinite(entry)) &&
    Array.isArray(data.gr) &&
    data.gr.every((entry: unknown) => typeof entry === "number" && Number.isFinite(entry))
  );
}

const myLas = new Las("../../data/25_5-3.las");
const grData = (await myLas.column("GR")).map(Number);
const bsData = (await myLas.column("BS")).map(Number);
const caliData = (await myLas.column("CALI")).map(Number);
const depthData = (await myLas.column("DEPT")).map(Number);
const redepData = (await myLas.column("RDEP")).map(Number);
const curve = await myLas.curveParams()
const depthUnits = curve.DEPT.unit // 'Neutron Porosity'

// console.log(`gr - min: ${Math.min(...grData.filter(x=>x!=-999.25))}, max: ${Math.max(...grData)}`);
// console.log("grdata", grData.filter(x=>x!=-999.25));
// console.log(`rdep - min: ${Math.min(...redepData.filter(x=>x!=-999.25))}, max: ${Math.max(...redepData)}`);
const logHeaders = ["DEPTH", "GR", "BS", "CALI", "RDEP"];
const logContainer = document.getElementById("log-container");
if (!logContainer) {
  throw new Error('Missing element with id "log-container".');
}

const response = await fetch("../../data/gr.json");
if (!response.ok) {
  throw new Error(`Failed to load gr.json: ${response.status} ${response.statusText}`);
}
const payload: unknown = await response.json();
if (!isLogData(payload)) {
  throw new Error("gr.json must contain numeric depth and gr arrays.");
}
const data = payload;

const layout1: LayoutConfig = {
  width: 500,
  scale: 400,
  depthUnits: depthUnits=='m'?'m':'ft',
  header: {
    well_name: {
      font: "arial",
      font_size: 10,
      location: {
        left: 10,
        top: 10,
      },
    },
    logo: "none",
    height: 150,
  },
  tracks: [{
    logs: [
      {
        name: "GR",
        aliases: ["gr"],
        color: "black",
        weight: 1,
        min: 0,
        max: 100,
        wrap: false,
      },
      {
        name: "BS",
        aliases: ["bs"],
        color: "blue",
        weight: 1,
        min: 5,
        max: 15,
        wrap: false,
      },
      {
        name: "CALI",
        aliases: ["cali"],
        color: "green",
        weight: 1,
        min: 5,
        max: 15,
        wrap:false,
      },
    ],
    scale: 'linear',
    width: 100,
  },
  {
    logs: [{
      name: "RDEP",
      aliases: ["LLD"],
      color: "red",
      weight: 1,
      min: 0.2,
      max: 100,
      wrap: false,
    }],
    scale: 'linear',
    width: 100,
  }
],
};


const compositeLog = new CompositeLog(logContainer, layout1, logHeaders, {
  GR: grData,
  BS: bsData,
  CALI: caliData,
  depth: depthData,
  RDEP: redepData,
});
// compositeLog.addTrack().addLog({ depth: depthData, gr: grData });
// compositeLog.addTrack().addLog(data);
compositeLog.draw();
