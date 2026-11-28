import { state } from "./state.js";
import { generateShortId } from "./utils.js";
import { motoMeshApp } from "./app.js";
import {
  applyAudioOutput,
  refreshAudioOutputs,
  scheduleAudioDeviceRefresh,
  setTransmissionState,
} from "./audio.js";
import { resumeSession } from "./lifecycle.js";
import { activateSandboxMeshFallback } from "./local-mesh.js";
import { removePeer } from "./peers.js";
import { requestScreenWakeLock } from "./wakelock.js";

// Modul dimuat sebelum Alpine (lihat urutan <script> di index.html), jadi event ini tidak terlewat
document.addEventListener("alpine:init", () => {
  Alpine.data("motoMeshApp", motoMeshApp);
});

window.addEventListener("DOMContentLoaded", async () => {
  // Daftar dirender ulang lewat innerHTML, jadi pakai event delegation
  document.getElementById("peers-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-peer]");

    if (button) removePeer(button.dataset.removePeer);
  });

  const outputSelect = document.getElementById("audio-output-select");

  if (outputSelect) {
    outputSelect.addEventListener("change", (event) =>
      applyAudioOutput(event.target.value),
    );
    await refreshAudioOutputs();
  }

  navigator.mediaDevices?.addEventListener?.("devicechange", scheduleAudioDeviceRefresh);

  await resumeSession();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.active) {
    requestScreenWakeLock();
    scheduleAudioDeviceRefresh();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;

  if (
    reason &&
    (reason.name === "SecurityError" || String(reason).includes("WebSocket"))
  ) {
    event.preventDefault();
    if (state.active) activateSandboxMeshFallback(state.myId || generateShortId());
  }
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
