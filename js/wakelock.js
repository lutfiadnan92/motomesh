import { state } from "./state.js";

const BADGE_ACTIVE =
  "text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30";
const BADGE_NORMAL =
  "text-[10px] font-mono px-2 py-1 rounded-lg bg-asphalt-800 text-gray-400 border border-asphalt-700";

export async function requestScreenWakeLock() {
  if (!("wakeLock" in navigator)) return;

  const badge = document.getElementById("wakelock-badge");

  try {
    const lock = await navigator.wakeLock.request("screen");

    // Leave bisa terjadi selagi permintaan menunggu
    if (!state.active) {
      lock.release().catch(() => {});
      return;
    }

    state.wakeLock = lock;
    badge.textContent = "LAYAR: AKTIF";
    badge.className = BADGE_ACTIVE;
    lock.addEventListener("release", () => {
      badge.textContent = "LAYAR: NORMAL";
      badge.className = BADGE_NORMAL;
    });
  } catch (err) {
    badge.textContent = "LAYAR: AUTO";
  }
}
