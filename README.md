# MatchaPro Assistant

Userscript Tampermonkey untuk membantu kegiatan **Matching Manual SBR (Sensus Ekonomi 2026)** di [MatchaPro](https://matchapro.web.bps.go.id).

Script menilai setiap data dengan aturan dari materi briefing *Teknis Pengerjaan Matching Manual* (Tim SBR, 19 Oktober 2026):

- yang **jelas** dikerjakan otomatis (Match / Unmatch),
- yang **perlu cek lokasi** dibuka dengan peta kiri-kanan dan diputuskan operator,
- yang **ragu** di-Skip untuk dikerjakan manual.

Semua aksi lewat tombol dan dialog konfirmasi resmi aplikasi, sama seperti operator mengklik sendiri. Hasil tercatat atas akun yang login.

> ⚠️ Kegiatan ini bernama *matching manual*. Konfirmasikan dulu ke pengawas / Tim SBR bahwa alat bantu ini boleh dipakai sebelum digunakan pada data asli.

## Pasang

1. Pasang ekstensi **Tampermonkey** (Chrome / Edge).
2. Chrome versi baru: buka `chrome://extensions` → Tampermonkey → **Details** → nyalakan **Allow User Scripts** (atau nyalakan *Developer mode*).
3. Tampermonkey → **Create a new script** → hapus isinya → tempel isi [`matchapro-otomatis.user.js`](matchapro-otomatis.user.js) → **Ctrl+S**.
4. Buka halaman kegiatan matching, tekan **F5** sekali.

Script hanya aktif di `https://matchapro.web.bps.go.id/matching/kegiatan/*`.

## Pakai

- Tombol ungu **MP Matching Otomatis** di kiri bawah (atau **Alt+M**) membuka panel:
  1. **Jalankan** — *Mulai otomatis* dan *Nilai data ini saja* (melihat keputusan script tanpa aksi).
  2. **Aturan & kecepatan** — saklar Match otomatis, Unmatch otomatis, Review dengan peta; kecepatan (Normal / Cepat / Kilat); batas data per jalan.
  3. **Riwayat** — semua aksi beserta alasannya, bisa difilter dan diekspor ke CSV.
- Saat berjalan, bar di tengah bawah menampilkan data yang diproses, tahap, log, serta tombol **Jeda** / **Stop**.
- Di setiap kartu kandidat muncul label: 🟢 *Kuat* · 🟠 *Cek Maps dulu* · 🔴 *Banyak beda*, plus rincian (wilayah, nama pengusaha, jenis usaha, alamat, status) dan tombol 📍 Maps.

Saran pemakaian pertama: batas **5 data**, kecepatan **Normal**, lalu periksa hasilnya di *Riwayat Hasil Matching* MatchaPro (hasil keliru bisa dibatalkan di sana).

## Aturan keputusan

Empat pertanyaan berurutan; jawaban "ya" pertama menentukan aksi.

| # | Pertanyaan | Ya → |
|---|---|---|
| 1 | Nama usaha generik tanpa nama pengusaha? | **Unmatch** (briefing aturan 1) |
| 2 | Tidak ada kandidat sama sekali? | **Unmatch** |
| 3 | Tepat 1 kandidat *kuat*, tanpa pesaing? | **Match** (aturan 2) |
| 4 | Semua kandidat *jelas bukan*? | **Unmatch** (aturan 4/5) |
| – | Ada kandidat yang mungkin cocok (aturan 3, atau ≥2 kandidat cocok) | **Review dengan peta** |
| – | Selain itu | **Skip** |

- **Kandidat kuat:** wilayah sama sampai desa; nama pengusaha sama persis (≥2 kata, atau 1 kata bila jenis usahanya juga sama); jenis usaha tidak bertentangan; bukan gudang/koperasi/kantin vs usaha induk; alamat mirip ≥60%; status AKTIF.
- **Jelas bukan:** nama pengusaha beda, jenis usaha beda, gudang/koperasi/kantin vs usaha induk, atau beda kecamatan tanpa nama pengusaha yang sama persis.
- **Wilayah** dibandingkan lewat kode berjenjang (prov → kab → kec → desa), karena kode desa tidak unik antar kecamatan.

### Review dengan peta (aturan 3)

Briefing meminta kasus "pengusaha sama, alamat sedikit beda" dicek lokasinya dulu dan direview manual. Script tidak menebak lokasi:

1. Pertama kali ditemukan → **Skip** dan diingat.
2. Saat data itu muncul lagi → script berhenti dan menampilkan **peta Google Maps di halaman**: kiri **DATA**, kanan **K1, K2, …** (kandidat rekomendasi, bisa dibuka-tutup, label sama dipasang di kartu kandidat).
3. Operator memutuskan: **M** / Enter = Match kandidat terpilih · **U** = Unmatch · **S** = Skip · **G** = kecilkan/tampilkan peta.

## Penilaian nama, alamat, dan jenis usaha

- **Nama pengusaha** diambil dari `< >` terakhir (format SBR), lalu `( )`; isi kurung lain jadi nama alternatif. Tanpa kurung, kata selain kata jenis usaha dianggap nama pengusaha. Spasi diabaikan (`Nur Baiti` = `Nurbaiti`).
- **Alamat:** nama desa/kec/kab dibuang (sudah dibandingkan lewat kode), angka romawi disamakan (`IV` = `4`), dibandingkan juga tanpa spasi (`Janjimaria` = `Janji maria`).
- **Jenis usaha:** kata peran (pedagang, jualan, warung, UTP, perkebunan, …) diabaikan; produk dibandingkan per kelompok (`kepiting ≈ ikan`, `kupi ≈ kopi`, `ulos ≈ tenun`).

Daftar kata ada di bagian atas script: `ROLE_WORDS`, `PRODUCT_GROUPS`, `GENERIC_WORDS`. Kata usaha yang terbaca sebagai nama orang cukup ditambahkan ke daftar itu.

## Data & privasi

Script tidak memanggil server sendiri. Ia membaca respons yang sudah diminta halaman (`/matching/kegiatan/{id}/data`) dan, untuk data pertama yang tertanam di HTML, membaca langsung dari tampilan. Pengaturan, riwayat, dan daftar data yang menunggu review hanya disimpan di `localStorage` browser operator.

## Tes

```bash
node tests/rules.test.js      # 24 kasus: 5 contoh briefing + 19 kasus dari uji coba data dummy
npm install && npm test       # termasuk simulasi satu putaran penuh (butuh jsdom)
```

Tambahkan kasus baru ke `tests/rules.test.js` setiap kali menemukan keputusan yang keliru, lalu pastikan semua tes tetap lolos sebelum mengubah aturan.

## Riwayat versi

- **2.4.0** — aturan diperbaiki dari uji coba 45 data dummy (multi-kurung, alamat tanpa spasi/romawi, kelompok produk, nama 1 kata, alamat menyebut desa kandidat).
- **2.3.0** — panel peta berlabel DATA / K1 / K2, kandidat bisa dibuka-tutup, kasus ≥2 kandidat cocok ikut direview.
- **2.2.0** — aturan 3: Skip dulu, saat muncul lagi tampil peta kiri-kanan di halaman.
- **2.1.0** — mode review aturan 3.
- **2.0.1** — data pertama dibaca dari tampilan halaman.
- **2.0.0** — matching otomatis dengan aturan briefing, panel, HUD, riwayat & CSV.
