import { DEFAULT_BITRATE } from "./config.js";
import { state } from "./state.js";
import { generateShortId } from "./utils.js";
import { clearActiveSession, getSavedSession } from "./session.js";
import { logRadio, renderPeersList, showToast, updateConnectionStatus } from "./ui.js";
import { initAudioPipeline, setTransmissionState, stopAudioDeviceWatch } from "./audio.js";
import { requestScreenWakeLock } from "./wakelock.js";
import { initPeerNetwork, resetSignalingState } from "./signaling.js";
import { startPeerMaintenance, stopPeerMaintenance } from "./maintenance.js";
import { abandonDial } from "./peers.js";

// Memulihkan sesi yang tersimpan setelah halaman dimuat ulang
export async function resumeSession() {
  const saved = getSavedSession();

  if (!saved) return;

  state.active = true;
  state.myId = saved.myId || generateShortId();
  state.callsign = saved.callsign || "RIDER";
  state.bitrate = saved.bitrate || DEFAULT_BITRATE;
  state.windFilterEnabled = saved.windFilterEnabled ?? true;
  state.latchMode = saved.latchMode ?? true;

  if (Array.isArray(saved.peers)) {
    saved.peers.forEach((peerId) => state.savedPeers.add(peerId));
    renderPeersList();
  }

  document.getElementById("my-callsign").textContent = state.callsign;
  document.getElementById("network-mode-badge").textContent =
    `${state.bitrate / 1000}K FEC`;

  await requestScreenWakeLock();
  await initAudioPipeline();

  // Leave bisa terjadi selagi menunggu izin mikrofon
  if (!state.active) return;

  initPeerNetwork(state.myId);
  startPeerMaintenance();
  logRadio(
    `[RESUME] Sesi dipulihkan otomatis setelah refresh (${state.callsign})`,
    "text-emerald-400",
  );
  showToast("Sesi komunikasi dipulihkan otomatis!", "success");
}

export function leaveCommunicationSession() {
  if (state.leaving) return;

  state.leaving = true;
  state.active = false;
  clearActiveSession();

  try {
    try {
      setTransmissionState(false);
    } catch (e) {}

    stopPeerMaintenance();
    stopAudioDeviceWatch();
    resetSignalingState();

    for (const [peerId, info] of Array.from(state.connections.entries())) {
      try {
        if (info.isLocalBus && state.localBus) {
          state.localBus.postMessage({
            type: "LOCAL_LEAVE",
            sender: state.myId,
            target: peerId,
          });
        } else if (info.dataConn) {
          if (info.dataConn.open) {
            try {
              info.dataConn.send({ type: "LEAVE" });
            } catch (e) {}
          }
          try {
            info.dataConn.close();
          } catch (e) {}
        }
      } catch (e) {}

      try {
        if (info.mediaCall) {
          const pc = info.mediaCall.peerConnection;
          if (pc && pc.__motoMeshRouteCheck) {
            clearTimeout(pc.__motoMeshRouteCheck);
            pc.__motoMeshRouteCheck = null;
          }
          info.mediaCall.close();
        }
      } catch (e) {}
    }

    state.dials.forEach(abandonDial);
    state.dials.clear();
    state.connections.clear();
    state.savedPeers.clear();
    state.offlineQueue = [];

    for (const stream of [state.rawStream, state.processedStream]) {
      try {
        stream?.getTracks?.().forEach((track) => track.stop());
      } catch (e) {}
    }

    state.rawStream = null;
    state.processedStream = null;
    state.sourceNode = null;
    state.gainNode = null;
    state.filterNode = null;

    if (state.audioCtx) {
      try {
        const closingContext = state.audioCtx;
        if (closingContext.state !== "closed") {
          Promise.resolve(closingContext.close()).catch(() => {});
        }
      } catch (e) {}
      state.audioCtx = null;
    }

    if (state.localBus) {
      try {
        state.localBus.onmessage = null;
        state.localBus.close();
      } catch (e) {}
      state.localBus = null;
    }

    if (state.peer) {
      const peer = state.peer;
      state.peer = null;
      try {
        if (!peer.destroyed) peer.destroy();
      } catch (e) {}
    }

    if (state.wakeLock) {
      try {
        Promise.resolve(state.wakeLock.release()).catch(() => {});
      } catch (e) {}
      state.wakeLock = null;
    }

    state.sandboxMode = false;
    state.myId = "";
    state.isTransmitting = false;

    document.getElementById("remote-audio-container")?.replaceChildren();

    const peerIdElement = document.getElementById("my-peer-id");
    if (peerIdElement) peerIdElement.textContent = "------";

    const callsignElement = document.getElementById("my-callsign");
    if (callsignElement) callsignElement.textContent = "BELUM AKTIF";

    const radioLog = document.getElementById("radio-log");
    if (radioLog) {
      radioLog.textContent = "";
      const row = document.createElement("div");
      row.className = "text-gray-500";
      row.textContent = "[SYS] Anda telah keluar dari sesi komunikasi.";
      radioLog.appendChild(row);
    }

    try {
      renderPeersList();
    } catch (e) {}

    updateConnectionStatus("Radio tidak aktif", "bg-gray-500");
  } catch (error) {
    console.error("[MotoMesh] Kesalahan saat Leave:", error);
    logRadio("[WARN] Sesi dihentikan dengan pembersihan darurat.", "text-amber-400");
  } finally {
    state.leaving = false;
    showToast("Anda telah keluar dari komunikasi.");
  }
}
