// ==UserScript==
// @name         MatchaPro Matching Otomatis
// @namespace    hanif-bps-hst
// @version      2.4.0
// @description  Matching manual SBR (SE2026) dengan aturan briefing: yang jelas Match/Unmatch dikerjakan otomatis, yang ragu di-Skip. Badge cek di tiap kandidat, log, ekspor CSV.
// @match        https://matchapro.web.bps.go.id/matching/kegiatan/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  if (window.__mpoLoaded) return;
  window.__mpoLoaded = true;

  const APP = { name: "Matching Otomatis", version: "2.4.0", badge: "MP" };
  const CONF_KEY = "mpo_conf";
  const LOG_KEY = "mpo_log_" + location.pathname;
  const DAY_KEY = "mpo_day_" + location.pathname;

  const DEFAULT_CONF = {
    autoMatch: true, // Match otomatis untuk kasus yang jelas
    autoUnmatch: true, // Unmatch otomatis sesuai aturan briefing
    speed: 1, // indeks SPEEDS
    limit: 100, // maksimal data per sekali jalan
    reviewRule3: true, // aturan 3 (perlu cek Maps): berhenti & tanya operator, bukan langsung Skip
  };
  const SPEEDS = [
    { name: "Normal", gap: [4000, 7000] },
    { name: "Cepat", gap: [2000, 4000] },
    { name: "Kilat", gap: [900, 1800] },
  ];
  const ACT = {
    MATCH: { label: "Match", color: "#16a34a" },
    UNMATCH: { label: "Unmatch", color: "#ea580c" },
    SKIP: { label: "Skip", color: "#6366f1" },
    ERROR: { label: "Gagal", color: "#dc2626" },
  };

  /* =========================================================================
     UTILITAS
     ========================================================================= */
  const loadJson = (k, fb) => {
    try {
      return JSON.parse(localStorage.getItem(k)) || fb;
    } catch (e) {
      return fb;
    }
  };
  const saveJson = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };
  const loadConf = () => ({ ...DEFAULT_CONF, ...loadJson(CONF_KEY, {}) });
  const saveConf = (c) => saveJson(CONF_KEY, c);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = ([a, b]) => a + Math.random() * (b - a);
  const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD lokal
  const hhmm = (t) => new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  async function waitFor(check, ms, poll = 120) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (run.stop) return null;
      const r = check();
      if (r) return r;
      await sleep(poll);
    }
    return null;
  }

  /* =========================================================================
     ATURAN BRIEFING (penilaian kandidat)
     ========================================================================= */
  // Kata PERAN/BIDANG UMUM: menandai usaha tapi tidak menyebut produk (tidak dipakai untuk "jenis usaha beda")
  const ROLE_WORDS = (
    "usaha dagang pedagang penjual jualan jual beli warung toko kios kedai depot keude industri pabrik produksi " +
    "pembuat pembuatan pengrajin perajin pengolahan pengelola jasa utp upt rumahan rumah kecil keliling perdagangan " +
    "penyediaan eceran ecer enceran grosir agen pangkalan usaha di baru jaya sumber makmur abadi maju sejahtera mandiri berkah " +
    "barokah rezeki rejeki bersama perkebunan kebun pertanian tani petani tanaman pangan hortikultura peternakan ternak " +
    "perikanan budidaya tambak kolam makanan minuman olahan penangkapan home online shop olshop sewa"
  ).split(/\s+/);
  // Kelompok PRODUK: kata dalam satu baris dianggap jenis usaha yang sama (kepiting ~ ikan, kupi ~ kopi, ...)
  const PRODUCT_GROUPS = [
    "ikan kepiting udang cumi kerang seafood laut asin teri",
    "kelontong sembako harian kebutuhan pokok campuran klontong",
    "kopi kupi",
    "padi beras gabah penggilingan kilang huller",
    "tenun bertenun tenunan ulos kain songket",
    "furnitur furniture mebel meubel perabot kayu",
    "sayur sayuran",
    "tembakau kretek rajang perajangan merajang",
    "mie mi bakso",
    "kue kerupuk opak jajanan ringan snack gorengan roti keripik",
    "bengkel las tambal ban",
    "motor mobil",
    "bangunan material besi semen",
    "pulsa konter hp ponsel handphone elektronik",
    "pangkas rambut barber salon",
    "jahit penjahit menjahit konveksi",
    "pakaian baju busana",
    "batu bata",
    "pasir tambang galian penggalian penggali",
    "nasi lontong sarapan",
    "isi ulang air minum galon",
    "ojek angkutan angkot becak bentor sopir",
    "anyaman tikar pandan",
    "sawit", "karet", "pinang", "kelapa", "kakao coklat cokelat", "cabai cabe rawit", "nilam", "sereh sere wangi",
    "jagung", "gula aren", "tahu tempe", "sapi kambing", "ayam bebek", "perahu kapal", "pupuk", "bensin bbm minyak",
    "fotocopy fotokopi photocopy percetakan", "laundry cuci", "apotek obat", "kue",
  ];
  const PRODUCT_OF = new Map();
  PRODUCT_GROUPS.forEach((g, i) => g.split(/\s+/).forEach((w) => PRODUCT_OF.set(w, i)));
  // Kata jenis usaha / kata umum (bukan nama orang). Tambah di sini kalau ada yang salah terbaca.
  const GENERIC_WORDS = new Set([
    ...ROLE_WORDS,
    ...PRODUCT_OF.keys(),
    ...(
      "isi ulang air minum online ojol daging goreng padang makan minum cafe kafe studio game warnet photo " +
      "pandai pertukangan tukang kakao sepatu tas emas krim jus es soto sate pecel lele apotek klinik praktek bidan " +
      "les bimbel rental steam gula merah tahu tempe lahan barang pakaian kecil rumahan"
    ).split(/\s+/),
  ]);
  const SPECIAL_UNIT = ["gudang", "koperasi", "kantin"];
  const STOP = new Set(
    ("dan yang dari pada atau dengan untuk jalan jln jl gang gg lr lorong blok nomor no rt rw kab kec kel prov " +
      "kota kabupaten kecamatan kelurahan desa ds dusun dsn lingkungan lk pt cv tbk ud fa bin binti bpk " +
      "pak ibu bu h hj kak mak wak bg").split(" "),
  );
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const tokens = (s) => [...new Set(norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)))];
  const squash = (arr) => arr.join("");
  const overlap = (a, b) => {
    if (!a.length || !b.length) return 0;
    const B = new Set(b);
    return a.filter((t) => B.has(t)).length / a.length;
  };
  // Kemiripan dua nama orang: 1 = sama persis (spasi diabaikan: "nur baiti" = "nurbaiti")
  const nameSim = (x, y) => {
    if (!x.length || !y.length) return 0;
    if (squash(x) === squash(y)) return 1;
    return Math.min(overlap(x, y), overlap(y, x));
  };
  const nameContains = (x, y) => x.length && y.length && (overlap(x, y) === 1 || overlap(y, x) === 1);

  // "NAMA USAHA (PEMILIK)" / "NAMA USAHA <PEMILIK>". Format SBR menaruh pemilik di <...> TERAKHIR,
  // jadi itu yang diutamakan; isi kurung lain ("( CUT ERA )") ikut jadi nama alternatif.
  function splitName(raw) {
    const s = String(raw || "");
    const brackets = [...s.matchAll(/[(<]\s*([^)>]*?)\s*[)>]/g)].filter((m) => tokens(m[1]).length);
    const angle = brackets.filter((m) => m[0].startsWith("<"));
    const main = (angle.length ? angle : brackets).at(-1);
    let rest = s;
    brackets.forEach((m) => (rest = rest.replace(m[0], " ")));
    rest = rest.replace(/[<>()]/g, " ");
    const bizTok = tokens(rest);
    const productsOf = (toks) => [...new Set(toks.filter((t) => PRODUCT_OF.has(t)).map((t) => PRODUCT_OF.get(t)))];
    if (!brackets.length && bizTok.length && bizTok.every((t) => !GENERIC_WORDS.has(t)))
      return { owner: bizTok, alts: [bizTok], business: [], generic: [], products: [] }; // seluruhnya nama orang
    const implicit = !brackets.length ? bizTok.filter((t) => !GENERIC_WORDS.has(t)) : [];
    const extra = brackets.length ? bizTok.filter((t) => !GENERIC_WORDS.has(t)) : [];
    const owner = main ? tokens(main[1]) : implicit;
    const alts = [owner, ...brackets.map((m) => tokens(m[1])), ...(extra.length ? [extra] : [])].filter((t) => t.length);
    return {
      owner,
      alts,
      business: bizTok,
      generic: bizTok.filter((t) => GENERIC_WORDS.has(t)),
      products: productsOf(bizTok),
    };
  }
  function isGenericName(nm) {
    const p = splitName(nm);
    return !p.owner.length && p.business.length > 0;
  }

  // Alamat: angka romawi -> angka, nama desa/kec/kab dibuang (sudah dibandingkan lewat kode wilayah)
  const ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12" };
  const addrRaw = (s) =>
    [...new Set(norm(s).split(" ").map((t) => ROMAN[t] || t).filter((t) => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t))))];
  function addrSimilarity(tm, cand) {
    const drop = new Set([tm.nmdesa, tm.nmkec, tm.nmkab, cand.nmdesa, cand.nmkec, cand.nmkab].flatMap((x) => addrRaw(x)));
    const A = addrRaw(tm.alamat).filter((t) => !drop.has(t));
    const B = addrRaw(cand.alamat).filter((t) => !drop.has(t));
    if (!A.length || !B.length) return 0;
    const informative = (x) => squash(x).length >= 5;
    let s = Math.max(overlap(A, B), informative(B) ? overlap(B, A) : 0);
    // "janjimaria" vs "janji maria", "mataie" vs "mata ie": bandingkan tanpa spasi
    const ra = squash(A), rb = squash(B);
    const [sh, lo] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
    if (sh.length >= 5 && lo.includes(sh)) s = 1;
    return Math.round(s * 100);
  }
  // Alamat salah satu menyebut nama desa yang lain (kode desa beda, tapi teks alamat menunjuk desa yang sama)
  function mentionsDesa(tm, cand) {
    const hit = (alamat, desa) => {
      const d = addrRaw(desa);
      return d.length > 0 && squash(d).length >= 4 && squash(addrRaw(alamat)).includes(squash(d));
    };
    return hit(tm.alamat, cand.nmdesa) || hit(cand.alamat, tm.nmdesa);
  }

  function analyze(cand, tm) {
    const notes = [];
    const same = (k) => String(cand[k] || "") === String(tm[k] || "");
    const f = {}; // fakta untuk keputusan otomatis

    // Wilayah (kode desa tidak unik antar kecamatan -> bandingkan berjenjang)
    if (!same("kdprov") || !same("kdkab")) {
      f.wil = "kab";
      notes.push({ lvl: "bad", text: "Kab/Kota beda" });
    } else if (!same("kdkec")) {
      f.wil = "kec";
      notes.push({ lvl: "bad", text: `Kec beda (${cand.nmkec || cand.kdkec})` });
    } else if (!same("kddesa")) {
      f.wil = "desa";
      notes.push({ lvl: "warn", text: `Desa beda (${cand.nmdesa || cand.kddesa})` });
    } else {
      f.wil = "same";
      notes.push({ lvl: "ok", text: "Wilayah sama s.d. desa" });
    }
    f.mentionsDesa = f.wil !== "same" && mentionsDesa(tm, cand);
    if (f.mentionsDesa) notes.push({ lvl: "warn", text: "Alamat menyebut desa yang lain → cek peta" });

    const a = splitName(tm.nama);
    const b = splitName(cand.nama);
    f.generic = isGenericName(tm.nama);
    if (f.generic) notes.push({ lvl: "bad", text: "Nama generik tanpa pengusaha (aturan 1)" });

    // Nama pengusaha: kemiripan terbaik di antara semua nama dalam kurung
    f.ownerBoth = !!(a.alts.length && b.alts.length);
    f.ownerSim = 0;
    f.ownerWords = a.owner.length;
    f.ownerContain = false;
    a.alts.forEach((x) =>
      b.alts.forEach((y) => {
        const sim = nameSim(x, y);
        if (sim > f.ownerSim || (sim === f.ownerSim && sim === 1 && x.length > f.ownerWords)) {
          f.ownerSim = sim;
          if (sim === 1) f.ownerWords = Math.max(x.length, y.length);
        }
        if (nameContains(x, y)) f.ownerContain = true;
      }),
    );
    if (f.ownerBoth) {
      if (f.ownerSim === 1)
        notes.push(f.ownerWords < 2 ? { lvl: "warn", text: "Nama pengusaha sama (1 kata)" } : { lvl: "ok", text: "Nama pengusaha sama" });
      else if (f.ownerContain) notes.push({ lvl: "warn", text: "Nama pengusaha sebagian sama" });
      else if (f.ownerSim > 0) notes.push({ lvl: "warn", text: "Nama pengusaha mirip sebagian" });
      else notes.push({ lvl: "bad", text: "Nama pengusaha beda" });
    }

    // Jenis usaha beda (aturan 4): dibandingkan per kelompok produk, kata peran ("pedagang", "jualan") diabaikan
    f.bizDiff = f.ownerSim > 0 && a.products.length > 0 && b.products.length > 0 && !a.products.some((g) => b.products.includes(g));
    f.sameBiz = (a.products.length && b.products.length && a.products.some((g) => b.products.includes(g))) ||
      overlap(a.generic, b.generic) > 0 || (!a.generic.length && !b.generic.length);
    if (f.bizDiff) notes.push({ lvl: "bad", text: "Jenis usaha beda (aturan 4)" });

    const sa = SPECIAL_UNIT.filter((w) => norm(tm.nama).split(" ").includes(w));
    const sb = SPECIAL_UNIT.filter((w) => norm(cand.nama).split(" ").includes(w));
    f.special = sa.join() !== sb.join();
    if (f.special) notes.push({ lvl: "bad", text: `${[...sa, ...sb].join("/")} vs usaha induk (aturan 5)` });

    f.addrSim = addrSimilarity(tm, cand);
    notes.push(
      f.addrSim >= 60
        ? { lvl: "ok", text: `Alamat mirip ${f.addrSim}%` }
        : { lvl: "warn", text: `Alamat beda (${f.addrSim}%) → cek Maps` },
    );

    f.aktif = String(cand.status_perusahaan || "").toUpperCase() === "AKTIF";
    if (!f.aktif) notes.push({ lvl: "warn", text: `Status ${cand.status_perusahaan || "?"}` });

    // Jelas cocok (aturan 2): desa sama, pengusaha sama persis, alamat mirip, usaha tidak bertentangan, AKTIF.
    // Nama pengusaha 1 kata boleh, asal jenis usahanya juga sama (contoh: KIOS LAILAWATI ↔ Kios <Lailawati>).
    f.strong =
      f.wil === "same" && !f.generic && f.ownerBoth && f.ownerSim === 1 && (f.ownerWords >= 2 || f.sameBiz) &&
      !f.bizDiff && !f.special && f.addrSim >= 60 && f.aktif;
    // Jelas bukan: pengusaha beda / jenis usaha beda / gudang-koperasi-kantin / beda kec & pengusaha tidak sama persis
    f.hardFail =
      (f.ownerBoth && f.ownerSim === 0 && !f.ownerContain) || f.bizDiff || f.special ||
      ((f.wil === "kec" || f.wil === "kab") && f.ownerSim < 1 && !f.mentionsDesa);

    const nBad = notes.filter((n) => n.lvl === "bad").length;
    const nWarn = notes.filter((n) => n.lvl === "warn").length;
    const verdict = f.strong
      ? { lvl: "ok", text: "Kuat" }
      : nBad
        ? { lvl: "bad", text: "Banyak beda" }
        : nWarn
          ? { lvl: "warn", text: "Cek Maps dulu" }
          : { lvl: "ok", text: "Mirip" };
    return { notes, verdict, f, warnings: notes.filter((n) => n.lvl !== "ok") };
  }

  // Keputusan untuk satu data: { action, idsbr?, reason }
  function decide(tm, cands, conf) {
    if (!tm) return { action: null, reason: "data belum terbaca" };
    const an = cands.map((c) => ({ c, a: analyze(c, tm) }));
    if (isGenericName(tm.nama)) {
      return conf.autoUnmatch
        ? { action: "UNMATCH", reason: "Aturan 1: nama usaha generik tanpa nama pengusaha" }
        : { action: "SKIP", reason: "Nama generik (Unmatch otomatis dimatikan)" };
    }
    if (!an.length) {
      return conf.autoUnmatch
        ? { action: "UNMATCH", reason: "Tidak ada kandidat sama sekali" }
        : { action: "SKIP", reason: "Tidak ada kandidat (Unmatch otomatis dimatikan)" };
    }
    const idOf = (c) => String(c.idsbr || c.perusahaan_id);
    // Kandidat rekomendasi untuk dibandingkan di peta: desa sama, pengusaha sama persis (≥2 kata), usaha tidak bertentangan.
    // Urut: AKTIF dulu, lalu alamat paling mirip.
    const recs = an
      .filter((x) => {
        const f = x.a.f;
        if (!f.ownerBoth || f.bizDiff || f.special) return false;
        // desa sama: pengusaha sama persis (1 kata pun) atau salah satu nama memuat yang lain (Zulmahdi ↔ Zulmahdi Anggara)
        if (f.wil === "same") return f.ownerSim === 1 || f.ownerContain;
        // kode desa beda tapi alamat menyebut desa kandidat (contoh: alamat data "...DESA PASIR", kandidat di Desa Pasir)
        if (f.ownerSim === 1 && f.mentionsDesa) return true;
        // nama pengusaha panjang & unik (≥3 kata) sama persis, masih satu kabupaten
        return f.ownerSim === 1 && f.ownerWords >= 3 && f.wil !== "kab";
      })
      .sort(
        (x, y) =>
          (y.a.f.wil === "same") - (x.a.f.wil === "same") || y.a.f.ownerSim - x.a.f.ownerSim ||
          y.a.f.aktif - x.a.f.aktif || y.a.f.addrSim - x.a.f.addrSim,
      );
    // Kasus yang perlu dilihat di peta (aturan 3 / beberapa kandidat cocok): Skip dulu, review saat muncul lagi
    const reviewOf = (reason) => ({
      action: "SKIP",
      rule3: true,
      idsbr: idOf(recs[0].c),
      cand: recs[0].c.nama,
      candObj: recs[0].c,
      recs: recs.map((x) => ({ idsbr: idOf(x.c), c: x.c, addrSim: x.a.f.addrSim, aktif: x.a.f.aktif, wil: x.a.f.wil, part: x.a.f.ownerSim < 1 })),
      reason,
    });
    const strong = an.filter((x) => x.a.f.strong);
    if (strong.length === 1) {
      const s = strong[0];
      // Ada kandidat lain yang pemiliknya juga sama persis di desa yang sama -> bisa jadi duplikat, bandingkan di peta
      const rival = an.find((x) => x !== s && x.a.f.wil === "same" && x.a.f.ownerSim === 1 && !x.a.f.hardFail);
      if (rival)
        return recs.length
          ? reviewOf(`Ragu: ${recs.length} kandidat dengan pengusaha sama di desa ini → bandingkan di peta`)
          : { action: "SKIP", reason: `Ragu: ada 2 kandidat dengan pengusaha sama (${s.c.nama} / ${rival.c.nama})` };
      return conf.autoMatch
        ? {
            action: "MATCH",
            idsbr: String(s.c.idsbr || s.c.perusahaan_id),
            cand: s.c.nama,
            reason: `Aturan 2: pengusaha sama, wilayah sama s.d. desa, alamat ${s.a.f.addrSim}%`,
          }
        : { action: "SKIP", reason: "Ada kandidat kuat (Match otomatis dimatikan)" };
    }
    if (strong.length > 1) return reviewOf(`Ragu: ${strong.length} kandidat sama-sama kuat → bandingkan di peta`);
    if (an.every((x) => x.a.f.hardFail)) {
      const why = [];
      if (an.some((x) => x.a.f.bizDiff)) why.push("jenis usaha beda");
      if (an.some((x) => x.a.f.special)) why.push("gudang/koperasi/kantin");
      if (an.some((x) => x.a.f.ownerBoth && x.a.f.ownerSim === 0)) why.push("pengusaha beda");
      if (an.some((x) => x.a.f.wil === "kec" || x.a.f.wil === "kab")) why.push("beda kecamatan");
      return conf.autoUnmatch
        ? { action: "UNMATCH", reason: `Semua ${an.length} kandidat jelas bukan: ${why.join(", ")}` }
        : { action: "SKIP", reason: "Semua kandidat bukan (Unmatch otomatis dimatikan)" };
    }
    // Aturan 3: pengusaha sama persis (≥2 kata), desa sama, jenis usaha tidak bertentangan, AKTIF, tapi alamat beda
    // -> briefing: Match SETELAH cek Google Maps. Script tidak bisa melihat peta -> Skip, atau ditanyakan ke operator (mode review).
    if (recs.length) {
      const t = recs[0].a.f;
      const why =
        t.wil !== "same"
          ? t.mentionsDesa
            ? "pengusaha sama, kode desa beda tapi alamat menyebut desa kandidat"
            : `pengusaha sama (${t.ownerWords} kata), beda ${t.wil === "kec" ? "kecamatan" : "desa"}`
          : t.ownerSim < 1
            ? "desa sama, nama pengusaha sebagian sama"
            : t.addrSim >= 60
              ? "pengusaha & desa sama, perlu konfirmasi"
              : `pengusaha & desa sama, alamat beda (${t.addrSim}%)`;
      return reviewOf(
        recs.length === 1 ? `Aturan 3: ${why} → cek peta` : `${recs.length} kandidat mungkin cocok (${why}) → bandingkan di peta`,
      );
    }
    const best = an.filter((x) => !x.a.f.hardFail).sort((x, y) => y.a.f.ownerSim - x.a.f.ownerSim || y.a.f.addrSim - x.a.f.addrSim)[0];
    const doubt = best ? best.a.warnings.map((w) => w.text).join(", ") : "";
    return {
      action: "SKIP",
      idsbr: best ? String(best.c.idsbr || best.c.perusahaan_id) : "",
      candObj: best ? best.c : null,
      reason: `Ragu${best ? ` (${best.c.nama}: ${doubt || "perlu cek"})` : ""}`,
    };
  }

  /* =========================================================================
     DATA DARI HALAMAN (event global jQuery; XHR di halaman ini dibungkus Pace.js)
     ========================================================================= */
  const state = { toMatch: null, cands: [], byId: {}, analysis: {}, seq: 0 };
  let dataWaiters = [];

  function onAjaxComplete(event, xhr, settings) {
    try {
      const url = String(settings.url || "");
      const type = String(settings.type || settings.method || "").toUpperCase();
      const body = typeof settings.data === "string" ? settings.data : "";
      if (/\/matching\/kegiatan\/\d+\/data$/.test(url)) {
        const r = xhr.responseJSON || JSON.parse(xhr.responseText || "null");
        if (r) onNewData(r);
      } else if (/\/matching\/kegiatan\/\d+$/.test(url) && type === "POST") {
        const st = decodeURIComponent(((body.match(/status=([^&]*)/) || [])[1] || "").replace(/\+/g, " "));
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (!ok) run.lastError = (xhr.responseJSON && xhr.responseJSON.message) || `HTTP ${xhr.status}`;
        if (ok && st && !run.active) countDay(st); // aksi manual juga dihitung
      }
    } catch (e) {
      console.warn(`[${APP.name}]`, e);
    }
  }

  function onNewData(r) {
    state.seq++;
    state.toMatch = r.to_match && !Array.isArray(r.to_match) && Object.keys(r.to_match).length ? r.to_match : null;
    state.cands = r.to_possible || [];
    state.byId = {};
    state.analysis = {};
    if (state.toMatch)
      state.cands.forEach((c) => {
        const id = String(c.idsbr || c.perusahaan_id);
        state.byId[id] = c;
        state.analysis[id] = analyze(c, state.toMatch);
      });
    const w = dataWaiters;
    dataWaiters = [];
    w.forEach((fn) => fn());
    setTimeout(decorate, 150);
    setTimeout(decorate, 600);
  }
  // Data PERTAMA saat halaman dibuka sudah tertanam di HTML (tidak lewat /data), jadi dibaca dari tampilan.
  // Dipakai juga sebagai pengaman: kalau data di layar beda dengan yang terakhir dibaca, baca ulang dari layar.
  function readFromDom() {
    const val = (id) => ((document.getElementById(id) || {}).value || "").trim();
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const codeName = (el) => {
      // "<span class='mp-tag'>019</span> RIMO" atau "005 · KAMPUNG BARU"
      const t = txt(el).replace(/\s*·\s*/, " ");
      const m = t.match(/^(\d+)\s+(.*)$/);
      return m ? [m[1], m[2]] : ["", t];
    };
    const id = val("to_match_id");
    const namaSrc = document.getElementById("to_match_nama_display");
    const namaEl = namaSrc ? namaSrc.cloneNode(true) : null; // tanpa label DATA dari panel peta
    if (namaEl) namaEl.querySelectorAll(".mpo-klabel").forEach((b) => b.remove());
    if (!id || !namaEl) return false;
    const [kdprov, nmprov] = codeName(document.getElementById("to_match_provinsi_display"));
    const [kdkab, nmkab] = codeName(document.getElementById("to_match_kabkota_display"));
    const [kdkec, nmkec] = codeName(document.getElementById("to_match_kecamatan_display"));
    const [kddesa, nmdesa] = codeName(document.getElementById("to_match_desa_display"));
    const toMatch = {
      id_table: id,
      nama: txt(namaEl),
      alamat: txt(document.getElementById("to_match_alamat_display")),
      kdprov: val("to_match_prov") || kdprov,
      kdkab: val("to_match_kab") || kdkab,
      kdkec: val("to_match_kec") || kdkec,
      kddesa,
      nmprov,
      nmkab,
      nmkec,
      nmdesa,
    };
    const cands = Array.from(document.querySelectorAll(".mp-candidate-card[data-idsbr]")).map((card) => {
      const nameEl = card.querySelector(".mp-candidate-name");
      const clone = nameEl ? nameEl.cloneNode(true) : null;
      if (clone) clone.querySelectorAll(".mp-status-badge, .mpo-klabel").forEach((b) => b.remove());
      const tag = (k) => codeName(card.querySelector(`.mp-tag.${k}`));
      const [ckdprov, cnmprov] = tag("prov");
      const [ckdkab, cnmkab] = tag("kab");
      const [ckdkec, cnmkec] = tag("kec");
      const [ckddesa, cnmdesa] = tag("des");
      return {
        idsbr: card.getAttribute("data-idsbr"),
        nama: txt(clone) || card.getAttribute("data-name") || "",
        alamat: txt(card.querySelector(".mp-candidate-addr")) || card.getAttribute("data-addr") || "",
        status_perusahaan: txt(card.querySelector(".mp-status-badge")).toUpperCase(),
        kdprov: ckdprov, nmprov: cnmprov, kdkab: ckdkab, nmkab: cnmkab,
        kdkec: ckdkec, nmkec: cnmkec, kddesa: ckddesa, nmdesa: cnmdesa,
      };
    });
    onNewData({ to_match: toMatch, to_possible: cands, fromDom: true });
    return true;
  }
  // Pastikan yang dinilai = yang sedang tampil di layar
  function syncWithScreen() {
    const shown = ((document.getElementById("to_match_id") || {}).value || "").trim();
    if (!state.toMatch || (shown && String(state.toMatch.id_table) !== shown)) return readFromDom();
    return true;
  }

  const nextData = (ms) =>
    new Promise((resolve) => {
      const seq = state.seq;
      const t = setTimeout(() => resolve(false), ms);
      dataWaiters.push(() => {
        clearTimeout(t);
        resolve(state.seq !== seq);
      });
    });

  /* =========================================================================
     STATISTIK & LOG
     ========================================================================= */
  function loadDay() {
    const d = loadJson(DAY_KEY, null);
    return d && d.date === today() ? d : { date: today(), MATCH: 0, UNMATCH: 0, IGNORE: 0, SKIP: 0, ERROR: 0 };
  }
  function countDay(status) {
    const d = loadDay();
    const k = /FALSE/i.test(status) ? "UNMATCH" : /UNMATCH/i.test(status) ? "UNMATCH" : /MATCH/i.test(status) ? "MATCH" : String(status).toUpperCase();
    d[k] = (d[k] || 0) + 1;
    saveJson(DAY_KEY, d);
    renderLaunch();
  }
  const loadLog = () => loadJson(LOG_KEY, []);
  function addLog(entry) {
    const log = loadLog();
    log.unshift({ t: Date.now(), ...entry });
    saveJson(LOG_KEY, log.slice(0, 3000));
    if (document.querySelector(".mpo-overlay")) renderSheetBody();
  }

  /* =========================================================================
     AKSI DI HALAMAN
     ========================================================================= */
  const $ = (...a) => window.jQuery(...a);
  const swalTitle = () => (window.Swal && Swal.isVisible() && (Swal.getTitle() || {}).textContent) || "";
  const completed = () => {
    const el = document.getElementById("completed_card");
    return el && !el.classList.contains("d-none");
  };
  const reviewMode = () => {
    const m = document.getElementById("btn_match");
    const t = document.getElementById("btn_true_match");
    return (m && m.offsetParent === null) || (t && t.offsetParent !== null);
  };

  async function confirmDialog(titleRe, verify) {
    const ok = await waitFor(() => titleRe.test(swalTitle()), 6000);
    if (!ok) throw new Error(`dialog "${titleRe.source}" tidak muncul`);
    if (verify) {
      const txt = (Swal.getHtmlContainer() || {}).textContent || "";
      if (!verify(txt)) {
        Swal.clickCancel();
        throw new Error("isi dialog konfirmasi tidak sesuai kandidat yang dipilih, dibatalkan");
      }
    }
    await sleep(250);
    Swal.clickConfirm();
  }

  async function doAction(dec) {
    const wait = nextData(25000);
    run.lastError = "";
    if (dec.action === "MATCH") {
      step(2, "Memilih kandidat");
      const card = document.querySelector(`.mp-candidate-card[data-idsbr="${dec.idsbr}"]`);
      if (!card) throw new Error(`kartu kandidat IDSBR ${dec.idsbr} tidak ketemu (pastikan tampilan Kartu)`);
      $(card).trigger("click");
      const sel = await waitFor(() => {
        const s = document.querySelector(".mp-candidate-card.selected");
        return s && s.getAttribute("data-idsbr") === dec.idsbr;
      }, 3000);
      if (!sel) throw new Error("kandidat tidak terpilih");
      step(3, "Konfirmasi Match");
      $("#btn_match").trigger("click");
      await confirmDialog(/Konfirmasi Match/i, (txt) => txt.includes(dec.idsbr));
    } else if (dec.action === "UNMATCH") {
      step(3, "Konfirmasi Unmatch");
      $("#btn_unmatch").trigger("click");
      await confirmDialog(/Konfirmasi Unmatch/i);
    } else {
      step(3, "Lewati");
      $("#btn_skip").trigger("click");
      await confirmDialog(/Lewati/i);
    }
    step(4, "Menyimpan & memuat data berikutnya");
    const got = await wait;
    if (/Gagal/i.test(swalTitle()) || run.lastError) {
      const msg = run.lastError || ((Swal.getHtmlContainer() || {}).textContent || "").trim();
      if (window.Swal && Swal.isVisible()) Swal.close();
      throw new Error(`server menolak: ${msg || "tidak diketahui"}`);
    }
    if (!got && !completed()) throw new Error("data berikutnya tidak termuat (koneksi lambat?)");
  }

  /* =========================================================================
     JALANKAN OTOMATIS
     ========================================================================= */
  const run = { active: false, stop: false, pause: false, done: 0, counts: {}, skipped: new Set(), reviewed: new Set(), lines: [], step: 0, stepText: "", cur: "", lastError: "", review: null };

  function hudLog(msg) {
    run.lines.push(`${hhmm(Date.now())}  ${msg}`);
    run.lines = run.lines.slice(-4);
    renderHud();
  }
  function step(n, text) {
    run.step = n;
    run.stepText = text;
    renderHud();
  }

  /* ---------- Mode review aturan 3: operator yang cek Maps, script yang mengeksekusi ---------- */
  const placeQuery = (o) => [o.alamat, o.nmdesa, o.nmkec, o.nmkab].filter(Boolean).join(", ");
  const mapsRouteUrl = (a, b) =>
    "https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=" +
    encodeURIComponent(placeQuery(a)) + "&destination=" + encodeURIComponent(placeQuery(b));
  function openMaps(url) {
    // Satu tab "mpo-maps" dipakai ulang supaya tidak menumpuk tab baru
    const w = window.open(url, "mpo-maps");
    if (w) w.focus();
    else toast("Pop-up diblokir browser: izinkan pop-up untuk matchapro.web.bps.go.id");
  }
  // Kandidat yang sedang terpilih di halaman (operator boleh pindah kartu), cadangan: saran script
  function reviewCand() {
    const rv = run.review;
    if (!rv) return null;
    const sel = document.querySelector(".mp-candidate-card.selected");
    const id = (sel && sel.getAttribute("data-idsbr")) || rv.dec.idsbr;
    return { id, c: state.byId[id] || rv.dec.candObj || {} };
  }
  /* ---------- Panel peta di halaman (Google Maps embed, tanpa API key) ----------
     Kiri  : DATA = usaha yang sedang dicocokkan (selalu tampil)
     Kanan : K1, K2, ... = kandidat rekomendasi, tiap kandidat bisa dibuka/tutup petanya
     Label K1/K2 yang sama dipasang di kartu kandidat halaman supaya peta ↔ kartu mudah dicocokkan */
  const maps = { mode: "addr", min: false, open: new Set(), items: [], key: "" };
  const embedUrl = (o, mode) =>
    "https://www.google.com/maps?output=embed&z=16&q=" +
    encodeURIComponent(mode === "name" ? [o.nama, placeQuery(o)].filter(Boolean).join(", ") : placeQuery(o));
  const selectedId = () => {
    const s = document.querySelector(".mp-candidate-card.selected");
    return s ? s.getAttribute("data-idsbr") : "";
  };
  function mapsItems() {
    const rv = run.review;
    const recs = (rv.dec.recs && rv.dec.recs.length ? rv.dec.recs : [{ idsbr: rv.dec.idsbr, c: rv.dec.candObj || {}, addrSim: 0, aktif: true }]).map((r, i) => ({
      ...r,
      label: `K${i + 1}`,
    }));
    // Operator memilih kartu lain di luar rekomendasi -> ikut ditampilkan sebagai "Pilihan"
    const sel = selectedId();
    if (sel && !recs.some((r) => r.idsbr === sel) && state.byId[sel]) {
      const an = state.analysis[sel];
      recs.push({ idsbr: sel, c: state.byId[sel], addrSim: an ? an.f.addrSim : 0, aktif: an ? an.f.aktif : true, label: "Pilihan" });
    }
    return recs;
  }
  function mapsItemHtml(it) {
    const open = maps.open.has(it.idsbr);
    const sel = selectedId() === it.idsbr;
    const c = it.c || {};
    return `<div class="mp-item ${open ? "open" : ""} ${sel ? "sel" : ""}" data-id="${esc(it.idsbr)}">
      <div class="mp-ihead" data-toggle="${esc(it.idsbr)}">
        <span class="mp-badge cand">${esc(it.label)}</span>
        <div class="mp-iinfo"><div class="mp-n">${esc(c.nama || "-")}</div><div class="mp-a">${esc(placeQuery(c) || "-")}</div></div>
        <span class="mp-chip">alamat ${it.addrSim}%</span>${it.wil && it.wil !== "same" ? `<span class="mp-chip bad">${it.wil === "desa" ? "desa beda" : "kec beda"}</span>` : ""}${it.part ? `<span class="mp-chip bad">nama sebagian</span>` : ""}${it.aktif ? "" : `<span class="mp-chip bad">tidak aktif</span>`}
        <button class="mpo-btn sm mp-pick" data-pick="${esc(it.idsbr)}">${sel ? "✓ Dipilih" : "Pilih ini"}</button>
        <span class="mp-chev">${open ? "▾" : "▸"}</span>
      </div>
      ${open ? `<iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${embedUrl(c, maps.mode)}"></iframe>` : ""}
    </div>`;
  }
  function labelCards(items) {
    document.querySelectorAll(".mpo-klabel").forEach((x) => x.remove());
    (items || []).forEach((it) => {
      const name = document.querySelector(`.mp-candidate-card[data-idsbr="${it.idsbr}"] .mp-candidate-name`);
      if (name) name.insertAdjacentHTML("afterbegin", `<span class="mpo-klabel cand">${esc(it.label)}</span>`);
    });
    const tmName = document.getElementById("to_match_nama_display");
    if (tmName && items) tmName.insertAdjacentHTML("afterbegin", `<span class="mpo-klabel data">DATA</span>`);
  }
  // Bangun ulang panel hanya kalau isinya berubah (supaya peta tidak dimuat ulang terus-menerus)
  function showMapsPanel(force) {
    const rv = run.review;
    if (!rv) return;
    ensureStyles();
    const items = mapsItems();
    if (!maps.items.length || maps.forId !== rv.tm.id_table) {
      maps.forId = rv.tm.id_table;
      maps.open = new Set(items.slice(0, 2).map((it) => it.idsbr)); // 2 rekomendasi teratas langsung terbuka
      maps.min = false;
    }
    const sel = selectedId();
    if (sel && !maps.open.has(sel) && !items.slice(0, 2).some((it) => it.idsbr === sel)) maps.open.add(sel);
    maps.items = items;
    const key = [rv.tm.id_table, maps.mode, maps.min, sel, [...maps.open].join(","), items.map((i) => i.idsbr).join(",")].join("|");
    let p = document.getElementById("mpo-maps");
    if (p && p.dataset.key === key && !force) return;
    if (!p) {
      p = document.createElement("div");
      p.id = "mpo-maps";
      p.className = "mpo mpo-maps-panel";
      document.body.appendChild(p);
    }
    p.dataset.key = key;
    p.classList.toggle("min", maps.min);
    const tm = rv.tm;
    // Peta DATA tidak dibangun ulang kalau hanya kandidat yang berubah
    const oldData = p.querySelector("iframe[data-data]");
    const dataSrc = embedUrl(tm, maps.mode);
    p.innerHTML = `
      <div class="mp-bar">
        <b>Cek lokasi</b>
        <span>${items.length > 1 ? `${items.length} kandidat cocok: buka-tutup K1/K2 untuk membandingkan dengan DATA.` : "Bandingkan lokasi DATA (kiri) dengan kandidat (kanan)."} Berdekatan → <b>M</b> Match kandidat yang dipilih · beda → <b>U</b> Unmatch</span>
        <div class="mp-seg"><button data-mode="addr" class="${maps.mode === "addr" ? "on" : ""}">Alamat</button><button data-mode="name" class="${maps.mode === "name" ? "on" : ""}">Nama + alamat</button></div>
        <button class="mpo-btn sm" data-rv="ROUTE">Rute di tab baru</button>
        <button class="mpo-btn sm" data-rv="MAPS">${maps.min ? "▾ Tampilkan peta (G)" : "▴ Kecilkan (G)"}</button>
      </div>
      <div class="mp-grid">
        <div class="mp-side">
          <div class="mp-ihead static"><span class="mp-badge data">DATA</span>
            <div class="mp-iinfo"><div class="mp-n">${esc(tm.nama || "-")}</div><div class="mp-a">${esc(placeQuery(tm) || "-")}</div></div></div>
          <div class="mp-data-slot"></div>
        </div>
        <div class="mp-cands">${items.map(mapsItemHtml).join("")}</div>
      </div>`;
    const slot = p.querySelector(".mp-data-slot");
    if (oldData && oldData.getAttribute("src") === dataSrc) slot.replaceWith(oldData);
    else slot.outerHTML = `<iframe data-data="1" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${dataSrc}"></iframe>`;
    p.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => reviewChoose(b.dataset.rv)));
    p.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => ((maps.mode = b.dataset.mode), showMapsPanel())));
    p.querySelectorAll("[data-toggle]").forEach(
      (h) =>
        (h.onclick = (e) => {
          if (e.target.closest("[data-pick]")) return;
          const id = h.dataset.toggle;
          maps.open.has(id) ? maps.open.delete(id) : maps.open.add(id);
          showMapsPanel();
        }),
    );
    p.querySelectorAll("[data-pick]").forEach(
      (b) =>
        (b.onclick = () => {
          const card = document.querySelector(`.mp-candidate-card[data-idsbr="${b.dataset.pick}"]`);
          if (card) $(card).trigger("click");
          maps.open.add(b.dataset.pick);
          setTimeout(renderHud, 50);
        }),
    );
    labelCards(items);
  }
  function hideMapsPanel(remove) {
    const p = document.getElementById("mpo-maps");
    if (remove) {
      if (p) p.remove();
      maps.items = [];
      maps.forId = null;
      labelCards(null);
      return;
    }
    maps.min = true;
    showMapsPanel();
  }
  const mapsPanelOpen = () => !!document.getElementById("mpo-maps") && !maps.min;

  // id_table kasus aturan 3 yang sudah pernah di-Skip: muncul lagi -> dibuka dengan peta
  const R3_KEY = "mpo_r3_" + location.pathname;
  const loadR3 = () => loadJson(R3_KEY, {});
  const r3Seen = (id) => !!loadR3()[String(id)];
  function markR3(id, on) {
    const m = loadR3();
    if (on) m[String(id)] = Date.now();
    else delete m[String(id)];
    // simpan maksimal 5000 terbaru, buang yang lebih dari 30 hari
    const keep = Object.entries(m)
      .filter(([, t]) => Date.now() - t < 30 * 864e5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5000);
    saveJson(R3_KEY, Object.fromEntries(keep));
  }

  function askOperator(tm, dec) {
    return new Promise((resolve) => {
      const card = document.querySelector(`.mp-candidate-card[data-idsbr="${dec.idsbr}"]`);
      if (card) {
        $(card).trigger("click");
        card.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      run.review = {
        tm,
        dec,
        resolve: (r) => {
          run.review = null;
          hideMapsPanel(true);
          renderHud();
          resolve(r);
        },
      };
      step(2, "Menunggu keputusanmu");
      showMapsPanel();
    });
  }
  function reviewChoose(what) {
    const rv = run.review;
    if (!rv) return;
    const pick = reviewCand();
    if (what === "MAPS") return (maps.min = !maps.min), showMapsPanel(), renderHud();
    if (what === "ROUTE") return openMaps(mapsRouteUrl(rv.tm, pick.c));
    if (what === "MAPS_DATA") return openMaps(mapsUrl(rv.tm));
    if (what === "MAPS_CAND") return openMaps(mapsUrl(pick.c));
    if (what === "MATCH")
      return rv.resolve({
        action: "MATCH",
        idsbr: pick.id,
        cand: pick.c.nama || "",
        reason: `Review operator (cek Maps): Match · ${rv.dec.reason}`,
      });
    if (what === "UNMATCH") return rv.resolve({ action: "UNMATCH", reason: "Review operator (cek Maps): lokasi beda → Unmatch" });
    if (what === "SKIP") return rv.resolve({ action: "SKIP", reason: "Review operator: dilewati dulu" });
  }
  // Tombol cepat saat review: G = tampilkan/sembunyikan peta, M/Enter = Match kandidat terpilih, U = Unmatch, S = Skip
  document.addEventListener(
    "keydown",
    (e) => {
      if (!run.review || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (window.Swal && Swal.isVisible()) return;
      const k = String(e.key || "").toLowerCase();
      const map = { g: "MAPS", m: "MATCH", enter: "MATCH", u: "UNMATCH", s: "SKIP" };
      if (!map[k]) return; // ↑↓ tetap untuk pindah kandidat
      e.preventDefault();
      e.stopImmediatePropagation();
      if (k === "enter") {
        // Enter pada kartu yang sedang difokus tapi belum terpilih = pilih dulu (seperti aplikasi)
        const f = document.activeElement;
        if (f && f.classList && f.classList.contains("mp-candidate-card") && !f.classList.contains("selected")) {
          $(f).trigger("click");
          setTimeout(renderHud, 50);
          return;
        }
      }
      reviewChoose(map[k]);
    },
    true,
  );

  async function startRun() {
    if (run.active) return;
    const conf = loadConf();
    if (!window.jQuery || !window.Swal) return toast("Halaman belum siap, tunggu sebentar.");
    if (!syncWithScreen()) return toast("Data belum tampil di halaman. Tunggu halaman selesai dimuat lalu coba lagi.");
    // Aksi otomatis memilih kandidat lewat kartunya -> pastikan tampilan "Kartu" aktif
    const cardsBtn = document.querySelector('button[data-candidate-view="cards"]');
    if (cardsBtn && !cardsBtn.classList.contains("active")) cardsBtn.click();
    Object.assign(run, { active: true, stop: false, pause: false, done: 0, counts: {}, skipped: new Set(), reviewed: new Set(), lines: [], step: 0, review: null });
    closeSheet();
    hudLog(`Mulai · ${SPEEDS[conf.speed].name} · maks ${conf.limit} data`);
    let endMsg = "";
    try {
      while (!run.stop) {
        if (run.done >= conf.limit) {
          endMsg = `Batas ${conf.limit} data tercapai`;
          break;
        }
        while (run.pause && !run.stop) await sleep(400);
        if (run.stop) break;
        if (completed()) {
          endMsg = "Semua data kegiatan ini sudah diproses 🎉";
          break;
        }
        if (reviewMode()) {
          endMsg = "Halaman masuk mode review (True/False Match): kerjakan manual";
          break;
        }
        step(1, "Membaca & menilai data");
        syncWithScreen();
        const tm = state.toMatch;
        if (!tm) {
          endMsg = "Data tidak terbaca, tekan F5 lalu Mulai lagi";
          break;
        }
        run.cur = tm.nama;
        const tid = String(tm.id_table);
        let dec = decide(tm, state.cands, conf);
        const isR3 = dec.rule3 && conf.reviewRule3;
        // Data yang sudah di-Skip muncul lagi = antrean berputar. Kecuali kasus aturan 3 yang belum di-review di jalan ini.
        if (run.skipped.has(tid) && !(isR3 && !run.reviewed.has(tid))) {
          endMsg = "Data yang sudah di-Skip muncul lagi: sisanya yang ragu, kerjakan manual";
          break;
        }
        if (isR3 && !r3Seen(tid)) {
          // Aturan 3, pertama kali ketemu: Skip dulu, diingat. Saat muncul lagi baru dibuka dengan peta.
          markR3(tid, true);
          dec = { ...dec, reason: `${dec.reason} · di-Skip dulu, dibuka dengan peta saat muncul lagi` };
        } else if (isR3) {
          // Aturan 3, sudah pernah di-Skip: tampilkan peta kiri-kanan, operator yang memutuskan
          hudLog(`Review aturan 3 · ${tm.nama}`);
          run.reviewed.add(tid);
          const pick = await askOperator(tm, dec);
          if (!pick || run.stop) break;
          if (pick.action !== "SKIP") markR3(tid, false);
          dec = pick;
        }
        hudLog(`${ACT[dec.action].label} · ${tm.nama}`);
        try {
          await doAction(dec);
        } catch (e) {
          if (run.stop) break;
          run.counts.ERROR = (run.counts.ERROR || 0) + 1;
          addLog({ action: "ERROR", nama: tm.nama, alamat: tm.alamat, wil: `${tm.nmkec || ""} / ${tm.nmdesa || ""}`, reason: e.message, id: tm.id_table });
          endMsg = `Berhenti: ${e.message}`;
          break;
        }
        if (dec.action === "SKIP") run.skipped.add(String(tm.id_table));
        run.done++;
        run.counts[dec.action] = (run.counts[dec.action] || 0) + 1;
        countDay(dec.action);
        addLog({
          action: dec.action,
          nama: tm.nama,
          alamat: tm.alamat,
          wil: `${tm.nmkec || ""} / ${tm.nmdesa || ""}`,
          cand: dec.cand || "",
          idsbr: dec.idsbr || "",
          reason: dec.reason,
          id: tm.id_table,
        });
        step(5, "Jeda sebelum data berikutnya");
        const gap = rand(SPEEDS[loadConf().speed].gap);
        const end = Date.now() + gap;
        while (Date.now() < end && !run.stop) await sleep(150);
      }
      if (run.stop && !endMsg) endMsg = "Dihentikan";
    } finally {
      run.active = false;
      run.review = null;
      hideMapsPanel(true);
      run.step = 0;
      hudLog(endMsg || "Selesai");
      renderHud(true);
      toast(endMsg || "Selesai");
    }
  }

  /* =========================================================================
     BADGE DI KARTU KANDIDAT
     ========================================================================= */
  function mapsUrl(o) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([o.nama, o.alamat, o.nmdesa, o.nmkec, o.nmkab].filter(Boolean).join(", "));
  }
  const badge = (n) => `<span class="mpo-b ${n.lvl}">${esc(n.text)}</span>`;

  function decorate() {
    if (!state.toMatch) return;
    document.querySelectorAll(".mp-candidate-card[data-idsbr]").forEach((card) => {
      const id = card.getAttribute("data-idsbr");
      const an = state.analysis[id];
      const c = state.byId[id];
      if (!an || !c || card.dataset.mpoFor === String(state.toMatch.id_table)) return;
      card.querySelectorAll(".mpo-box").forEach((x) => x.remove());
      card.dataset.mpoFor = state.toMatch.id_table;
      const box = document.createElement("div");
      box.className = "mpo-box";
      box.innerHTML =
        `<span class="mpo-v ${an.verdict.lvl}">${esc(an.verdict.text)}</span>` +
        an.notes.map(badge).join("") +
        `<a class="mpo-maps" target="_blank" rel="noopener" href="${mapsUrl(c)}">📍 Maps</a>`;
      box.addEventListener("click", (e) => e.stopPropagation());
      (card.querySelector(".mp-candidate-body") || card).appendChild(box);
    });
    const alamatEl = document.getElementById("to_match_alamat_display");
    if (alamatEl) {
      document.getElementById("mpo-tm")?.remove();
      const div = document.createElement("div");
      div.id = "mpo-tm";
      div.className = "mpo-box";
      const p = splitName(state.toMatch.nama);
      const dec = decide(state.toMatch, state.cands, loadConf());
      let html = isGenericName(state.toMatch.nama)
        ? badge({ lvl: "bad", text: "Nama generik" })
        : p.owner.length
          ? badge({ lvl: p.owner.length >= 2 ? "ok" : "warn", text: "Pengusaha: " + p.owner.join(" ") })
          : "";
      html += `<span class="mpo-v ${dec.action === "MATCH" ? "ok" : dec.action === "UNMATCH" ? "bad" : "warn"}" title="${esc(dec.reason)}">Script: ${dec.rule3 && loadConf().reviewRule3 ? (r3Seen(state.toMatch.id_table) ? "Review dengan peta" : "Skip dulu (aturan 3)") : ACT[dec.action].label}</span>`;
      html += `<a class="mpo-maps" style="margin-left:0" target="_blank" rel="noopener" href="${mapsUrl(state.toMatch)}">📍 Maps</a>`;
      div.innerHTML = html;
      alamatEl.parentElement.appendChild(div);
    }
  }

  // Peringatan di dialog Match manual (bukan saat otomatis)
  function hookSwal() {
    const S = window.Swal;
    if (!S || S.__mpo) return !!S;
    const orig = S.fire.bind(S);
    S.fire = function (opts, ...rest) {
      try {
        if (!run.active && opts && typeof opts === "object" && /Konfirmasi (Match|True Match)/.test(opts.title || "")) {
          const sel = document.querySelector(".mp-candidate.selected");
          const an = sel && state.analysis[sel.getAttribute("data-idsbr")];
          if (an && an.warnings.length)
            opts = Object.assign({}, opts, {
              html:
                (opts.html || "") +
                `<div class="mpo-swal-warn"><strong>⚠ Perhatikan sebelum Match:</strong><ul>${an.warnings.map((w) => `<li>${esc(w.text)}</li>`).join("")}</ul></div>`,
              focusCancel: true,
            });
        }
      } catch (e) {}
      return orig(opts, ...rest);
    };
    S.__mpo = true;
    return true;
  }

  /* =========================================================================
     TAMPILAN (gaya sama dengan skrip FASIH)
     ========================================================================= */
  function ensureStyles() {
    if (document.getElementById("mpo-style")) return;
    const style = document.createElement("style");
    style.id = "mpo-style";
    style.textContent = `
      .mpo, .mpo * { box-sizing:border-box; font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
      .mpo { --bg:#ffffff; --bg2:#f6f7fb; --line:#e7e8ef; --tx:#0f1222; --mut:#6b7186; --acc:#4f46e5; --acc2:#7c3aed; color:var(--tx); }
      .mpo button { font:inherit; }
      @keyframes mpofade { from{opacity:0} to{opacity:1} }
      @keyframes mposlide { from{transform:translateX(24px);opacity:.4} to{transform:none;opacity:1} }
      @keyframes mpospin { to{transform:rotate(360deg)} }
      .mpo-overlay { position:fixed; inset:0; z-index:1000001; background:rgba(15,18,34,.38); backdrop-filter:blur(3px); display:flex; justify-content:flex-end; animation:mpofade .18s ease; }
      .mpo-sheet { background:var(--bg2); width:min(760px,100vw); height:100vh; display:flex; flex-direction:column; box-shadow:-20px 0 60px rgba(15,18,34,.25); animation:mposlide .22s ease; }
      .mpo-head { position:relative; padding:20px 24px 18px; color:#fff; background:linear-gradient(120deg,#4338ca,#7c3aed 55%,#c026d3); overflow:hidden; }
      .mpo-head:after { content:""; position:absolute; right:-60px; top:-80px; width:240px; height:240px; border-radius:50%; background:rgba(255,255,255,.09); }
      .mpo-head .row1 { display:flex; align-items:center; gap:14px; position:relative; z-index:1; }
      .mpo-logo { width:44px; height:44px; border-radius:12px; background:rgba(255,255,255,.18); display:grid; place-items:center; font-weight:800; font-size:13px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.25); }
      .mpo-title { font-size:18px; font-weight:750; letter-spacing:-.2px; }
      .mpo-sub { font-size:12.5px; opacity:.85; margin-top:2px; }
      .mpo-x { margin-left:auto; width:34px; height:34px; border-radius:10px; border:none; background:rgba(255,255,255,.16); color:#fff; font-size:18px; cursor:pointer; }
      .mpo-x:hover { background:rgba(255,255,255,.28); }
      .mpo-prog { position:relative; z-index:1; margin-top:16px; }
      .mpo-prog .track { height:8px; border-radius:99px; background:rgba(255,255,255,.2); overflow:hidden; display:flex; }
      .mpo-prog .seg { height:100%; transition:width .4s ease; }
      .mpo-prog .lbl { display:flex; justify-content:space-between; font-size:12px; margin-top:6px; opacity:.9; }
      .mpo-body { flex:1; overflow:auto; padding:18px 24px 28px; display:flex; flex-direction:column; gap:14px; }
      .mpo-card { background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:16px; box-shadow:0 1px 2px rgba(15,18,34,.04); }
      .mpo-sec { font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--mut); margin-bottom:12px; }
      .mpo-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .mpo-btn { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--bg); color:var(--tx); border-radius:10px; padding:8px 13px; font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; }
      .mpo-btn:hover { border-color:#c7c9d9; background:#fafaff; transform:translateY(-1px); }
      .mpo-btn.primary { background:linear-gradient(120deg,var(--acc),var(--acc2)); border-color:transparent; color:#fff; box-shadow:0 6px 16px rgba(79,70,229,.3); }
      .mpo-btn.soft { background:#eef0ff; border-color:#e0e3ff; color:var(--acc); }
      .mpo-btn.ghost { border-color:transparent; background:transparent; color:var(--mut); }
      .mpo-btn.sm { padding:5px 9px; font-size:12px; border-radius:8px; }
      .mpo-hint { font-size:12px; color:var(--mut); line-height:1.5; }
      .mpo-seg { display:inline-flex; background:#f0f1f6; border-radius:10px; padding:3px; gap:2px; }
      .mpo-seg button { border:none; background:transparent; padding:6px 12px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--mut); cursor:pointer; }
      .mpo-seg button.on { background:var(--bg); color:var(--acc); box-shadow:0 1px 3px rgba(15,18,34,.12); }
      .mpo-tog { display:flex; align-items:flex-start; gap:10px; padding:7px 0; cursor:pointer; font-size:13px; }
      .mpo-tog input { display:none; }
      .mpo-tog .sw { flex:none; width:36px; height:21px; border-radius:99px; background:#d5d7e3; position:relative; transition:background .15s; margin-top:1px; }
      .mpo-tog .sw:after { content:""; position:absolute; top:2.5px; left:2.5px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.2); transition:transform .15s; }
      .mpo-tog input:checked + .sw { background:var(--acc); }
      .mpo-tog input:checked + .sw:after { transform:translateX(15px); }
      .mpo-tog small { display:block; color:var(--mut); font-size:11.5px; margin-top:1px; }
      .mpo-num { width:80px; border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:13px; }
      .mpo-stats { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
      .mpo-stat { border:1px solid var(--line); border-radius:12px; padding:10px 11px; cursor:pointer; background:var(--bg); text-align:left; transition:all .15s; }
      .mpo-stat:hover { transform:translateY(-1px); }
      .mpo-stat.on { border-color:var(--c); box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 16%,transparent); }
      .mpo-stat .n { font-size:21px; font-weight:780; color:var(--c); letter-spacing:-.5px; }
      .mpo-stat .l { font-size:11.5px; color:var(--mut); margin-top:1px; white-space:nowrap; }
      .mpo-list { display:flex; flex-direction:column; gap:8px; }
      .mpo-item { background:var(--bg); border:1px solid var(--line); border-left:3px solid var(--c); border-radius:12px; padding:10px 14px; font-size:12.5px; }
      .mpo-item .nm { font-size:13.5px; font-weight:650; }
      .mpo-item .meta { color:var(--mut); margin-top:3px; }
      .mpo-item .why { margin-top:6px; color:var(--c); line-height:1.45; }
      .mpo-pill { display:inline-block; font-size:11px; font-weight:650; padding:2px 8px; border-radius:99px; color:var(--c); background:color-mix(in srgb,var(--c) 11%,#fff); margin-left:6px; vertical-align:1px; }
      .mpo-empty { text-align:center; padding:28px 10px; color:var(--mut); font-size:13px; }
      .mpo-launch { position:fixed; left:16px; bottom:112px; z-index:999999; display:flex; align-items:center; gap:8px; border:none; border-radius:999px; padding:10px 16px 10px 12px; background:linear-gradient(120deg,#4f46e5,#7c3aed); color:#fff; font:650 13px "Inter",ui-sans-serif,system-ui,sans-serif; cursor:pointer; box-shadow:0 10px 28px rgba(79,70,229,.4); transition:transform .15s; }
      .mpo-launch:hover { transform:translateY(-2px); }
      .mpo-launch .b { background:rgba(255,255,255,.22); border-radius:7px; padding:2px 6px; font-size:11.5px; font-weight:800; }
      .mpo-launch .c { background:rgba(0,0,0,.18); border-radius:7px; padding:2px 6px; font-size:11.5px; }
      .mpo-hud { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:1000002; width:min(640px,94vw); background:rgba(17,19,36,.92); backdrop-filter:blur(12px); color:#eef0ff; border-radius:18px; padding:14px 16px; box-shadow:0 20px 50px rgba(10,10,30,.45), inset 0 0 0 1px rgba(255,255,255,.07); font-size:13px; }
      .mpo-hud .top { display:flex; align-items:center; gap:10px; }
      .mpo-hud .spin { width:16px; height:16px; border-radius:50%; border:2.5px solid rgba(255,255,255,.2); border-top-color:#a5b4fc; animation:mpospin .8s linear infinite; flex:none; }
      .mpo-hud .spin.idle { animation:none; border-color:#86efac; }
      .mpo-hud .spin.wait { animation:none; border-color:#fbbf24; }
      .mpo-hud .ttl { font-weight:700; }
      .mpo-hud .dim { color:#9aa0c3; font-size:12px; }
      .mpo-hud .doc { margin-top:9px; font-weight:650; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mpo-hud .steps { display:flex; gap:4px; margin-top:9px; }
      .mpo-hud .st { flex:1; text-align:center; font-size:10.5px; padding:4px 2px; border-radius:7px; background:rgba(255,255,255,.06); color:#7d83a8; white-space:nowrap; }
      .mpo-hud .st.done { color:#86efac; background:rgba(34,197,94,.1); }
      .mpo-hud .st.now { color:#fff; background:linear-gradient(120deg,#4f46e5,#7c3aed); font-weight:650; }
      .mpo-hud .log { margin-top:9px; color:#c7cbf0; font-size:12px; font-family:ui-monospace,Consolas,monospace; background:rgba(0,0,0,.25); border-radius:8px; padding:6px 9px; max-height:74px; overflow:hidden; line-height:1.5; }
      .mpo-hud .log div:last-child { color:#fde68a; }
      .mpo-hud .bar { height:4px; border-radius:99px; background:rgba(255,255,255,.1); margin-top:10px; overflow:hidden; }
      .mpo-hud .bar i { display:block; height:100%; background:linear-gradient(90deg,#818cf8,#c084fc); transition:width .4s; }
      .mpo-hud .mpo-btn { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.12); color:#eef0ff; padding:6px 11px; font-size:12.5px; }
      .mpo-hud .mpo-btn:hover { background:rgba(255,255,255,.16); }
      .mpo-hud .mpo-btn.stop { background:transparent; border-color:rgba(248,113,113,.45); color:#fca5a5; }
      .mpo-hud .mpo-btn.go { background:#16a34a; border-color:#16a34a; color:#fff; }
      .mpo-hud .mpo-btn.un { background:#ea580c; border-color:#ea580c; color:#fff; }
      .mpo-hud .rv-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
      .mpo-hud .rv-card { background:rgba(255,255,255,.06); border-radius:10px; padding:8px 10px; min-width:0; }
      .mpo-hud .rv-card .k { font-size:10.5px; color:#9aa0c3; text-transform:uppercase; letter-spacing:.06em; }
      .mpo-hud .rv-card .n { font-weight:650; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mpo-hud .rv-card .a { font-size:12px; color:#c7cbf0; margin-top:2px; }
      .mpo-hud .rv-note { margin-top:8px; font-size:12px; color:#fde68a; }
      .mpo-hud .rv-acts { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; align-items:center; }
      .mpo-hud .chips { display:flex; gap:6px; margin-left:auto; }
      /* panel peta: DATA kiri, kandidat K1/K2 kanan */
      .mpo-maps-panel { position:fixed; left:50%; top:64px; transform:translateX(-50%); z-index:1000001; width:min(1280px,96vw); height:calc(100vh - 64px - 330px); min-height:280px; background:rgba(17,19,36,.94); backdrop-filter:blur(12px); color:#eef0ff; border-radius:16px; padding:10px; box-shadow:0 20px 50px rgba(10,10,30,.45); display:flex; flex-direction:column; gap:8px; font-size:13px; }
      .mpo-maps-panel.min { height:auto; min-height:0; }
      .mpo-maps-panel.min .mp-grid { display:none; }
      .mpo-maps-panel .mp-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .mpo-maps-panel .mp-bar > span { color:#9aa0c3; font-size:12px; flex:1; min-width:200px; }
      .mpo-maps-panel .mp-bar > span b { color:#eef0ff; }
      .mpo-maps-panel .mpo-btn { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.12); color:#eef0ff; }
      .mpo-maps-panel .mp-grid { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:10px; min-height:0; }
      .mpo-maps-panel .mp-side { display:flex; flex-direction:column; min-height:0; background:rgba(255,255,255,.05); border-radius:12px; padding:8px; gap:6px; border-top:3px solid #818cf8; }
      .mpo-maps-panel .mp-cands { display:flex; flex-direction:column; gap:8px; min-height:0; overflow:auto; }
      .mpo-maps-panel .mp-item { display:flex; flex-direction:column; background:rgba(255,255,255,.05); border-radius:12px; padding:8px; gap:6px; border-top:3px solid #22c55e; flex:none; }
      .mpo-maps-panel .mp-item.open { flex:1 1 0; min-height:220px; }
      .mpo-maps-panel .mp-item.sel { box-shadow:0 0 0 2px #22c55e inset; }
      .mpo-maps-panel .mp-ihead { display:flex; align-items:center; gap:8px; cursor:pointer; }
      .mpo-maps-panel .mp-ihead.static { cursor:default; }
      .mpo-maps-panel .mp-iinfo { flex:1; min-width:0; }
      .mpo-maps-panel .mp-badge { flex:none; font-weight:800; font-size:12px; padding:3px 8px; border-radius:7px; color:#fff; }
      .mpo-maps-panel .mp-badge.data { background:#6366f1; }
      .mpo-maps-panel .mp-badge.cand { background:#16a34a; }
      .mpo-maps-panel .mp-chip { flex:none; font-size:11px; padding:2px 7px; border-radius:99px; background:rgba(255,255,255,.1); color:#c7cbf0; }
      .mpo-maps-panel .mp-chip.bad { background:rgba(248,113,113,.2); color:#fca5a5; }
      .mpo-maps-panel .mp-chev { flex:none; color:#9aa0c3; width:12px; }
      .mpo-maps-panel .mp-n { font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mpo-maps-panel .mp-a { font-size:12px; color:#c7cbf0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mpo-maps-panel iframe { flex:1; width:100%; min-height:0; border:0; border-radius:10px; background:#fff; }
      .mpo-maps-panel .mp-seg { display:inline-flex; background:rgba(255,255,255,.08); border-radius:8px; padding:2px; gap:2px; }
      .mpo-maps-panel .mp-seg button { border:none; background:transparent; color:#9aa0c3; font-size:11.5px; font-weight:600; padding:3px 8px; border-radius:6px; cursor:pointer; }
      .mpo-maps-panel .mp-seg button.on { background:#4f46e5; color:#fff; }
      .mpo-klabel { display:inline-block; font-size:11px; font-weight:800; color:#fff; padding:1px 7px; border-radius:6px; margin-right:6px; vertical-align:1px; }
      .mpo-klabel.cand { background:#16a34a; }
      .mpo-klabel.data { background:#6366f1; }
      .mpo-hud .chip { font-size:11.5px; font-weight:700; padding:2px 7px; border-radius:7px; background:color-mix(in srgb,var(--c) 25%,transparent); color:#fff; }
      .mpo-hud.min { width:auto; padding:9px 12px; }
      .mpo-hud.min > :not(.top) { display:none; }
      .mpo-toast { position:fixed; left:50%; top:20px; transform:translateX(-50%); z-index:1000003; background:#111324; color:#fff; padding:10px 16px; border-radius:12px; font:600 13px "Inter",ui-sans-serif,system-ui,sans-serif; box-shadow:0 12px 30px rgba(0,0,0,.3); animation:mpofade .2s; }
      /* badge di kartu kandidat */
      .mpo-box { margin-top:8px; display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
      .mpo-b { font-size:11px; line-height:1.3; padding:2px 7px; border-radius:999px; border:1px solid; font-weight:600; }
      .mpo-b.ok { color:#1a7f4b; background:#e6f7ee; border-color:#9fdcbc; }
      .mpo-b.warn { color:#8a5a00; background:#fff4dc; border-color:#f3cf7a; }
      .mpo-b.bad { color:#b42318; background:#fdecea; border-color:#f5a8a1; }
      .mpo-v { font-size:11px; font-weight:800; padding:2px 8px; border-radius:6px; color:#fff; }
      .mpo-v.ok { background:#16a34a; } .mpo-v.warn { background:#d97706; } .mpo-v.bad { background:#dc2626; }
      .mpo-maps { font-size:11px; padding:2px 8px; border-radius:6px; border:1px solid #7c3aed; color:#7c3aed!important; background:#fff; text-decoration:none!important; margin-left:auto; }
      .mpo-maps:hover { background:#7c3aed; color:#fff!important; }
      .mpo-swal-warn { margin-top:12px; text-align:left; background:#fdecea; border-left:4px solid #dc2626; border-radius:8px; padding:10px 12px; font-size:.82rem; color:#b42318; }
      .mpo-swal-warn li { margin-left:14px; }
    `;
    document.head.appendChild(style);
  }

  function toast(msg) {
    ensureStyles();
    const t = document.createElement("div");
    t.className = "mpo-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  /* ---------- Tombol peluncur ---------- */
  function renderLaunch() {
    if (!document.body) return;
    ensureStyles();
    let b = document.getElementById("mpo-launch");
    if (!b) {
      b = document.createElement("button");
      b.id = "mpo-launch";
      b.className = "mpo-launch";
      b.title = "Matching Otomatis (Alt+M)";
      b.onclick = openSheet;
      document.body.appendChild(b);
    }
    const d = loadDay();
    b.innerHTML = `<span class="b">${APP.badge}</span> Matching Otomatis <span class="c">${d.MATCH + d.UNMATCH} hari ini</span>`;
  }

  /* ---------- Panel samping ---------- */
  let filter = "ALL";
  function openSheet() {
    ensureStyles();
    syncWithScreen();
    closeSheet();
    const ov = document.createElement("div");
    ov.className = "mpo mpo-overlay";
    ov.innerHTML = `<div class="mpo-sheet"><div class="mpo-head" id="mpo-head"></div><div class="mpo-body" id="mpo-body"></div></div>`;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeSheet();
    });
    document.body.appendChild(ov);
    renderSheetBody();
  }
  function closeSheet() {
    document.querySelector(".mpo-overlay")?.remove();
  }

  function renderSheetBody() {
    const head = document.getElementById("mpo-head");
    const body = document.getElementById("mpo-body");
    if (!head || !body) return;
    const conf = loadConf();
    const d = loadDay();
    const log = loadLog();
    const sum = d.MATCH + d.UNMATCH + d.SKIP || 1;
    const prog = (document.getElementById("stat_matched") || {}).textContent || "-";
    const target = (document.getElementById("stat_target") || {}).textContent || "-";

    head.innerHTML = `
      <div class="row1">
        <div class="mpo-logo">${APP.badge}</div>
        <div><div class="mpo-title">Matching Otomatis</div>
        <div class="mpo-sub">v${APP.version} · progres kegiatan ${esc(prog)} / ${esc(target)} · Alt+M buka/tutup</div></div>
        <button class="mpo-x" id="mpo-x">×</button>
      </div>
      <div class="mpo-prog">
        <div class="track">
          <div class="seg" style="width:${(d.MATCH / sum) * 100}%;background:#86efac"></div>
          <div class="seg" style="width:${(d.UNMATCH / sum) * 100}%;background:#fdba74"></div>
          <div class="seg" style="width:${(d.SKIP / sum) * 100}%;background:#c7d2fe"></div>
        </div>
        <div class="lbl"><span>Hari ini: ${d.MATCH} match · ${d.UNMATCH} unmatch · ${d.SKIP} skip</span><span>${d.ERROR ? d.ERROR + " gagal" : ""}</span></div>
      </div>`;
    head.querySelector("#mpo-x").onclick = closeSheet;

    const dec = state.toMatch ? decide(state.toMatch, state.cands, conf) : null;
    const counts = { MATCH: 0, UNMATCH: 0, SKIP: 0, ERROR: 0 };
    log.forEach((l) => (counts[l.action] = (counts[l.action] || 0) + 1));
    const shown = log.filter((l) => filter === "ALL" || l.action === filter).slice(0, 150);

    body.innerHTML = `
      <div class="mpo-card">
        <div class="mpo-sec">① Jalankan</div>
        <div class="mpo-row">
          <button class="mpo-btn primary" id="mpo-start">▶ Mulai otomatis</button>
          <button class="mpo-btn soft" id="mpo-eval">🔍 Nilai data ini saja</button>
        </div>
        <div class="mpo-hint" id="mpo-evalout" style="margin-top:10px">${
          dec
            ? dec.rule3 && conf.reviewRule3
              ? `Data sekarang: <b>${esc(state.toMatch.nama)}</b> → script akan <b style="color:#d97706">${r3Seen(state.toMatch.id_table) ? "berhenti & menampilkan peta kiri-kanan" : "Skip dulu (muncul lagi → peta)"}</b>, kandidat <b>${esc(dec.cand)}</b><br>${esc(dec.reason)}`
              : `Data sekarang: <b>${esc(state.toMatch.nama)}</b> → script akan <b style="color:${ACT[dec.action].color}">${ACT[dec.action].label}</b>${dec.action === "MATCH" && dec.cand ? ` dengan <b>${esc(dec.cand)}</b>` : ""}<br>${esc(dec.reason)}`
            : "Data belum terbaca. Tekan F5 sekali kalau label di kartu kandidat juga belum muncul."
        }</div>
      </div>
      <div class="mpo-card">
        <div class="mpo-sec">② Aturan & kecepatan</div>
        <label class="mpo-tog"><input type="checkbox" id="mpo-am" ${conf.autoMatch ? "checked" : ""}><span class="sw"></span>
          <span>Match otomatis yang jelas<small>Tepat 1 kandidat: wilayah sama s.d. desa, nama pengusaha sama persis (≥2 kata), alamat mirip ≥60%, jenis usaha tidak bertentangan, AKTIF.</small></span></label>
        <label class="mpo-tog"><input type="checkbox" id="mpo-au" ${conf.autoUnmatch ? "checked" : ""}><span class="sw"></span>
          <span>Unmatch otomatis sesuai briefing<small>Nama generik tanpa pengusaha (aturan 1), atau semua kandidat jelas bukan: pengusaha beda, jenis usaha beda (aturan 4), gudang/koperasi/kantin (aturan 5), beda kecamatan.</small></span></label>
        <label class="mpo-tog"><input type="checkbox" id="mpo-r3" ${conf.reviewRule3 ? "checked" : ""}><span class="sw"></span>
          <span>Review aturan 3 dengan peta kiri-kanan<small>Pengusaha & desa sama tapi alamat beda: pertama kali di-Skip dulu. Saat data itu muncul lagi, script berhenti dan menampilkan peta data (kiri) dan kandidat (kanan); kamu putuskan Match (M) / Unmatch (U) / Skip (S). Mati = selalu Skip.</small></span></label>
        <div class="mpo-hint" style="margin:4px 0 12px">Selain itu → <b>Skip</b> (kerjakan manual nanti). Kalau data yang sudah di-Skip muncul lagi, script berhenti sendiri.</div>
        <div class="mpo-row">
          <span class="mpo-hint">Kecepatan</span>
          <div class="mpo-seg" id="mpo-speed">${SPEEDS.map((s, i) => `<button data-i="${i}" class="${conf.speed === i ? "on" : ""}">${s.name}</button>`).join("")}</div>
          <span class="mpo-hint" style="margin-left:12px">Maks per jalan</span>
          <input class="mpo-num" id="mpo-limit" type="number" min="1" max="2000" value="${conf.limit}">
        </div>
      </div>
      <div class="mpo-card">
        <div class="mpo-sec">③ Riwayat otomatis (${log.length})</div>
        <div class="mpo-stats">
          ${[["ALL", "Semua", "#4f46e5", log.length], ...Object.entries(ACT).map(([k, v]) => [k, v.label, v.color, counts[k] || 0])]
            .map(([k, l, c, n]) => `<button class="mpo-stat ${filter === k ? "on" : ""}" data-f="${k}" style="--c:${c}"><div class="n">${n}</div><div class="l">${l}</div></button>`)
            .join("")}
        </div>
        <div class="mpo-row" style="margin:12px 0 10px">
          <button class="mpo-btn sm" id="mpo-csv">⬇ Ekspor CSV</button>
          <button class="mpo-btn sm ghost" id="mpo-clear">Hapus riwayat</button>
        </div>
        <div class="mpo-list">${
          shown.length
            ? shown
                .map((l) => {
                  const a = ACT[l.action] || ACT.SKIP;
                  return `<div class="mpo-item" style="--c:${a.color}">
                    <div class="nm">${esc(l.nama)}<span class="mpo-pill">${a.label}</span></div>
                    <div class="meta">${esc(l.alamat || "")} · ${esc(l.wil || "")} · ${hhmm(l.t)}</div>
                    ${l.cand ? `<div class="meta">→ ${esc(l.cand)} (IDSBR ${esc(l.idsbr)})</div>` : ""}
                    <div class="why">${esc(l.reason)}</div></div>`;
                })
                .join("")
            : `<div class="mpo-empty">Belum ada riwayat.</div>`
        }</div>
      </div>`;

    body.querySelector("#mpo-start").onclick = startRun;
    body.querySelector("#mpo-eval").onclick = () => {
      decorate();
      renderSheetBody();
    };
    body.querySelector("#mpo-am").onchange = (e) => saveConf({ ...loadConf(), autoMatch: e.target.checked }) || renderSheetBody();
    body.querySelector("#mpo-r3").onchange = (e) => saveConf({ ...loadConf(), reviewRule3: e.target.checked }) || renderSheetBody();
    body.querySelector("#mpo-au").onchange = (e) => saveConf({ ...loadConf(), autoUnmatch: e.target.checked }) || renderSheetBody();
    body.querySelectorAll("#mpo-speed button").forEach((b) => (b.onclick = () => saveConf({ ...loadConf(), speed: Number(b.dataset.i) }) || renderSheetBody()));
    body.querySelector("#mpo-limit").onchange = (e) => saveConf({ ...loadConf(), limit: Math.max(1, Math.min(2000, Number(e.target.value) || 100)) });
    body.querySelectorAll(".mpo-stat").forEach((b) => (b.onclick = () => ((filter = b.dataset.f), renderSheetBody())));
    body.querySelector("#mpo-csv").onclick = exportCsv;
    body.querySelector("#mpo-clear").onclick = () => {
      if (confirm("Hapus semua riwayat otomatis di browser ini?")) {
        saveJson(LOG_KEY, []);
        renderSheetBody();
      }
    };
  }

  function exportCsv() {
    const log = loadLog();
    const cols = ["waktu", "aksi", "nama", "alamat", "kec/desa", "kandidat", "idsbr", "alasan", "id_table"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = log.map((l) =>
      [new Date(l.t).toLocaleString("id-ID"), (ACT[l.action] || {}).label || l.action, l.nama, l.alamat, l.wil, l.cand, l.idsbr, l.reason, l.id].map(q).join(","),
    );
    const blob = new Blob(["﻿" + [cols.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `matching-otomatis-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Bar progres (HUD) ---------- */
  const STEPS = ["Baca & nilai", "Pilih", "Konfirmasi", "Simpan", "Jeda"];
  function renderHud(finished) {
    if (!document.body) return;
    ensureStyles();
    let h = document.getElementById("mpo-hud");
    if (!run.active && !finished) return;
    if (!h) {
      h = document.createElement("div");
      h.id = "mpo-hud";
      h.className = "mpo mpo-hud";
      document.body.appendChild(h);
    }
    const conf = loadConf();
    const rv = run.review;
    const spin = run.active ? (run.pause || rv ? "wait" : "") : "idle";
    const title = run.active ? (rv ? "Menunggu keputusanmu · aturan 3" : run.pause ? "Dijeda" : "Matching otomatis berjalan") : "Selesai";
    let review = "";
    if (rv) {
      if (document.getElementById("mpo-maps")) showMapsPanel(); // kandidat diganti -> daftar peta ikut menyesuaikan
      const pick = reviewCand();
      const c = pick.c || {};
      const an = state.analysis[pick.id];
      const addr = an ? an.f.addrSim : "?";
      const side = (k, o) =>
        `<div class="rv-card"><div class="k">${k}</div><div class="n">${esc(o.nama || "-")}</div><div class="a">${esc(o.alamat || "-")}</div><div class="a">${esc([o.nmdesa, o.nmkec].filter(Boolean).join(", "))}</div></div>`;
      review = `
        <div class="rv-grid">${side("Data yang dicocokkan", rv.tm)}${side(`Kandidat · IDSBR ${esc(pick.id)}`, c)}</div>
        <div class="rv-note">Pengusaha & desa sama, alamat mirip ${addr}%. Lihat peta kiri-kanan: berdekatan → M, beda lokasi → U (briefing aturan 3). Klik kartu lain untuk ganti kandidat; klik di luar peta dulu agar tombol keyboard aktif.</div>
        <div class="rv-acts">
          <button class="mpo-btn" data-rv="MAPS"><b>G</b>&nbsp;${mapsPanelOpen() ? "Sembunyikan peta" : "Tampilkan peta"}</button>
          <button class="mpo-btn" data-rv="ROUTE">Rute di tab baru</button>
          <span style="flex:1"></span>
          <button class="mpo-btn go" data-rv="MATCH"><b>M</b>&nbsp;Match</button>
          <button class="mpo-btn un" data-rv="UNMATCH"><b>U</b>&nbsp;Unmatch</button>
          <button class="mpo-btn" data-rv="SKIP"><b>S</b>&nbsp;Skip</button>
        </div>`;
    }
    h.innerHTML = `
      <div class="top">
        <div class="spin ${spin}"></div>
        <div><div class="ttl">${title}</div><div class="dim">${run.done} / ${conf.limit} data · ${SPEEDS[conf.speed].name}</div></div>
        <div class="chips">${Object.entries(ACT)
          .filter(([k]) => run.counts[k])
          .map(([k, v]) => `<span class="chip" style="--c:${v.color}">${v.label} ${run.counts[k]}</span>`)
          .join("")}</div>
        ${
          run.active
            ? `<button class="mpo-btn" id="mpo-pause">${run.pause ? "▶ Lanjut" : "⏸ Jeda"}</button><button class="mpo-btn stop" id="mpo-stop">■ Stop</button>`
            : `<button class="mpo-btn" id="mpo-open">Riwayat</button><button class="mpo-btn" id="mpo-close">×</button>`
        }
        <button class="mpo-btn" id="mpo-min" title="Kecilkan">–</button>
      </div>
      <div class="doc">${esc(run.cur || "")}</div>
      <div class="steps">${STEPS.map((s, i) => `<div class="st ${run.step === i + 1 ? "now" : run.step > i + 1 ? "done" : ""}">${s}</div>`).join("")}</div>
      ${review}
      <div class="log">${run.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
      <div class="bar"><i style="width:${Math.min(100, (run.done / conf.limit) * 100)}%"></i></div>`;
    const on = (id, fn) => {
      const el = h.querySelector("#" + id);
      if (el) el.onclick = fn;
    };
    on("mpo-pause", () => ((run.pause = !run.pause), renderHud()));
    on("mpo-stop", () => {
      run.stop = true;
      if (run.review) run.review.resolve(null);
      renderHud();
    });
    h.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => reviewChoose(b.dataset.rv)));
    on("mpo-open", openSheet);
    on("mpo-close", () => h.remove());
    on("mpo-min", () => h.classList.toggle("min"));
  }

  /* =========================================================================
     MULAI
     ========================================================================= */
  (function waitJQ() {
    const jq = window.jQuery;
    if (jq && jq.fn && jq(document).ajaxComplete) jq(document).ajaxComplete(onAjaxComplete);
    else setTimeout(waitJQ, 100);
  })();

  function init() {
    ensureStyles();
    renderLaunch();
    const t = setInterval(() => {
      if (hookSwal()) clearInterval(t);
    }, 300);
    const list = document.getElementById("candidates_list");
    if (list) new MutationObserver(() => setTimeout(decorate, 50)).observe(list, { childList: true });
    // Saat review, ganti kartu = kandidat di bar ikut berganti
    document.addEventListener("click", (e) => {
      if (run.review && e.target.closest && e.target.closest(".mp-candidate-card")) setTimeout(renderHud, 60);
    });
    // Data pertama tertanam di HTML: baca dari tampilan begitu kartunya ada
    (function firstRead(n) {
      if (state.toMatch) return;
      if (document.querySelector(".mp-candidate-card[data-idsbr]") || n > 50) readFromDom();
      else setTimeout(() => firstRead(n + 1), 200);
    })(0);
    document.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        document.querySelector(".mpo-overlay") ? closeSheet() : openSheet();
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.__mpo = { state, analyze, decide, splitName, run, askOperator, readFromDom };
})();
