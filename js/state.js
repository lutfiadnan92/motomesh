import { DEFAULT_BITRATE } from "./config.js";

export const state = {
  peer: null,
  active: false, // false setelah Leave; menghentikan callback async yang datang terlambat
  myId: "",
  callsign: "RIDER",
  bitrate: DEFAULT_BITRATE,
  rawStream: null,
  processedStream: null,
  audioCtx: null,
  gainNode: null,
  filterNode: null,
  windFilterEnabled: true,
  isTransmitting: false,
  latchMode: true,
  sandboxMode: false,
  localBus: null,
  wakeLock: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  leaving: false,
  connections: new Map(),
  // peerId -> { attempts, nextAt, dataConn, mediaCall }: percobaan dial yang belum tersambung
  dials: new Map(),
  savedPeers: new Set(),
  offlineQueue: [],
  outputDeviceId: localStorage.getItem("motomesh_output_device") || "",
};
