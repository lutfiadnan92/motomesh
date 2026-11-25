import { SAME_ID_RETRY_MS } from "./config.js";
import { state } from "./state.js";
import { generateShortId } from "./utils.js";
import { saveActiveSession } from "./session.js";
import { logRadio, updateConnectionStatus } from "./ui.js";
import { optimizeOpusSDP } from "./audio.js";
import { activateSandboxMeshFallback } from "./local-mesh.js";
import { reconnectMissingPeers } from "./maintenance.js";
import {
  connectToRider,
  releaseDial,
  releaseStaleDials,
  setupDataConnection,
  setupMediaCall,
} from "./peers.js";

const NETWORK_ERROR_TYPES = new Set(["network", "server-error", "socket-error"]);

let sameIdAttempts = 0;
let networkAttempts = 0;
let hasRegistered = false;
let sameIdTimer = null;

function clearSameIdTimer() {
  if (!sameIdTimer) return;

  clearTimeout(sameIdTimer);
  sameIdTimer = null;
}

function dropCurrentPeer() {
  const oldPeer = state.peer;

  state.peer = null;

  try {
    if (oldPeer && !oldPeer.destroyed) oldPeer.destroy();
  } catch (e) {}
}

export function resetSignalingState() {
  clearSameIdTimer();
  sameIdAttempts = 0;
  networkAttempts = 0;
  hasRegistered = false;
}

function retrySignaling(id) {
  dropCurrentPeer();

  if (!hasRegistered && networkAttempts >= SAME_ID_RETRY_MS.length) {
    networkAttempts = 0;
    activateSandboxMeshFallback(id);
    return;
  }

  const lastIndex = SAME_ID_RETRY_MS.length - 1;
  const waitMs = SAME_ID_RETRY_MS[Math.min(networkAttempts, lastIndex)];

  if (networkAttempts === 0 || networkAttempts === lastIndex) {
    logRadio(
      `[NET] Server signaling belum terjangkau. Mencoba lagi dalam ${waitMs / 1000} detik.`,
      "text-amber-400",
    );
  }

  networkAttempts = Math.min(networkAttempts + 1, lastIndex + 1);
  updateConnectionStatus("Sinyal Terputus - Reconnect...", "bg-red-500 animate-ping");
  clearSameIdTimer();
  sameIdTimer = setTimeout(() => {
    sameIdTimer = null;
    if (!state.active || state.sandboxMode) return;
    initPeerNetwork(id);
  }, waitMs);
}

function keepSameIdOrReplace(takenId) {
  dropCurrentPeer();

  const groupAlreadySaved = state.savedPeers.size > 0;

  if (!groupAlreadySaved || sameIdAttempts >= SAME_ID_RETRY_MS.length) {
    sameIdAttempts = 0;
    const newId = generateShortId();

    if (groupAlreadySaved) {
      logRadio(
        `[NET] ID berganti dari ${takenId} menjadi ${newId}. Bagikan ID baru ke rombongan.`,
        "text-amber-400",
      );
    }

    initPeerNetwork(newId);
    return;
  }

  const waitMs = SAME_ID_RETRY_MS[sameIdAttempts];

  sameIdAttempts += 1;
  logRadio(
    `[NET] ID ${takenId} masih tercatat di server. Mencoba lagi dalam ${waitMs / 1000} detik.`,
    "text-amber-400",
  );
  clearSameIdTimer();
  sameIdTimer = setTimeout(() => {
    sameIdTimer = null;
    if (!state.active) return;
    initPeerNetwork(takenId);
  }, waitMs);
}

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

  clearSameIdTimer();

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

  const peer = state.peer;

  peer.on("open", (id) => {
    if (state.peer !== peer) return;

    sameIdAttempts = 0;
    networkAttempts = 0;
    hasRegistered = true;
    state.myId = id;
    saveActiveSession();
    document.getElementById("my-peer-id").textContent = id;
    updateConnectionStatus("Online (STUN+TURN)", "bg-emerald-500");
    logRadio(`[NET] Terdaftar di jaringan sebagai ${id}`, "text-emerald-400");

    releaseStaleDials();

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

  peer.on("connection", (conn) => {
    if (state.peer !== peer) return;
    setupDataConnection(conn);
  });

  peer.on("call", (call) => {
    if (state.peer !== peer || !state.processedStream) return;

    call.answer(state.processedStream, {
      sdpTransform: (sdp) => optimizeOpusSDP(sdp, state.bitrate),
    });
    setupMediaCall(call);
  });

  peer.on("disconnected", () => {
    if (!state.active || state.leaving || state.sandboxMode) return;
    if (state.peer !== peer) return;

    updateConnectionStatus("Sinyal Terputus - Reconnect...", "bg-red-500 animate-ping");
    logRadio("[WARN] Koneksi signaling terputus. Menyambung ulang...", "text-amber-400");
    setTimeout(() => {
      if (state.peer === peer && !peer.destroyed) peer.reconnect();
    }, 2000);
  });

  peer.on("error", (err) => {
    if (!state.active || state.peer !== peer) return;

    if (err.type === "unavailable-id") {
      keepSameIdOrReplace(desiredId);
    } else if (err.name === "SecurityError") {
      activateSandboxMeshFallback(desiredId);
    } else if (NETWORK_ERROR_TYPES.has(err.type)) {
      retrySignaling(desiredId);
    } else if (err.type === "peer-unavailable") {
      const peerId = err.message?.match(/peer (\S+)$/)?.[1];

      if (peerId) releaseDial(peerId);
    } else {
      logRadio(`[NET-ERR] ${err.type}: ${err.message}`, "text-red-400");
    }
  });
}
