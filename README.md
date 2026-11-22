# MotoMesh — Ultra-Low Latency Touring Intercom

MotoMesh adalah aplikasi web Walkie-Talkie (Push-to-Talk & Mesh Intercom) berbasis WebRTC Peer-to-Peer yang dirancang khusus untuk komunikasi rombongan touring motor. Aplikasi ini dioptimalkan agar tetap ringan, memiliki latensi sangat rendah, dan tahan terhadap kondisi jaringan seluler yang buruk maupun tidak stabil (pegunungan, pedesaan, atau area 1 bar sinyal).

## Fitur Utama

- Koneksi WebRTC P2P Mesh (Low Latency): Suara dikirim langsung antar perangkat pengendara tanpa memutar melalui server media pusat, menghasilkan jeda suara (latency) minimal.

- Optimasi Codec Opus Ultra-Low Bitrate (8 kbps):

- FEC (Forward Error Correction): Menyisipkan data pemulihan pada paket audio agar suara tetap terdengar jelas meskipun terjadi packet loss saat sinyal turun.

- DTX (Discontinuous Transmission): Pemakaian kuota data menjadi 0 KB/s saat tombol bicara tidak ditekan.

- Dukungan STUN + TURN Relay (Tembus CGNAT Seluler): Dilengkapi konfigurasi TURN Relay (UDP & TCP port 80/443) bawaan serta opsi kustomisasi kredensial (seperti Metered.ca) untuk menembus pemblokiran firewall antar operator seluler (4G/5G).

- Filter Suara Angin & Knalpot (DSP): Menggunakan Web Audio API (300Hz High-Pass Filter + Dynamics Compressor) untuk meredam deru angin di dalam helm dan suara mesin sebelum dikirim.

- Sinyal Taktis Kilat (~32 Bytes): Tombol cepat (BAHAYA, BENSIN, MENEPI, SOS) mengirimkan paket mikroskopis yang tetap terkirim pada jaringan sangat lemah, lengkap dengan antrean otomatis (offline queue) jika sinyal sempat hilang.

- Persistensi Sesi Otomatis (Anti-Refresh): Selama pengguna belum menekan tombol LEAVE, status sesi, ID rider, dan daftar rekan rombongan tersimpan otomatis sehingga halaman yang ter-refresh tidak sengaja akan langsung menyambung ulang.

- Ramah Pengendara (Glove-Friendly & Wake Lock): Tombol PTT raksasa yang mudah ditekan saat memakai sarung tangan, dukungan mode Kunci Mic, serta Screen Wake Lock API agar layar ponsel tidak mati otomatis selama perjalanan.

## Panduan Penggunaan Singkat

Masuk ke Radio: Masukkan Callsign (nama panggilan), pilih profil kompresi jaringan (disarankan 8 kbps + FEC untuk jalur pegunungan/luar kota), lalu tekan AKTIFKAN RADIO TOURING.

#### Hubungkan Rombongan:

Salin ID Anda (misal: MT-8X9K) di pojok kanan atas dan bagikan ke rekan touring.

Rekan lain cukup memasukkan ID tersebut pada kolom Masukkan ID Rider teman... lalu tekan Gabung. Koneksi akan membentuk jaringan mesh otomatis ke seluruh anggota grup.

#### Berkomunikasi:

Gunakan mode Tahan (PTT) untuk berbicara seperti handy talky, atau pilih Kunci Mic jika menggunakan intercom helm/earphone Bluetooth.

#### Mengakhiri Sesi:

Tekan tombol LEAVE di pojok kanan atas apabila touring telah selesai untuk memutus koneksi dan menonaktifkan mikrofon.

## Teknologi yang Digunakan

HTML5 & Tailwind CSS — Antarmuka gelap kontras tinggi (asphalt dark theme) yang nyaman dilihat siang maupun malam hari.

WebRTC & PeerJS — Komunikasi suara dan pertukaran data peer-to-peer secara real-time.

Web Audio API — Pemrosesan sinyal audio (High-Pass Filter, Compressor, dan generator nada konfirmasi).

Screen Wake Lock API — Mencegah layar perangkat terkunci otomatis saat aplikasi aktif.