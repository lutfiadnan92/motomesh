import { DEFAULT_BITRATE } from "./config.js";
import { state } from "./state.js";
import { generateShortId } from "./utils.js";
import { getSavedSession, saveActiveSession } from "./session.js";
import { showToast } from "./ui.js";
import { initAudioPipeline, playToneBeep, setTransmissionState } from "./audio.js";
import { requestScreenWakeLock } from "./wakelock.js";
import { initPeerNetwork } from "./signaling.js";
import { startPeerMaintenance } from "./maintenance.js";
import { connectToRider } from "./peers.js";
import { sendTacticalBeacon } from "./flash-signal.js";
import { leaveCommunicationSession } from "./lifecycle.js";

export function motoMeshApp() {
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
    latchMode: getSavedSession()?.latchMode ?? true,
    isTransmitting: false,

    init() {
      // Aturan CSS awal hanya untuk mencegah kedipan; setelahnya x-show yang mengatur overlay
      delete document.documentElement.dataset.session;

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
      startPeerMaintenance();
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

    reloadPage() {
      window.location.reload();
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
