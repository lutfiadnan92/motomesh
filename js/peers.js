import {
  DIAL_TIMEOUT_MS,
  LARGER_ID_GRACE_MS,
  MAX_CALLSIGN_LENGTH,
  MAX_SHARED_PEERS,
  MAX_ACTIVE_PEERS,
  MAX_TOTAL_RIDERS,
  PEER_ID_PATTERN,
  RECONNECT_BACKOFF_MS,
} from "./config.js";
import { state } from "./state.js";
import { saveActiveSession } from "./session.js";
import { logRadio, renderPeersList, showToast } from "./ui.js";
import { optimizeOpusSDP, playToneBeep } from "./audio.js";
import { flushOfflineQueue, sendToPeer } from "./broadcast.js";
import { inspectConnectionRoute } from "./route.js";

const dialGraceMs = (peerId) => (state.myId > peerId ? LARGER_ID_GRACE_MS : 0);

export function getDial(peerId) {
  let dial = state.dials.get(peerId);

  if (!dial) {
    dial = {
      attempts: 0,
      nextAt: 0,
      connecting: false,
      timeoutId: null,
      dataConn: null,
      mediaCall: null,
    };
    state.dials.set(peerId, dial);
  }

  return dial;
}

function clearDialTimer(dial) {
  if (!dial?.timeoutId) return;

  clearTimeout(dial.timeoutId);
  dial.timeoutId = null;
}

export function abandonDial(dial) {
  if (!dial) return;

  dial.connecting = false;
  clearDialTimer(dial);

  try {
    dial.dataConn?.close();
    dial.mediaCall?.close();
  } catch (e) {}

  dial.dataConn = null;
  dial.mediaCall = null;
}

export function takeDial(peerId) {
  const dial = state.dials.get(peerId);

  if (!dial) return null;

  clearDialTimer(dial);
  state.dials.delete(peerId);
  return dial;
}

// Keterangan log menyesuaikan penyebab: server tidak mengenal ID, atau tidak ada jawaban
function describeWait(peerId, reason, isSteadyState) {
  const subject = reason === "timeout" ? "belum menjawab" : "belum terdaftar di server";

  return isSteadyState
    ? `[WAIT] ${peerId} masih ${subject}. Percobaan berikutnya setiap 30 detik.`
    : `[WAIT] ${peerId} ${subject}. Akan dicoba lagi.`;
}

// reason: "unavailable" (server menjawab EXPIRE) atau "timeout" (tidak ada jawaban)
export function releaseDial(peerId, reason = "unavailable") {
  if (!peerId || state.connections.has(peerId)) return;

  const dial = state.dials.get(peerId);

  if (!dial?.connecting) return;

  const attempts = dial.attempts;

  abandonDial(dial);

  // Timeout datang jauh setelah dial dimulai, sehingga nextAt bawaan dialPeer()
  // sudah lewat. Hitung ulang dari sekarang agar jeda 3/6/12/30 detik tetap berlaku.
  if (reason === "timeout") {
    dial.nextAt = Math.max(dial.nextAt, Date.now() + nextRetryDelay(attempts));
  }

  if (attempts <= 1) {
    logRadio(describeWait(peerId, reason, false), "text-amber-400");
  } else if (attempts === RECONNECT_BACKOFF_MS.length) {
    logRadio(describeWait(peerId, reason, true), "text-amber-400");
  }

  renderPeersList();
}

// Dipanggil setelah ID terdaftar ulang: dial milik peer lama tidak akan pernah dijawab.
// Lepaskan agar tidak tertahan di MENGHUBUNGKAN, dan izinkan percobaan ulang segera.
export function releaseStaleDials() {
  let released = 0;

  state.dials.forEach((dial, peerId) => {
    if (!dial.connecting || state.connections.has(peerId)) return;

    abandonDial(dial);
    dial.nextAt = 0;
    released += 1;
  });

  if (released > 0) renderPeersList();
}

// Jeda sebelum percobaan berikutnya; naik bertahap lalu bertahan di nilai terbesar
function nextRetryDelay(attempts) {
  return RECONNECT_BACKOFF_MS[Math.min(attempts, RECONNECT_BACKOFF_MS.length) - 1];
}

export function scheduleRetry(peerId) {
  if (!state.savedPeers.has(peerId)) return;

  const dial = getDial(peerId);

  abandonDial(dial);
  dial.connecting = false;
  dial.attempts = 0;
  dial.nextAt = Date.now() + dialGraceMs(peerId);
}

export function getReservedPeerCount() {
  let count = state.connections.size;

  state.dials.forEach((dial) => {
    if (dial.connecting) count += 1;
  });

  return count;
}

export function hasPeerCapacity(peerId = null) {
  if (peerId && (state.connections.has(peerId) || state.dials.get(peerId)?.connecting)) {
    return true;
  }

  return getReservedPeerCount() < MAX_ACTIVE_PEERS;
}

export function dialPeer(peerId) {
  if (!state.active || state.connections.has(peerId) || !hasPeerCapacity(peerId)) return;

  const dial = getDial(peerId);

  if (dial.connecting) return;

  // Tanpa jalur sinyal, jangan hitung sebagai percobaan agar jeda tidak naik sia-sia
  const viaLocalBus = state.sandboxMode && state.localBus;

  if (!viaLocalBus && !state.peer?.open) return;

  abandonDial(dial);

  dial.connecting = true;
  dial.attempts += 1;
  dial.nextAt = Date.now() + nextRetryDelay(dial.attempts);

  if (dial.attempts === 1) {
    logRadio(`[DIAL] Menghubungkan ke ${peerId}...`, "text-blue-400");
  }

  if (state.sandboxMode && state.localBus) {
    state.localBus.postMessage({
      type: "LOCAL_CONNECT_REQ",
      sender: state.myId,
      target: peerId,
      callsign: state.callsign,
    });
    armDialTimeout(peerId, dial);
    return;
  }

  dial.dataConn = state.peer.connect(peerId, {
    reliable: false,
    serialization: "json",
  });
  setupDataConnection(dial.dataConn);

  if (state.processedStream) {
    const call = state.peer.call(peerId, state.processedStream, {
      sdpTransform: (sdp) => optimizeOpusSDP(sdp, state.bitrate),
    });
    setupMediaCall(call, { outbound: true });
  }

  armDialTimeout(peerId, dial);
}

function armDialTimeout(peerId, dial) {
  clearDialTimer(dial);
  dial.timeoutId = setTimeout(() => releaseDial(peerId, "timeout"), DIAL_TIMEOUT_MS);
}

// Entri di `connections` dihapus lebih dulu agar handler "close" tidak
// menganggapnya sebagai putus koneksi tak terduga.
export function closePeerConnections(peerId) {
  const info = state.connections.get(peerId);

  state.connections.delete(peerId);

  try {
    info?.dataConn?.close();
    info?.mediaCall?.close();
  } catch (e) {}

  document.getElementById(`audio-${peerId}`)?.remove();
}

export function forgetPeer(peerId) {
  state.savedPeers.delete(peerId);
  abandonDial(state.dials.get(peerId));
  state.dials.delete(peerId);
  closePeerConnections(peerId);
}

export function connectToRider(targetId, isAutoReconnect = false) {
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

  if (!hasPeerCapacity(targetId)) {
    renderPeersList();

    if (!isAutoReconnect) {
      showToast(
        `${targetId} masuk antrean. Perangkat ini sudah mencapai ${MAX_ACTIVE_PEERS} koneksi langsung (target grup ${MAX_TOTAL_RIDERS} rider).`,
      );
    }

    return;
  }

  if (isAutoReconnect) {
    // Dial dilakukan loop sambung ulang agar kedua sisi tidak bertabrakan
    if (!state.dials.has(targetId)) scheduleRetry(targetId);
  } else {
    getDial(targetId).attempts = 0;
    dialPeer(targetId);
  }

  renderPeersList();
}

export function removePeer(remoteId) {
  const info = state.connections.get(remoteId);

  // Memberi tahu rekan agar tidak mencoba menyambung ulang ke kita
  if (info?.isLocalBus && state.localBus) {
    state.localBus.postMessage({
      type: "LOCAL_LEAVE",
      sender: state.myId,
      target: remoteId,
    });
  } else {
    try {
      if (info?.dataConn?.open) info.dataConn.send({ type: "LEAVE" });
    } catch (e) {}
  }

  forgetPeer(remoteId);
  saveActiveSession();
  renderPeersList();
  logRadio(`[REMOVE] ${remoteId} dihapus dari daftar.`, "text-gray-400");
}

export function handlePeerLeft(remoteId) {
  const name = state.connections.get(remoteId)?.callsign ?? remoteId;

  forgetPeer(remoteId);
  saveActiveSession();
  renderPeersList();
  logRadio(`[LEAVE] ${name} keluar dari sesi komunikasi.`, "text-amber-400");
  showToast(`${name} keluar dari komunikasi.`);
}

export function setupDataConnection(conn) {
  const remoteId = conn.peer;

  conn.on("open", () => {
    if (!hasPeerCapacity(remoteId)) {
      state.pendingPeers.add(remoteId);

      try {
        conn.send({
          type: "WAITING",
          reason: `Batas ${MAX_ACTIVE_PEERS} koneksi langsung per perangkat tercapai (target grup ${MAX_TOTAL_RIDERS} rider)`,
        });
      } catch (e) {}

      renderPeersList();
      logRadio(`[WAITING] ${remoteId} menunggu slot tersedia.`, "text-amber-400");
      conn.close();

      return;
    }

    state.pendingPeers.delete(remoteId);
    state.savedPeers.add(remoteId);
    saveActiveSession();

    const dial = takeDial(remoteId);
    const existing = state.connections.get(remoteId);

    if (existing) {
      existing.dataConn = conn;
      existing.mediaCall ??= dial?.mediaCall ?? null;
    } else {
      state.connections.set(remoteId, {
        dataConn: conn,
        mediaCall: dial?.mediaCall ?? null,
        callsign: remoteId,
        ping: 0,
        routeType: "NEGOTIATING",
        lastPong: Date.now(),
      });
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
    const info = state.connections.get(remoteId);

    // Abaikan koneksi lama yang sudah digantikan dan penutupan yang kita lakukan sendiri
    if (!state.active || !info || info.dataConn !== conn) return;

    logRadio(
      `[DROP] Koneksi ${remoteId} terputus. Mencoba menyambung ulang...`,
      "text-red-400",
    );
    closePeerConnections(remoteId);
    scheduleRetry(remoteId);
    renderPeersList();
  });
}

export function setupMediaCall(call, { outbound = false } = {}) {
  const remoteId = call.peer;
  const info = state.connections.get(remoteId);

  if (info) {
    info.mediaCall = call;
  } else if (outbound) {
    // Rekan baru dianggap tersambung setelah jalur datanya terbuka
    getDial(remoteId).mediaCall = call;
  } else {
    state.connections.set(remoteId, {
      dataConn: null,
      mediaCall: call,
      callsign: remoteId,
      ping: 0,
      routeType: "NEGOTIATING",
      lastPong: Date.now(),
    });
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
    // Panggilan lama yang ditutup tidak boleh mematikan audio panggilan yang masih aktif
    const current = state.connections.get(remoteId);
    if (current && current.mediaCall !== call) return;

    document.getElementById(`audio-${remoteId}`)?.remove();
  });
}

export function handleIncomingData(remoteId, data) {
  if (data?.type === "WAITING") {
    const dial = getDial(remoteId);
    dial.connecting = false;
    dial.nextAt = Date.now() + RECONNECT_BACKOFF_MS[0];

    renderPeersList();
    logRadio(
      `[WAITING] ${remoteId} sedang menunggu slot rider tersedia. ${data.reason || ""}`.trim(),
      "text-amber-400",
    );

    return;
  }

  const peerInfo = state.connections.get(remoteId);

  if (!peerInfo) return;

  switch (data.type) {
    case "HELLO":
      peerInfo.callsign = String(data.callsign || remoteId).slice(0, MAX_CALLSIGN_LENGTH);
      renderPeersList();

      if (Array.isArray(data.peers)) {
        data.peers
          .filter((id) => typeof id === "string" && PEER_ID_PATTERN.test(id))
          .slice(0, MAX_SHARED_PEERS)
          .forEach((otherId) => {
            if (otherId !== state.myId && !state.connections.has(otherId)) {
              connectToRider(otherId, true);
            }
          });
      }
      break;

    case "PING":
      sendToPeer(remoteId, peerInfo, { type: "PONG", ts: data.ts });
      break;

    case "PONG":
      peerInfo.ping = Math.max(1, Math.round((Date.now() - data.ts) / 2));
      peerInfo.lastPong = Date.now();
      renderPeersList();
      break;

    case "BEACON": {
      const isSos = data.code === "SOS";

      playToneBeep(isSos ? 1320 : 880, 0.18, "square");
      navigator.vibrate?.(isSos ? [200, 100, 200] : [120]);
      logRadio(
        `[RX-${data.sender}] ${data.msg}`,
        isSos ? "text-red-400 font-bold" : "text-amber-300",
      );
      showToast(`${data.sender}: ${data.msg}`, isSos ? "alert" : "info");
      break;
    }

    case "PTT_STATE":
      peerInfo.isTalking = data.talking;
      renderPeersList();
      break;

    case "LEAVE":
      handlePeerLeft(remoteId);
      break;
  }
}
