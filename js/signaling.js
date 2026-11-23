import { state } from "./state.js";
import { generateShortId } from "./utils.js";
import { saveActiveSession } from "./session.js";
import { logRadio, updateConnectionStatus } from "./ui.js";
import { optimizeOpusSDP } from "./audio.js";
import { activateSandboxMeshFallback } from "./local-mesh.js";
import { reconnectMissingPeers } from "./maintenance.js";
import { connectToRider, setupDataConnection, setupMediaCall } from "./peers.js";

function buildIceServersConfig() {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
  const customUrl = document.getElementById("turn-url-input").value.trim();
  const customUser = document.getElementById("turn-user-input").value.trim();
  const customPass = document.getElementById("turn-pass-input").value.trim();

  if (customUrl) {
    servers.unshift({
      urls: customUrl,
      username: customUser,
      credential: customPass,
    });

    try {
      localStorage.setItem("motomesh_turn_url", customUrl);
      localStorage.setItem("motomesh_turn_user", customUser);
      localStorage.setItem("motomesh_turn_pass", customPass);
    } catch (e) {}
  }

  return servers;
}

export function initPeerNetwork(preferredId = null) {
  if (!state.active) return;

  const desiredId = preferredId || state.myId || generateShortId();
  const iceServers = buildIceServersConfig();

  if (typeof Peer === "undefined") {
    activateSandboxMeshFallback(desiredId);
    return;
  }

  try {
    state.peer = new Peer(desiredId, {
      debug: 0,
      config: {
        iceServers,
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 6,
      },
    });
  } catch (secErr) {
    activateSandboxMeshFallback(desiredId);
    return;
  }

  state.peer.on("open", (id) => {
    state.myId = id;
    saveActiveSession();
    document.getElementById("my-peer-id").textContent = id;
    updateConnectionStatus("Online (STUN+TURN)", "bg-emerald-500");
    logRadio(`[NET] Terdaftar di jaringan sebagai ${id}`, "text-emerald-400");

    if (state.savedPeers.size > 0) {
      logRadio(
        `[SYNC] Menyambung ulang ke ${state.savedPeers.size} rekan rombongan...`,
        "text-blue-400",
      );
      state.savedPeers.forEach((peerId) => {
        if (peerId !== state.myId && !state.connections.has(peerId)) {
          connectToRider(peerId, true);
        }
      });
      reconnectMissingPeers();
    }
  });

  state.peer.on("connection", (conn) => {
    setupDataConnection(conn);
  });

  state.peer.on("call", (call) => {
    if (state.processedStream) {
      call.answer(state.processedStream, {
        sdpTransform: (sdp) => optimizeOpusSDP(sdp, state.bitrate),
      });
      setupMediaCall(call);
    }
  });

  state.peer.on("disconnected", () => {
    if (!state.active || state.leaving || state.sandboxMode) return;

    updateConnectionStatus("Sinyal Terputus - Reconnect...", "bg-red-500 animate-ping");
    logRadio("[WARN] Koneksi signaling terputus. Menyambung ulang...", "text-amber-400");
    setTimeout(() => {
      if (state.peer && !state.peer.destroyed) {
        state.peer.reconnect();
      }
    }, 2000);
  });

  state.peer.on("error", (err) => {
    if (!state.active) return;

    if (err.type === "unavailable-id") {
      state.peer.destroy();
      initPeerNetwork(generateShortId());
    } else if (
      err.name === "SecurityError" ||
      err.type === "network" ||
      err.type === "server-error" ||
      err.type === "socket-error"
    ) {
      activateSandboxMeshFallback(desiredId);
    } else if (err.type === "peer-unavailable") {
      const peerId = err.message?.match(/peer (\S+)$/)?.[1];

      // Percobaan ulang berjalan otomatis; cukup catat kegagalan pertama
      if (!peerId || (state.dials.get(peerId)?.attempts ?? 0) <= 1) {
        logRadio(
          `[WARN] ${peerId ?? "Rekan"} belum online / di luar jangkauan.`,
          "text-amber-400",
        );
      }
    } else {
      logRadio(`[NET-ERR] ${err.type}: ${err.message}`, "text-red-400");
    }
  });
}
