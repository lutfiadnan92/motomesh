import { state } from "./state.js";
import { saveActiveSession } from "./session.js";
import { logRadio, renderPeersList, updateConnectionStatus } from "./ui.js";
import { flushOfflineQueue } from "./broadcast.js";
import { connectToRider, handleIncomingData, handlePeerLeft, takeDial } from "./peers.js";

// Mode cadangan saat WebSocket ke server signaling diblokir: antar tab lewat BroadcastChannel
export function activateSandboxMeshFallback(id) {
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
  state.localBus.onmessage = (ev) => {
    const msg = ev.data;

    if (!msg || (msg.target !== state.myId && msg.target !== "*")) return;
    if (msg.sender === state.myId) return;

    switch (msg.type) {
      case "LOCAL_CONNECT_REQ":
        registerLocalPeer(msg.sender, msg.callsign);
        state.localBus.postMessage({
          type: "LOCAL_CONNECT_ACK",
          sender: state.myId,
          target: msg.sender,
          callsign: state.callsign,
        });
        break;
      case "LOCAL_CONNECT_ACK":
        registerLocalPeer(msg.sender, msg.callsign);
        break;
      case "LOCAL_LEAVE":
        handlePeerLeft(msg.sender);
        break;
      case "LOCAL_PAYLOAD":
        handleIncomingData(msg.sender, msg.payload);
        break;
      case "LOCAL_AUDIO_CHUNK":
        if (msg.pcm) playIncomingLocalAudio(msg.pcm);
        break;
    }
  };

  setupLocalAudioBridge();

  state.savedPeers.forEach((peerId) => {
    if (peerId !== state.myId) connectToRider(peerId, true);
  });
}

function registerLocalPeer(remoteId, callsign) {
  state.savedPeers.add(remoteId);
  takeDial(remoteId);
  saveActiveSession();

  if (state.connections.has(remoteId)) return;

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

function setupLocalAudioBridge() {
  if (!state.audioCtx || !state.gainNode) return;

  try {
    const scriptNode = state.audioCtx.createScriptProcessor(2048, 1, 1);
    state.gainNode.connect(scriptNode);
    scriptNode.connect(state.audioCtx.destination);

    scriptNode.onaudioprocess = (e) => {
      e.outputBuffer.getChannelData(0).fill(0);

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
