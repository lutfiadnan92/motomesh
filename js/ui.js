import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

export function showToast(msg, type = "info") {
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

export function logRadio(text, colorClass = "text-gray-300") {
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

export function updateConnectionStatus(text, dotClass) {
  document.getElementById("connection-status-text").textContent = text;
  document.getElementById("status-dot").className = `w-3 h-3 rounded-full ${dotClass}`;
}

export function renderPeersList() {
  const listEl = document.getElementById("peers-list");

  document.getElementById("peer-count").textContent = state.connections.size;

  const rows = Array.from(state.connections);

  state.savedPeers.forEach((peerId) => {
    if (!state.connections.has(peerId)) {
      const isConnecting = state.dials.get(peerId)?.connecting;

      rows.push([
        peerId,
        {
          callsign: peerId,
          ping: 0,
          routeType: isConnecting ? "MENGHUBUNGKAN" : "MENUNGGU",
        },
      ]);
    }
  });

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="text-center py-3 text-xs text-gray-500 border border-dashed border-asphalt-800 rounded-xl">Belum ada rider terhubung. Bagikan ID Anda atau masukkan ID teman.</div>`;
    return;
  }

  listEl.innerHTML = "";
  rows.forEach(([peerId, info]) => {
    const isWaiting = info.routeType === "MENUNGGU";
    const isConnecting = info.routeType === "MENGHUBUNGKAN";
    let pingColor = "text-emerald-400";

    if (isWaiting) pingColor = "text-gray-500";
    else if (info.ping > 250) pingColor = "text-red-400";
    else if (info.ping > 110) pingColor = "text-amber-400";

    const routeBadge = isWaiting
      ? `<span class="text-[9px] font-mono bg-asphalt-800 text-gray-400 border border-asphalt-700 px-1.5 py-0.5 rounded">MENUNGGU</span>`
      : isConnecting
        ? `<span class="text-[9px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">MENGHUBUNGKAN</span>`
        : info.routeType === "TURN RELAY"
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
        <div class="w-2.5 h-2.5 rounded-full ${info.isTalking ? "bg-brand-orange animate-ping" : isWaiting ? "bg-gray-500" : "bg-emerald-500"}"></div>
        <div>
          <div class="text-xs font-bold text-white">${escapeHtml(info.callsign)}</div>
          <div class="text-[10px] font-mono text-gray-500">${escapeHtml(peerId)}</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        ${talkingBadge}
        <span class="font-mono text-xs font-bold ${pingColor}">${isWaiting || isConnecting ? "-" : `${info.ping} ms`}</span>
        <button
          type="button"
          data-remove-peer="${escapeHtml(peerId)}"
          title="Hapus dari daftar"
          aria-label="Hapus ${escapeHtml(peerId)}"
          class="w-6 h-6 rounded-lg text-xs font-bold text-gray-500 hover:text-red-400 hover:bg-red-500/15 active:scale-95 transition"
        >x</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}
