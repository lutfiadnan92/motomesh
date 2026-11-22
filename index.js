const SESSION_KEY = "motomesh_active_session";
const state = {
  peer: null,
  myId: "",
  callsign: "RIDER",
  bitrate: 8000,
  rawStream: null,
  processedStream: null,
  audioCtx: null,
  gainNode: null,
  filterNode: null,
  windFilterEnabled: true,
  isTransmitting: false,
  latchMode: false,
  sandboxMode: false,
  localBus: null,
  wakeLock: null,
  heartbeatTimer: null,
  connections: new Map(),
  savedPeers: new Set(),
  offlineQueue: [],
};

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

async function requestScreenWakeLock() {
  const badge = document.getElementById("wakelock-badge");

  if ("wakeLock" in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      badge.textContent = "LAYAR: AKTIF";
      badge.className =
        "text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30";
      state.wakeLock.addEventListener("release", () => {
        badge.textContent = "LAYAR: NORMAL";
        badge.className =
          "text-[10px] font-mono px-2 py-1 rounded-lg bg-asphalt-800 text-gray-400 border border-asphalt-700";
      });
    } catch (err) {
      badge.textContent = "LAYAR: AUTO";
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && getSavedSession()) {
    requestScreenWakeLock();
  }
});

function saveActiveSession() {
  try {
    const sessionData = {
      active: true,
      myId: state.myId,
      callsign: state.callsign,
      bitrate: state.bitrate,
      windFilterEnabled: state.windFilterEnabled,
      latchMode: state.latchMode,
      peers: Array.from(state.savedPeers),
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
  } catch (e) {}
}

function getSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    return parsed && parsed.active ? parsed : null;
  } catch (e) {
    return null;
  }
}

function clearActiveSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const savedUrl = localStorage.getItem("motomesh_turn_url");
    const savedUser = localStorage.getItem("motomesh_turn_user");
    const savedPass = localStorage.getItem("motomesh_turn_pass");
    const savedName = localStorage.getItem("motomesh_callsign");

    if (savedName) document.getElementById("rider-name-input").value = savedName;

    if (savedUrl) {
      document.getElementById("turn-url-input").value = savedUrl;
      document.getElementById("turn-user-input").value = savedUser || "";
      document.getElementById("turn-pass-input").value = savedPass || "";
    }
  } catch (e) {}

  const activeSession = getSavedSession();

  if (activeSession) {
    state.myId = activeSession.myId || generateShortId();
    state.callsign = activeSession.callsign || "RIDER";
    state.bitrate = activeSession.bitrate || 8000;
    state.windFilterEnabled =
      activeSession.windFilterEnabled !== undefined
        ? activeSession.windFilterEnabled
        : true;
    state.latchMode = !!activeSession.latchMode;

    if (Array.isArray(activeSession.peers)) {
      activeSession.peers.forEach((p) => state.savedPeers.add(p));
    }

    document.getElementById("rider-name-input").value = state.callsign;
    document.getElementById("bandwidth-profile").value = String(state.bitrate);
    document.getElementById("network-mode-badge").textContent =
      `${state.bitrate / 1000}K FEC`;
    document.getElementById("setup-overlay").classList.add("hidden");

    const windBtn = document.getElementById("toggle-wind-filter");
    windBtn.textContent = `ANGIN: ${state.windFilterEnabled ? "ON" : "OFF"}`;
    windBtn.className = state.windFilterEnabled
      ? "text-[10px] font-mono px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 transition"
      : "text-[10px] font-mono px-2 py-1 rounded-lg bg-asphalt-800 text-gray-400 border border-asphalt-700 transition";

    if (state.latchMode) {
      document.getElementById("mode-latch-btn").className =
        "px-3 py-1 rounded-lg text-xs font-bold bg-brand-orange text-white transition";
      document.getElementById("mode-ptt-btn").className =
        "px-3 py-1 rounded-lg text-xs font-bold text-gray-400 hover:text-white transition";
    }

    await requestScreenWakeLock();
    await initAudioPipeline();

    if (state.filterNode) {
      state.filterNode.frequency.value = state.windFilterEnabled ? 300 : 20;
    }

    initPeerNetwork(state.myId);
    startHeartbeatMonitor();
    logRadio(
      `[RESUME] Sesi dipulihkan otomatis setelah refresh (${state.callsign})`,
      "text-emerald-400",
    );
    showToast("Sesi komunikasi dipulihkan otomatis!", "success");
  }
});

function generateShortId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let res = "MT-";

  for (let i = 0; i < 4; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return res;
}

function playToneBeep(freq = 880, duration = 0.08, type = "sine") {
  if (!state.audioCtx) return;

  try {
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();

    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, state.audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, state.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start();
    osc.stop(state.audioCtx.currentTime + duration);
  } catch (e) {}
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  const colors = {
    info: "bg-asphalt-800 border-asphalt-700 text-white",
    alert: "bg-red-950/95 border-red-500 text-red-100 font-bold",
    success: "bg-emerald-950/95 border-emerald-500 text-emerald-100",
  };
  el.className = `${colors[type] || colors.info} border px-4 py-2.5 rounded-xl shadow-xl text-xs text-center transition-opacity duration-300`;
  el.textContent = msg;

  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function logRadio(text, colorClass = "text-gray-300") {
  const logEl = document.getElementById("radio-log");
  const time = new Date().toLocaleTimeString("id-ID", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const row = document.createElement("div");
  row.className = `${colorClass} leading-relaxed`;
  row.textContent = `[${time}] ${text}`;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;

  if (logEl.children.length > 50) {
    logEl.removeChild(logEl.firstChild);
  }
}

async function initAudioPipeline() {
  try {
    state.rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      },
      video: false,
    });
  } catch (err) {
    logRadio(
      "[WARN] Mikrofon tidak tersedia, menggunakan audio virtual.",
      "text-amber-400",
    );

    const dummyCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = dummyCtx.createMediaStreamDestination();
    state.rawStream = dest.stream;
  }

  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = state.audioCtx.createMediaStreamSource(state.rawStream);
  const compressor = state.audioCtx.createDynamicsCompressor();
  const destination = state.audioCtx.createMediaStreamDestination();

  state.filterNode = state.audioCtx.createBiquadFilter();
  state.filterNode.type = "highpass";
  state.filterNode.frequency.value = 300;
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = 0;

  source.connect(state.filterNode);
  state.filterNode.connect(compressor);
  compressor.connect(state.gainNode);
  state.gainNode.connect(destination);

  state.processedStream = destination.stream;

  setTransmissionState(false);
}

function optimizeOpusSDP(sdp, maxBitrate) {
  return sdp.replace(/a=fmtp:111 (.*)/g, (match, params) => {
    return `a=fmtp:111 ${params};useinbandfec=1;usedtx=1;maxaveragebitrate=${maxBitrate};stereo=0;cbr=0`;
  });
}

function inspectConnectionRoute(pc, remoteId) {
  if (!pc || typeof pc.getStats !== "function") return;

  setTimeout(async () => {
    try {
      const stats = await pc.getStats();
      let activePair = null;
      const candidates = new Map();

      stats.forEach((report) => {
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(report.id, report);
        }

        if (report.type === "candidate-pair" && report.state === "succeeded") {
          activePair = report;
        }
      });

      if (activePair) {
        const localCand = candidates.get(activePair.localCandidateId);
        const remoteCand = candidates.get(activePair.remoteCandidateId);
        const isRelayed =
          (localCand && localCand.candidateType === "relay") ||
          (remoteCand && remoteCand.candidateType === "relay");
        const routeLabel = isRelayed ? "TURN RELAY" : "P2P DIRECT";
        const peerInfo = state.connections.get(remoteId);

        if (peerInfo && peerInfo.routeType !== routeLabel) {
          peerInfo.routeType = routeLabel;
          renderPeersList();
          logRadio(
            `[ROUTE] Jalur ke ${peerInfo.callsign}: ${routeLabel}`,
            isRelayed ? "text-amber-400" : "text-emerald-400",
          );
        }
      }
    } catch (e) {}
  }, 1500);
}

function initPeerNetwork(preferredId = null) {
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
        iceServers: iceServers,
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
    if (state.sandboxMode || !getSavedSession()) return;

    updateConnectionStatus("Sinyal Terputus - Reconnect...", "bg-red-500 animate-ping");
    logRadio("[WARN] Koneksi signaling terputus. Menyambung ulang...", "text-amber-400");
    setTimeout(() => {
      if (state.peer && !state.peer.destroyed) {
        state.peer.reconnect();
      }
    }, 2000);
  });

  state.peer.on("error", (err) => {
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
      logRadio(`[WARN] Rekan belum online / di luar jangkauan.`, "text-amber-400");
    } else {
      logRadio(`[NET-ERR] ${err.type}: ${err.message}`, "text-red-400");
    }
  });
}

// Fallback Mode saat berada di sandbox pratinjau
function activateSandboxMeshFallback(id) {
  if (state.sandboxMode) return;

  state.sandboxMode = true;
  state.myId = id;
  saveActiveSession();
  document.getElementById("my-peer-id").textContent = id;
  updateConnectionStatus("Mode Lokal / Multi-Tab", "bg-amber-400");
  logRadio(
    `[SYS] WebSocket dibatasi sandbox. Beralih ke Local Mesh (${id}).`,
    "text-amber-400",
  );

  state.localBus = new BroadcastChannel("motomesh_local_bus");
  state.localBus.onmessage = async (ev) => {
    const msg = ev.data;

    if (!msg || (msg.target !== state.myId && msg.target !== "*")) return;

    if (msg.sender === state.myId) return;

    if (msg.type === "LOCAL_CONNECT_REQ") {
      registerLocalPeer(msg.sender, msg.callsign);
      state.localBus.postMessage({
        type: "LOCAL_CONNECT_ACK",
        sender: state.myId,
        target: msg.sender,
        callsign: state.callsign,
      });
    } else if (msg.type === "LOCAL_CONNECT_ACK") {
      registerLocalPeer(msg.sender, msg.callsign);
    } else if (msg.type === "LOCAL_LEAVE") {
      handlePeerLeft(msg.sender);
    } else if (msg.type === "LOCAL_PAYLOAD") {
      handleIncomingData(msg.sender, msg.payload);
    } else if (msg.type === "LOCAL_AUDIO_CHUNK" && msg.pcm) {
      playIncomingLocalAudio(msg.pcm);
    }
  };

  setupLocalAudioBridge();

  if (state.savedPeers.size > 0) {
    state.savedPeers.forEach((peerId) => {
      if (peerId !== state.myId) connectToRider(peerId, true);
    });
  }
}

function registerLocalPeer(remoteId, callsign) {
  state.savedPeers.add(remoteId);
  saveActiveSession();

  if (!state.connections.has(remoteId)) {
    state.connections.set(remoteId, {
      isLocalBus: true,
      callsign: callsign || remoteId,
      ping: 2,
      routeType: "LOCAL BUS",
      lastPong: Date.now(),
    });
    flushOfflineQueue();
    renderPeersList();
    logRadio(
      `[LINK] Terhubung dengan ${callsign || remoteId} (Local Mesh)`,
      "text-emerald-400",
    );
  }
}

function setupLocalAudioBridge() {
  if (!state.audioCtx || !state.gainNode) return;

  try {
    const scriptNode = state.audioCtx.createScriptProcessor(2048, 1, 1);

    state.gainNode.connect(scriptNode);
    scriptNode.connect(state.audioCtx.destination);
    scriptNode.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      out.fill(0);

      if (!state.isTransmitting || state.connections.size === 0 || !state.localBus)
        return;

      const input = e.inputBuffer.getChannelData(0);
      const quantized = new Int8Array(input.length);

      for (let i = 0; i < input.length; i++) {
        quantized[i] = Math.max(-127, Math.min(127, Math.round(input[i] * 127)));
      }

      state.localBus.postMessage({
        type: "LOCAL_AUDIO_CHUNK",
        sender: state.myId,
        target: "*",
        pcm: quantized,
      });
    };
  } catch (err) {}
}

function playIncomingLocalAudio(quantized) {
  if (!state.audioCtx) return;

  try {
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();

    const buffer = state.audioCtx.createBuffer(
      1,
      quantized.length,
      state.audioCtx.sampleRate,
    );
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < quantized.length; i++) {
      channel[i] = quantized[i] / 127;
    }

    const src = state.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(state.audioCtx.destination);
    src.start();
  } catch (e) {}
}

window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason &&
    (event.reason.name === "SecurityError" || String(event.reason).includes("WebSocket"))
  ) {
    event.preventDefault();
    activateSandboxMeshFallback(state.myId || generateShortId());
  }
});

function connectToRider(targetId, isAutoReconnect = false) {
  targetId = targetId.trim().toUpperCase();

  if (!targetId || targetId === state.myId) {
    if (!isAutoReconnect) showToast("ID tujuan tidak valid atau sama dengan ID Anda.");
    return;
  }

  if (state.connections.has(targetId)) {
    if (!isAutoReconnect) showToast(`Sudah terhubung dengan ${targetId}`);
    return;
  }

  state.savedPeers.add(targetId);
  saveActiveSession();
  logRadio(`[DIAL] Menghubungkan ke ${targetId}...`, "text-blue-400");

  if (state.sandboxMode && state.localBus) {
    state.localBus.postMessage({
      type: "LOCAL_CONNECT_REQ",
      sender: state.myId,
      target: targetId,
      callsign: state.callsign,
    });

    return;
  }

  if (!state.peer || state.peer.destroyed) return;

  const dataConn = state.peer.connect(targetId, {
    reliable: false,
    serialization: "json",
  });

  setupDataConnection(dataConn);

  if (state.processedStream) {
    const mediaCall = state.peer.call(targetId, state.processedStream, {
      sdpTransform: (sdp) => optimizeOpusSDP(sdp, state.bitrate),
    });

    setupMediaCall(mediaCall);
  }
}

function handlePeerLeft(remoteId) {
  const info = state.connections.get(remoteId);
  const name = info ? info.callsign : remoteId;
  const audioEl = document.getElementById(`audio-${remoteId}`);

  if (audioEl) audioEl.remove();

  state.connections.delete(remoteId);
  state.savedPeers.delete(remoteId);
  saveActiveSession();

  renderPeersList();
  logRadio(`[LEAVE] ${name} keluar dari sesi komunikasi.`, "text-amber-400");
  showToast(`${name} keluar dari komunikasi.`);
}

function setupDataConnection(conn) {
  const remoteId = conn.peer;

  conn.on("open", () => {
    state.savedPeers.add(remoteId);
    saveActiveSession();

    if (!state.connections.has(remoteId)) {
      state.connections.set(remoteId, {
        dataConn: conn,
        mediaCall: null,
        callsign: remoteId,
        ping: 0,
        routeType: "NEGOTIATING",
        lastPong: Date.now(),
      });
    } else {
      state.connections.get(remoteId).dataConn = conn;
    }

    const knownPeers = Array.from(state.connections.keys()).filter(
      (id) => id !== remoteId,
    );

    conn.send({
      type: "HELLO",
      callsign: state.callsign,
      peers: knownPeers,
    });

    inspectConnectionRoute(conn.peerConnection, remoteId);
    flushOfflineQueue();
    renderPeersList();
    logRadio(`[LINK] Terhubung dengan ${remoteId}`, "text-emerald-400");
  });

  conn.on("data", (data) => {
    handleIncomingData(remoteId, data);
  });

  conn.on("close", () => {
    if (state.connections.has(remoteId)) {
      logRadio(`[DROP] Koneksi ${remoteId} terputus sementara.`, "text-red-400");
      state.connections.delete(remoteId);
      renderPeersList();
    }
  });
}

function setupMediaCall(call) {
  const remoteId = call.peer;

  if (!state.connections.has(remoteId)) {
    state.connections.set(remoteId, {
      dataConn: null,
      mediaCall: call,
      callsign: remoteId,
      ping: 0,
      routeType: "NEGOTIATING",
      lastPong: Date.now(),
    });
  } else {
    state.connections.get(remoteId).mediaCall = call;
  }

  inspectConnectionRoute(call.peerConnection, remoteId);

  call.on("stream", (remoteStream) => {
    let audioEl = document.getElementById(`audio-${remoteId}`);

    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = `audio-${remoteId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      document.getElementById("remote-audio-container").appendChild(audioEl);
    }

    audioEl.srcObject = remoteStream;
    audioEl.play().catch(() => {
      logRadio("[AUDIO] Ketuk layar untuk mengaktifkan suara masuk.", "text-amber-400");
    });
  });

  call.on("close", () => {
    const audioEl = document.getElementById(`audio-${remoteId}`);
    if (audioEl) audioEl.remove();
  });
}

function setTransmissionState(active) {
  state.isTransmitting = active;
  const app = window.Alpine?.$data(document.body);

  if (app) app.isTransmitting = active;

  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }

  if (active) {
    if (state.gainNode) {
      state.gainNode.gain.setTargetAtTime(1.2, state.audioCtx.currentTime, 0.01);
    }

    if (state.rawStream) {
      state.rawStream.getAudioTracks().forEach((track) => (track.enabled = true));
    }

    playToneBeep(920, 0.06);
    broadcastPayload({ type: "PTT_STATE", talking: true });
  } else {
    if (state.gainNode && state.audioCtx) {
      state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.01);
    }

    if (state.rawStream) {
      state.rawStream.getAudioTracks().forEach((track) => (track.enabled = false));
    }

    broadcastPayload({ type: "PTT_STATE", talking: false });
  }
}

function sendTacticalBeacon(code, message) {
  const payload = {
    type: "BEACON",
    code: code,
    msg: message,
    sender: state.callsign,
    ts: Date.now(),
  };

  playToneBeep(code === "SOS" ? 1200 : 750, 0.12, "triangle");
  logRadio(
    `[TX-BEACON] ${message}`,
    code === "SOS" ? "text-red-400 font-bold" : "text-amber-400",
  );
  showToast(`Terkirim: ${message}`, code === "SOS" ? "alert" : "success");

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

function broadcastPayload(payload) {
  state.connections.forEach((info, peerId) => {
    if (info.isLocalBus && state.localBus) {
      state.localBus.postMessage({
        type: "LOCAL_PAYLOAD",
        sender: state.myId,
        target: peerId,
        payload: payload,
      });
    } else if (info.dataConn && info.dataConn.open) {
      info.dataConn.send(payload);
    }
  });
}

function flushOfflineQueue() {
  if (state.offlineQueue.length === 0) return;

  while (state.offlineQueue.length > 0) {
    const pkt = state.offlineQueue.shift();
    broadcastPayload(pkt);
  }

  logRadio("[SYNC] Antrean sinyal tertunda berhasil dikirim.", "text-emerald-400");
}

function handleIncomingData(remoteId, data) {
  const peerInfo = state.connections.get(remoteId);

  if (!peerInfo) return;

  if (data.type === "HELLO") {
    peerInfo.callsign = data.callsign || remoteId;
    renderPeersList();

    if (Array.isArray(data.peers)) {
      data.peers.forEach((otherId) => {
        if (otherId !== state.myId && !state.connections.has(otherId)) {
          connectToRider(otherId, true);
        }
      });
    }
  } else if (data.type === "PING") {
    const pong = { type: "PONG", ts: data.ts };

    if (peerInfo.isLocalBus && state.localBus) {
      state.localBus.postMessage({
        type: "LOCAL_PAYLOAD",
        sender: state.myId,
        target: remoteId,
        payload: pong,
      });
    } else if (peerInfo.dataConn && peerInfo.dataConn.open) {
      peerInfo.dataConn.send(pong);
    }
  } else if (data.type === "PONG") {
    peerInfo.ping = Math.max(1, Math.round((Date.now() - data.ts) / 2));
    peerInfo.lastPong = Date.now();
    renderPeersList();
  } else if (data.type === "BEACON") {
    playToneBeep(data.code === "SOS" ? 1320 : 880, 0.18, "square");

    if (navigator.vibrate) {
      navigator.vibrate(data.code === "SOS" ? [200, 100, 200] : [120]);
    }

    logRadio(
      `[RX-${data.sender}] ${data.msg}`,
      data.code === "SOS" ? "text-red-400 font-bold" : "text-amber-300",
    );
    showToast(`${data.sender}: ${data.msg}`, data.code === "SOS" ? "alert" : "info");
  } else if (data.type === "PTT_STATE") {
    peerInfo.isTalking = data.talking;
    renderPeersList();
  } else if (data.type === "LEAVE") {
    handlePeerLeft(remoteId);
  }
}

function leaveCommunicationSession() {
  setTransmissionState(false);

  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  state.connections.forEach((info, peerId) => {
    if (info.isLocalBus && state.localBus) {
      state.localBus.postMessage({
        type: "LOCAL_LEAVE",
        sender: state.myId,
        target: peerId,
      });
    } else if (info.dataConn && info.dataConn.open) {
      try {
        info.dataConn.send({ type: "LEAVE" });
      } catch (e) {}

      try {
        info.dataConn.close();
      } catch (e) {}
    }
    if (info.mediaCall) {
      try {
        info.mediaCall.close();
      } catch (e) {}
    }
  });

  state.connections.clear();
  state.savedPeers.clear();
  state.offlineQueue = [];
  clearActiveSession();

  if (state.rawStream) {
    state.rawStream.getTracks().forEach((t) => t.stop());
    state.rawStream = null;
  }

  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
  }

  if (state.localBus) {
    state.localBus.close();
    state.localBus = null;
  }

  if (state.peer && !state.peer.destroyed) {
    state.peer.destroy();
    state.peer = null;
  }

  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }

  state.sandboxMode = false;
  state.myId = "";
  document.getElementById("remote-audio-container").innerHTML = "";
  document.getElementById("my-peer-id").textContent = "------";
  document.getElementById("radio-log").innerHTML =
    '<div class="text-gray-500">[SYS] Anda telah keluar dari sesi komunikasi.</div>';
  renderPeersList();
  document.getElementById("leave-modal").classList.add("hidden");
  document.getElementById("setup-overlay").classList.remove("hidden");
  showToast("Anda telah keluar dari komunikasi.");
}

function startHeartbeatMonitor() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);

  state.heartbeatTimer = setInterval(() => {
    const now = Date.now();

    state.connections.forEach((info, peerId) => {
      if (info.isLocalBus && state.localBus) {
        state.localBus.postMessage({
          type: "LOCAL_PAYLOAD",
          sender: state.myId,
          target: peerId,
          payload: { type: "PING", ts: now },
        });
      } else if (info.dataConn && info.dataConn.open) {
        info.dataConn.send({ type: "PING", ts: now });
      }

      if (now - info.lastPong > 12000) {
        logRadio(`[TIMEOUT] Sinyal ${info.callsign} hilang.`, "text-red-400");
      }
    });
  }, 2500);
}

function renderPeersList() {
  const listEl = document.getElementById("peers-list");
  const countEl = document.getElementById("peer-count");
  countEl.textContent = state.connections.size;

  if (state.connections.size === 0) {
    listEl.innerHTML = `<div class="text-center py-3 text-xs text-gray-500 border border-dashed border-asphalt-800 rounded-xl">Belum ada rider terhubung. Bagikan ID Anda atau masukkan ID teman.</div>`;
    return;
  }

  listEl.innerHTML = "";
  state.connections.forEach((info, peerId) => {
    let pingColor = "text-emerald-400";

    if (info.ping > 250) pingColor = "text-red-400";
    else if (info.ping > 110) pingColor = "text-amber-400";

    const routeBadge =
      info.routeType === "TURN RELAY"
        ? `<span class="text-[9px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">TURN</span>`
        : `<span class="text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">${info.routeType || "P2P"}</span>`;
    const talkingBadge = info.isTalking
      ? `<span class="text-[10px] bg-brand-orange text-white font-bold px-2 py-0.5 rounded animate-pulse">BICARA</span>`
      : routeBadge;
    const item = document.createElement("div");
    item.className = `flex items-center justify-between bg-asphalt-950 border ${info.isTalking ? "border-brand-orange" : "border-asphalt-800"} rounded-xl px-3 py-2`;
    item.innerHTML = `
                    <div class="flex items-center gap-2.5">
                        <div class="w-2.5 h-2.5 rounded-full ${info.isTalking ? "bg-brand-orange animate-ping" : "bg-emerald-500"}"></div>
                        <div>
                            <div class="text-xs font-bold text-white">${info.callsign}</div>
                            <div class="text-[10px] font-mono text-gray-500">${peerId}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${talkingBadge}
                        <span class="font-mono text-xs font-bold ${pingColor}">${info.ping} ms</span>
                    </div>
                `;
    listEl.appendChild(item);
  });
}

function updateConnectionStatus(text, dotClass) {
  document.getElementById("connection-status-text").textContent = text;
  const dot = document.getElementById("status-dot");
  dot.className = `w-3 h-3 rounded-full ${dotClass}`;
}

function motoMeshApp() {
  return {
    setupOpen: !getSavedSession(),
    leaveModalOpen: false,
    customTurnOpen: false,
    callsignInput: localStorage.getItem("motomesh_callsign") || "",
    bitrateInput: String(getSavedSession()?.bitrate || 8000),
    turnUrl: localStorage.getItem("motomesh_turn_url") || "",
    turnUser: localStorage.getItem("motomesh_turn_user") || "",
    turnPass: localStorage.getItem("motomesh_turn_pass") || "",
    targetPeerId: "",
    windFilterEnabled: getSavedSession()?.windFilterEnabled ?? true,
    latchMode: !!getSavedSession()?.latchMode,
    isTransmitting: false,

    init() {
      this.$watch("windFilterEnabled", (value) => {
        state.windFilterEnabled = value;
      });

      this.$watch("latchMode", (value) => {
        state.latchMode = value;
      });

      if (getSavedSession()) this.setupOpen = false;
    },

    async startSystem() {
      const nameInput = this.callsignInput.trim().toUpperCase();
      state.callsign = nameInput || `RIDER-${Math.floor(10 + Math.random() * 89)}`;
      this.callsignInput = state.callsign;

      try {
        localStorage.setItem("motomesh_callsign", state.callsign);
      } catch (e) {}

      state.bitrate = parseInt(this.bitrateInput, 10);
      state.myId = generateShortId();
      saveActiveSession();
      document.getElementById("network-mode-badge").textContent =
        `${state.bitrate / 1000}K FEC`;
      this.setupOpen = false;

      await requestScreenWakeLock();
      await initAudioPipeline();
      initPeerNetwork(state.myId);
      startHeartbeatMonitor();
      playToneBeep(1046, 0.1);
    },

    copyId() {
      if (!state.myId) return;

      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(state.myId)
          .then(() => {
            showToast(`ID ${state.myId} disalin! Kirim ke teman touring.`, "success");
          })
          .catch(() => {
            const tempInput = document.createElement("input");
            tempInput.value = state.myId;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            tempInput.remove();
            showToast(`ID ${state.myId} disalin! Kirim ke teman touring.`, "success");
          });
      } else {
        const tempInput = document.createElement("input");
        tempInput.value = state.myId;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        tempInput.remove();
        showToast(`ID ${state.myId} disalin! Kirim ke teman touring.`, "success");
      }
    },

    connectPeer() {
      connectToRider(this.targetPeerId);
      this.targetPeerId = "";
    },

    toggleWindFilter() {
      this.windFilterEnabled = !this.windFilterEnabled;
      state.windFilterEnabled = this.windFilterEnabled;
      saveActiveSession();

      if (state.filterNode)
        state.filterNode.frequency.value = this.windFilterEnabled ? 300 : 20;
    },

    setMode(latch) {
      this.latchMode = latch;
      state.latchMode = latch;
      saveActiveSession();
      setTransmissionState(false);
    },

    pressPtt() {
      if (this.latchMode) setTransmissionState(!state.isTransmitting);
      else setTransmissionState(true);

      this.isTransmitting = state.isTransmitting;
    },

    releasePtt() {
      if (!this.latchMode && state.isTransmitting) setTransmissionState(false);

      this.isTransmitting = state.isTransmitting;
    },

    sendBeacon(code, message) {
      sendTacticalBeacon(code, message);
    },

    confirmLeave() {
      leaveCommunicationSession();
      this.leaveModalOpen = false;
      this.setupOpen = true;
      this.isTransmitting = false;
    },
  };
}

window.motoMeshApp = motoMeshApp;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement.tagName !== "INPUT" && !e.repeat) {
    e.preventDefault();

    if (state.latchMode) setTransmissionState(!state.isTransmitting);
    else setTransmissionState(true);
  }
});

window.addEventListener("keyup", (e) => {
  if (
    e.code === "Space" &&
    document.activeElement.tagName !== "INPUT" &&
    !state.latchMode
  ) {
    e.preventDefault();
    setTransmissionState(false);
  }
});
