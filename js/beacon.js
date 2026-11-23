import { state } from "./state.js";
import { playToneBeep } from "./audio.js";
import { broadcastPayload } from "./broadcast.js";
import { logRadio, showToast } from "./ui.js";

export function sendTacticalBeacon(code, message) {
  const isSos = code === "SOS";
  const payload = {
    type: "BEACON",
    code,
    msg: message,
    sender: state.callsign,
    ts: Date.now(),
  };

  playToneBeep(isSos ? 1200 : 750, 0.12, "triangle");
  logRadio(`[TX-BEACON] ${message}`, isSos ? "text-red-400 font-bold" : "text-amber-400");
  showToast(`Terkirim: ${message}`, isSos ? "alert" : "success");

  if (state.connections.size === 0) {
    state.offlineQueue.push(payload);
    logRadio(
      "[QUEUE] Sinyal disimpan, otomatis dikirim saat rekan terhubung.",
      "text-gray-500",
    );
  } else {
    broadcastPayload(payload);
  }
}
