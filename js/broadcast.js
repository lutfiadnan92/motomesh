import { state } from "./state.js";
import { logRadio } from "./ui.js";

export function sendToPeer(peerId, info, payload) {
  if (info.isLocalBus && state.localBus) {
    state.localBus.postMessage({
      type: "LOCAL_PAYLOAD",
      sender: state.myId,
      target: peerId,
      payload,
    });
  } else if (info.dataConn?.open) {
    info.dataConn.send(payload);
  }
}

export function broadcastPayload(payload) {
  state.connections.forEach((info, peerId) => sendToPeer(peerId, info, payload));
}

export function flushOfflineQueue() {
  if (state.offlineQueue.length === 0) return;

  while (state.offlineQueue.length > 0) {
    broadcastPayload(state.offlineQueue.shift());
  }

  logRadio("[SYNC] Antrean sinyal tertunda berhasil dikirim.", "text-emerald-400");
}
