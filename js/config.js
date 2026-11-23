export const SESSION_KEY = "motomesh_active_session";
export const MAX_CALLSIGN_LENGTH = 16;
export const DEFAULT_BITRATE = 14000;

// Format ID dari generateShortId(); dipakai untuk menyaring ID yang dibagikan rekan
export const PEER_ID_PATTERN = /^MT-[A-HJ-NP-Z2-9]{4}$/;
// Batas anggota rombongan termasuk perangkat sendiri.
export const MAX_TOTAL_RIDERS = 22;
// Setiap perangkat hanya membuat koneksi langsung ke 21 rider lainnya.
export const MAX_ACTIVE_PEERS = MAX_TOTAL_RIDERS - 1;
export const MAX_SHARED_PEERS = MAX_ACTIVE_PEERS;

export const HEARTBEAT_INTERVAL_MS = 2500;
export const PEER_TIMEOUT_MS = 12000;

export const RECONNECT_TICK_MS = 2000;
export const RECONNECT_BACKOFF_MS = [3000, 6000, 12000, 30000];
// Hanya rekan ber-ID lebih besar yang menunggu, agar dua sisi tidak saling dial bersamaan
export const LARGER_ID_GRACE_MS = 5000;
