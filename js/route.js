import { state } from "./state.js";
import { logRadio, renderPeersList } from "./ui.js";

const MAX_ATTEMPTS = 20;

// Menentukan apakah jalur ke rekan langsung (P2P) atau lewat relay TURN
export function inspectConnectionRoute(pc, remoteId) {
  if (!pc || typeof pc.getStats !== "function") return;
  if (pc.__motoMeshRouteCheck) return;

  let attempts = 0;

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

    if (attempts < MAX_ATTEMPTS) {
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
