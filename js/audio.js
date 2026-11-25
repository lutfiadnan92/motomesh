import { state } from "./state.js";
import { broadcastPayload } from "./broadcast.js";
import { logRadio, showToast } from "./ui.js";
import { MIC_CONSTRAINTS } from "./config.js";

export function playToneBeep(freq = 880, duration = 0.08, type = "sine") {
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

export function optimizeOpusSDP(sdp, maxBitrate) {
  return sdp.replace(/a=fmtp:111 (.*)/g, (match, params) => {
    return `a=fmtp:111 ${params};useinbandfec=1;usedtx=1;maxaveragebitrate=${maxBitrate};stereo=0;cbr=0`;
  });
}

export async function refreshAudioOutputs() {
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

export async function applyAudioOutput(deviceId = "", notify = true) {
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

  if (notify) {
    showToast(
      deviceId
        ? "Keluaran audio diperbarui."
        : "Keluaran audio mengikuti perangkat sistem.",
      "success",
    );
  }
}

// let inputRefreshTimer = null;
// let inputRefreshInFlight = false;

export async function initAudioPipeline() {
  try {
    state.rawStream = await navigator.mediaDevices.getUserMedia({
      audio: MIC_CONSTRAINTS,
      video: false,
    });
  } catch (err) {
    logRadio(
      "[WARN] Mikrofon tidak tersedia, menggunakan audio virtual.",
      "text-amber-400",
    );

    const dummyCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.rawStream = dummyCtx.createMediaStreamDestination().stream;
  }

  if (!state.active) {
    state.rawStream.getTracks().forEach((track) => track.stop());
    state.rawStream = null;
    return;
  }

  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await applyAudioOutput(state.outputDeviceId, false);

  state.sourceNode = state.audioCtx.createMediaStreamSource(state.rawStream);
  state.filterNode = state.audioCtx.createBiquadFilter();
  state.filterNode.type = "highpass";
  state.filterNode.frequency.value = state.windFilterEnabled ? 300 : 20;

  const compressor = state.audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = 0;

  const destination = state.audioCtx.createMediaStreamDestination();
  state.sourceNode.connect(state.filterNode);
  state.filterNode.connect(compressor);
  compressor.connect(state.gainNode);
  state.gainNode.connect(destination);
  state.processedStream = destination.stream;
  setTransmissionState(false);
}

export async function refreshAudioInput({ notify = true } = {}) {
  if (!state.active || !state.audioCtx || !state.filterNode || state.inputRefreshInFlight) {
    return;
  }

  state.inputRefreshInFlight = true;

  try {
    const oldStream = state.rawStream;
    const oldTrack = oldStream?.getAudioTracks?.()[0] || null;
    const oldSettings = oldTrack?.getSettings?.() || {};
    const oldDeviceId = oldSettings.deviceId || "";
    const oldLabel = (oldTrack?.label || "").toLowerCase();

    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: MIC_CONSTRAINTS,
      video: false,
    });

    if (!state.active) {
      newStream.getTracks().forEach((t) => t.stop());
      return;
    }

    const newTrack = newStream.getAudioTracks()[0];
    const newSettings = newTrack?.getSettings?.() || {};
    const newDeviceId = newSettings.deviceId || "";
    const newLabel = (newTrack?.label || "").toLowerCase();

    if (
      oldTrack &&
      newDeviceId &&
      oldDeviceId &&
      newDeviceId === oldDeviceId &&
      newLabel === oldLabel
    ) {
      newStream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      state.sourceNode?.disconnect();
    } catch (e) {}

    state.sourceNode = state.audioCtx.createMediaStreamSource(newStream);
    state.sourceNode.connect(state.filterNode);
    state.rawStream = newStream;

    newStream.getAudioTracks().forEach((track) => {
      track.enabled = !!state.isTransmitting;
    });

    oldStream?.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch (e) {}
    });

    if (notify) {
      const isBt = /bluetooth|headset|hands-free|hfp|a2dp|earbud|airpod|buds/i.test(
        newLabel,
      );
      showToast(
        isBt
          ? "Mikrofon beralih ke headset Bluetooth."
          : "Mikrofon diperbarui mengikuti perangkat sistem.",
        "success",
      );
      logRadio(
        `[AUDIO] Input diganti → ${newTrack?.label || "perangkat sistem"}`,
        "text-sky-400",
      );
    }
  } catch (err) {
    logRadio(
      `[WARN] Gagal memperbarui mikrofon: ${err?.message || err}`,
      "text-amber-400",
    );
  } finally {
    state.inputRefreshInFlight = false;
  }
}

export function scheduleAudioDeviceRefresh() {
  if (state.inputRefreshTimer) clearTimeout(state.inputRefreshTimer);

  state.inputRefreshTimer = setTimeout(async () => {
    state.inputRefreshTimer = null;
    await refreshAudioOutputs();
    await refreshAudioInput({ notify: true });
  }, 400);
}

export function setTransmissionState(active) {
  state.isTransmitting = active;
  window.dispatchEvent(new CustomEvent("ptt-change", { detail: active }));

  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }

  if (active) {
    if (state.gainNode) {
      state.gainNode.gain.setTargetAtTime(1.2, state.audioCtx.currentTime, 0.01);
    }

    state.rawStream?.getAudioTracks().forEach((track) => (track.enabled = true));

    playToneBeep(920, 0.06);
  } else {
    if (state.gainNode && state.audioCtx) {
      state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.01);
    }

    state.rawStream?.getAudioTracks().forEach((track) => (track.enabled = false));
  }

  broadcastPayload({ type: "PTT_STATE", talking: active });
}
