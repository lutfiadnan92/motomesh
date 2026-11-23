import { SESSION_KEY } from "./config.js";
import { state } from "./state.js";

export function saveActiveSession() {
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

export function getSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    return parsed && parsed.active ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function clearActiveSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}
