import { HEARTBEAT_INTERVAL_MS, PEER_TIMEOUT_MS, RECONNECT_TICK_MS } from "./config.js";
import { state } from "./state.js";
import { sendToPeer } from "./broadcast.js";
import { closePeerConnections, dialPeer, getDial, scheduleRetry } from "./peers.js";
import { logRadio, renderPeersList } from "./ui.js";

// Rekan yang diam melewati batas waktu ditutup lalu dijadwalkan sambung ulang
function checkHeartbeat() {
  const now = Date.now();
  const timedOut = [];

  state.connections.forEach((info, peerId) => {
    sendToPeer(peerId, info, { type: "PING", ts: now });

    if (now - info.lastPong > PEER_TIMEOUT_MS) timedOut.push(peerId);
  });

  timedOut.forEach((peerId) => {
    const name = state.connections.get(peerId).callsign;

    logRadio(`[TIMEOUT] Sinyal ${name} hilang. Mencoba menyambung ulang...`, "text-red-400");
    closePeerConnections(peerId);
    scheduleRetry(peerId);
  });

  if (timedOut.length > 0) renderPeersList();
}

// Dial rekan tersimpan yang belum tersambung, sesuai jadwal masing-masing
export function reconnectMissingPeers() {
  const signalingReady = state.sandboxMode || state.peer?.open;

  if (!state.active || !signalingReady) return;

  const now = Date.now();

  state.savedPeers.forEach((peerId) => {
    if (state.connections.has(peerId) || now < getDial(peerId).nextAt) return;

    dialPeer(peerId);
  });
}

export function startPeerMaintenance() {
  stopPeerMaintenance();
  state.heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL_MS);
  state.reconnectTimer = setInterval(reconnectMissingPeers, RECONNECT_TICK_MS);
}

export function stopPeerMaintenance() {
  clearInterval(state.heartbeatTimer);
  clearInterval(state.reconnectTimer);
  state.heartbeatTimer = null;
  state.reconnectTimer = null;
}
