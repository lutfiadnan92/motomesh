const SESSION_KEY = "motomesh_active_session";
const MAX_CALLSIGN_LENGTH = 16;
const DEFAULT_BITRATE = 14000;
const state = {
  peer: null,
  active: false,
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
  latchMode: false,
  sandboxMode: false,
  localBus: null,
  wakeLock: null,
  heartbeatTimer: null,
  leaving: false,
  connections: new Map(),
  savedPeers: new Set(),
  offlineQueue: [],
  outputDeviceId: localStorage.getItem("motomesh_output_device") || "",
};
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

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
      const lock = await navigator.wakeLock.request("screen");

      // Leave bisa terjadi selagi permintaan menunggu
      if (!state.active) {
        lock.release().catch(() => {});
        return;
      }

      state.wakeLock = lock;
      badge.textContent = "LAYAR: AKTIF";
      badge.className =
        "text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30";
      lock.addEventListener("release", () => {
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
  if (document.visibilityState === "visible" && state.active) {
    requestScreenWakeLock();
  }
});

function saveActiveSession() {
  if (!state.active) return;

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

async function refreshAudioOutputs() {
  const select = document.getElementById("audio-output-select");

  if (!select || !navigator.mediaDevices?.enumerateDevices) return;

  const previous = state.outputDeviceId;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === "audiooutput");
    select.replaceChildren(new Option("Otomatis (perangkat sistem)", ""));

    outputs.forEach((device, index) => {
      select.add(new Option(device.label || `Speaker ${index + 1}`, device.deviceId));
    });

    const stillAvailable =
      !previous || outputs.some((device) => device.deviceId === previous);

    if (!stillAvailable) {
      state.outputDeviceId = "";
      localStorage.removeItem("motomesh_output_device");
    }

    select.value = state.outputDeviceId;

    await applyAudioOutput(state.outputDeviceId, false);
  } catch (error) {
    document.getElementById("audio-output-status").textContent =
      "Daftar perangkat audio tidak dapat dibaca oleh browser ini.";
  }
}

async function applyAudioOutput(deviceId = "", notify = true) {
  state.outputDeviceId = deviceId;

  try {
    if (deviceId) localStorage.setItem("motomesh_output_device", deviceId);
    else localStorage.removeItem("motomesh_output_device");
  } catch (e) {}

  const status = document.getElementById("audio-output-status");
  const audioElements = document.querySelectorAll("#remote-audio-container audio");
  let mediaSupported = true;

  for (const audio of audioElements) {
    if (typeof audio.setSinkId === "function") {
      try {
        await audio.setSinkId(deviceId);
      } catch (e) {}
    } else if (deviceId) {
      mediaSupported = false;
    }
  }

  let contextSupported = true;

  if (state.audioCtx) {
    if (typeof state.audioCtx.setSinkId === "function") {
      try {
        await state.audioCtx.setSinkId(deviceId);
      } catch (e) {
        contextSupported = false;
      }
    } else if (deviceId) {
      contextSupported = false;
    }
  }

  if (status) {
    if (!deviceId) {
      status.textContent =
        "Otomatis mengikuti keluaran audio sistem. Headset Bluetooth/kabel akan dipakai saat dipilih oleh sistem operasi.";
    } else if (mediaSupported && contextSupported) {
      status.textContent = "Keluaran audio diarahkan ke perangkat yang dipilih.";
    } else {
      status.textContent =
        "Browser membatasi pemilihan output manual. Gunakan mode Otomatis agar mengikuti headset dari sistem.";
    }
  }
  if (notify)
    showToast(
      deviceId
        ? "Keluaran audio diperbarui."
        : "Keluaran audio mengikuti perangkat sistem.",
      "success",
    );
}

window.addEventListener("DOMContentLoaded", async () => {
  const outputSelect = document.getElementById("audio-output-select");

  if (outputSelect) {
    outputSelect.addEventListener("change", (event) =>
      applyAudioOutput(event.target.value),
    );
    await refreshAudioOutputs();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshAudioOutputs);
  }

  const activeSession = getSavedSession();

  if (!activeSession) return;

  // Tampilan tombol (ANGIN, mode PTT) dikelola Alpine dari getSavedSession()
  state.active = true;
  state.myId = activeSession.myId || generateShortId();
  state.callsign = activeSession.callsign || "RIDER";
  state.bitrate = activeSession.bitrate || DEFAULT_BITRATE;
  state.windFilterEnabled = activeSession.windFilterEnabled ?? true;
  state.latchMode = !!activeSession.latchMode;

  if (Array.isArray(activeSession.peers)) {
    activeSession.peers.forEach((p) => state.savedPeers.add(p));
  }

  document.getElementById("my-callsign").textContent = state.callsign;
  document.getElementById("network-mode-badge").textContent =
    `${state.bitrate / 1000}K FEC`;

  await requestScreenWakeLock();
  await initAudioPipeline();

  // Leave bisa terjadi selagi menunggu izin mikrofon
  if (!state.active) return;

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

  // Leave bisa terjadi saat prompt izin mikrofon masih terbuka; jangan biarkan mic menyala.
  if (!state.active) {
    state.rawStream.getTracks().forEach((track) => track.stop());
    state.rawStream = null;
    return;
  }

  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await applyAudioOutput(state.outputDeviceId, false);
  const source = state.audioCtx.createMediaStreamSource(state.rawStream);
  state.filterNode = state.audioCtx.createBiquadFilter();
  state.filterNode.type = "highpass";
  state.filterNode.frequency.value = 300;

  const compressor = state.audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = 0;

  const destination = state.audioCtx.createMediaStreamDestination();
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
  if (pc.__motoMeshRouteCheck) return;

  let attempts = 0;
  const maxAttempts = 20;
  const checkRoute = async () => {
    if (pc.connectionState === "closed" || pc.iceConnectionState === "closed") {
      pc.__motoMeshRouteCheck = null;
      return;
    }

    try {
      const stats = await pc.getStats();
      const candidates = new Map();
      let activePair = null;

      stats.forEach((report) => {
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(report.id, report);
        }

        if (
          report.type === "candidate-pair" &&
          (report.selected === true ||
            report.nominated === true ||
            report.state === "succeeded")
        ) {
          if (!activePair || report.selected || report.nominated) activePair = report;
        }
      });

      if (activePair) {
        const localCand = candidates.get(activePair.localCandidateId);
        const remoteCand = candidates.get(activePair.remoteCandidateId);
        const isRelayed =
          localCand?.candidateType === "relay" || remoteCand?.candidateType === "relay";
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
        pc.__motoMeshRouteCheck = null;
        return;
      }
    } catch (e) {}

    attempts += 1;

    if (attempts < maxAttempts) {
      pc.__motoMeshRouteCheck = setTimeout(checkRoute, 1500);
    } else {
      pc.__motoMeshRouteCheck = null;
      if (pc.iceConnectionState === "failed") {
        logRadio(
          `[ROUTE] ICE gagal tersambung ke ${remoteId}. Periksa STUN/TURN atau jaringan.`,
          "text-red-400",
        );
      }
    }
  };

  pc.__motoMeshRouteCheck = setTimeout(checkRoute, 500);
}

function initPeerNetwork(preferredId = null) {
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
      logRadio(`[WARN] Rekan belum online / di luar jangkauan.`, "text-amber-400");
    } else {
      logRadio(`[NET-ERR] ${err.type}: ${err.message}`, "text-red-400");
    }
  });
}

function activateSandboxMeshFallback(id) {
  if (!state.active || state.sandboxMode) return;

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
    if (state.active) activateSandboxMeshFallback(state.myId || generateShortId());
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

  state.connections.delete(remoteId);
  state.savedPeers.delete(remoteId);
  saveActiveSession();

  const audioEl = document.getElementById(`audio-${remoteId}`);

  if (audioEl) audioEl.remove();

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

    if (typeof audioEl.setSinkId === "function") {
      audioEl.setSinkId(state.outputDeviceId).catch(() => {});
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
  window.dispatchEvent(new CustomEvent("ptt-change", { detail: active }));

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
    peerInfo.callsign = String(data.callsign || remoteId).slice(0, MAX_CALLSIGN_LENGTH);
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
  if (state.leaving) return;

  state.leaving = true;
  state.active = false;
  clearActiveSession();

  try {
    try {
      setTransmissionState(false);
    } catch (e) {}

    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }

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

    const audioContainer = document.getElementById("remote-audio-container");
    if (audioContainer) audioContainer.replaceChildren();

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
    // callsign berasal dari rekan (tidak tepercaya), wajib di-escape
    item.innerHTML = `
      <div class="flex items-center gap-2.5">
        <div class="w-2.5 h-2.5 rounded-full ${info.isTalking ? "bg-brand-orange animate-ping" : "bg-emerald-500"}"></div>
        <div>
          <div class="text-xs font-bold text-white">${escapeHtml(info.callsign)}</div>
          <div class="text-[10px] font-mono text-gray-500">${escapeHtml(peerId)}</div>
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
    bitrateInput: String(getSavedSession()?.bitrate || DEFAULT_BITRATE),
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
        if (state.filterNode) state.filterNode.frequency.value = value ? 300 : 20;
        saveActiveSession();
      });

      this.$watch("latchMode", (value) => {
        state.latchMode = value;
        setTransmissionState(false);
        saveActiveSession();
      });
    },

    async startSystem() {
      if (state.active) return;

      const nameInput = this.callsignInput.trim().toUpperCase();

      if (!nameInput) {
        this.callsignInput = "";

        showToast(
          "Callsign / Nama Rider wajib diisi sebelum mengaktifkan radio.",
          "alert",
        );
        document.getElementById("rider-name-input")?.focus();
        return;
      }
      state.callsign = nameInput;
      this.callsignInput = state.callsign;
      document.getElementById("my-callsign").textContent = state.callsign;

      try {
        localStorage.setItem("motomesh_callsign", state.callsign);
      } catch (e) {}

      state.bitrate = parseInt(this.bitrateInput, 10);
      state.myId = generateShortId();
      state.active = true;
      saveActiveSession();

      document.getElementById("network-mode-badge").textContent =
        `${state.bitrate / 1000}K FEC`;
      this.setupOpen = false;

      await requestScreenWakeLock();
      await initAudioPipeline();

      // Leave ditekan selama menunggu izin mikrofon
      if (!state.active) return;

      initPeerNetwork(state.myId);
      startHeartbeatMonitor();
      playToneBeep(1046, 0.1);
    },

    async copyId() {
      if (!state.myId) return;

      try {
        await navigator.clipboard.writeText(state.myId);
      } catch {
        // Fallback untuk konteks non-HTTPS atau izin clipboard ditolak
        const input = Object.assign(document.createElement("input"), {
          value: state.myId,
        });
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }

      showToast(`ID ${state.myId} disalin! Kirim ke teman touring.`, "success");
    },

    connectPeer() {
      connectToRider(this.targetPeerId);
      this.targetPeerId = "";
    },

    toggleWindFilter() {
      this.windFilterEnabled = !this.windFilterEnabled;
    },

    setMode(latch) {
      this.latchMode = latch;
    },

    pressPtt() {
      setTransmissionState(this.latchMode ? !state.isTransmitting : true);
    },

    releasePtt() {
      if (!this.latchMode && state.isTransmitting) setTransmissionState(false);
    },

    sendBeacon(code, message) {
      sendTacticalBeacon(code, message);
    },

    confirmLeave() {
      this.leaveModalOpen = false;
      leaveCommunicationSession();
      this.setupOpen = true;
    },
  };
}

document.addEventListener("alpine:init", () => {
  Alpine.data("motoMeshApp", motoMeshApp);
});

window.addEventListener("keydown", (e) => {
  if (!state.active || e.code !== "Space" || e.repeat) return;
  if (document.activeElement.matches("input, select")) return;

  e.preventDefault();
  setTransmissionState(state.latchMode ? !state.isTransmitting : true);
});

window.addEventListener("keyup", (e) => {
  if (!state.active || e.code !== "Space" || state.latchMode) return;
  if (document.activeElement.matches("input, select")) return;

  e.preventDefault();
  setTransmissionState(false);
});
