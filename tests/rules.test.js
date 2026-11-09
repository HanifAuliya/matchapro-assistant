const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "matchapro-otomatis.user.js"), "utf8");
global.window = {}; global.localStorage = { getItem() { return null; }, setItem() {} }; global.location = { pathname: "/x" };
global.document = { readyState: "loading", addEventListener() {} };
eval(src);
const { decide, splitName } = window.__mpo;
const conf = { autoMatch: true, autoUnmatch: true, reviewRule3: true };
let n = 0;
const W = (o) => ({ kdprov: "11", kdkab: "01", kdkec: "010", kddesa: "001", nmkec: "KEC", nmdesa: "DESA", nmkab: "KAB", status_perusahaan: "AKTIF", ...o });
const C = (o) => W({ idsbr: String(++n), ...o });
const D = (o, kec, desa, nmkec, nmdesa) => C({ ...o, kdkec: kec, kddesa: desa, nmkec, nmdesa });
const cases = [
  // ---- briefing ----
  ["B1 generik", W({ nama: "ISI ULANG AIR MINUM", alamat: "DUSUN UJUNG SAPEK" }), [C({ nama: "USAHA ISI ULANG AIR MINUM <RUSNIAH>", alamat: "x" })], "UNMATCH"],
  ["B1 ojek online", W({ nama: "OJEK ONLINE", alamat: "KAPUK KEBON JAHE" }), [C({ nama: "OJEK ONLINE", alamat: "KEBON SAYUR JALAN" })], "UNMATCH"],
  ["B2 etty", W({ nama: "USAHA ETTY SETIANA", alamat: "PERUM PTB BLOK 1J" }), [C({ nama: "ETTY SETIANA", alamat: "PERUM PTB BLOK 1 J NO 13" })], "MATCH"],
  ["B2 enjang", W({ nama: "SEWA LAHAN DAGANG (ENJANG SUTARDI)", alamat: "MUARA ANGKE BERMIS BLOK B.9 NO 12" }), [C({ nama: "ENJANG SUTARDI", alamat: "MUARA ANGKE BERMIS BLOK B.9/12" }), C({ nama: "SEWA LAHAN <RUSDI>", alamat: "JL WARAKAS" })], "MATCH"],
  ["B3 rizki", W({ nama: "WARUNG RIZKI (TRI WAHYUNI)", alamat: "JALAN H TIRIN" }), [C({ nama: "Warung Rizki <Tri Wahyuni>", alamat: "Jl Taruna Jaya RT 7" })], "REVIEW"],
  ["B4 karet vs gula", W({ nama: "PERKEBUNAN KARET (ASMAR EFENDI SIMATUPANG)", alamat: "JALAN SIMANGAMBAT" }), [C({ nama: "Pembuat Gula Merah Asmar Simatupang <Asmar Efendi Simatupang>", alamat: "Lingkungan Purba Tua Simangambat" })], "UNMATCH"],
  ["B5 kantin", W({ nama: "KANTIN MI AL WASHLIYAH", alamat: "KP BOJONG RANGKONG" }), [C({ nama: "MI AL WASHLIYAH", alamat: "Jl Bojong Rangkong" })], "UNMATCH"],
  ["B5 gudang", W({ nama: "GUDANG SUMBER KARYA SENTOSA, PT", alamat: "KOMPLEK RUKO CEMPAKA MAS" }), [C({ nama: "SUMBER KARYA SENTOSA, PT", alamat: "RUKO MEGA GROSIR CEMPAKA MAS" })], "UNMATCH"],
  // ---- dummy: harusnya Match / review ----
  ["D wantina (janjimaria)", W({ nama: "UPT PEDAGANG KELILING (WANTINA MANURUNG)", alamat: "DUSUN 3 JANJIMARIA", nmdesa: "PARHABINSARAN JANJI MATOGU" }), [C({ nama: "Pedagang keliling <Wantina manurung>", alamat: "Janji maria", nmdesa: "PARHABINSARAN JANJI MATOGU" }), C({ nama: "Pedagang keliling <Riama rajagukguk>", alamat: "Keliling" })], "MATCH"],
  ["D cut erawati (2 kurung)", W({ nama: "USAHA WARUNG MIE (CUT ERAWATI)", alamat: "JALAN LAPANGAN BOLA KAKI MATA IE", nmdesa: "MATA IE" }), [C({ nama: "USAHA MIE SO ( CUT ERA ) <CUT ERAWATI>", alamat: "DUSUN I MATAIE", nmdesa: "MATA IE" })], "REVIEW"],
  ["D lailawati (1 kata, alamat sama)", W({ nama: "KIOS LAILAWATI", alamat: "DUSUN KARYA BARU" }), [C({ nama: "Kios <lailawati> <Lailawati>", alamat: "Dusun karya baru" }), D({ nama: "LAILAWATI", alamat: "DUSUN LHUNG" }, "", "", "", "")], "MATCH"],
  ["D bustami (1 kata, alamat beda)", W({ nama: "INDUSTRI PERAHU (BUSTAMI)", alamat: "DUSUN TGK MANYAK" }), [C({ nama: "INDUSTRI PERAHU<BUSTAMI>", alamat: "JALAN MEULABOH TUTUT DUSUN PANTE KULU" }), D({ nama: "Bustami pangkas <Bustami>", alamat: "x" }, "050", "008", "JOHAN", "SUAK")], "REVIEW"],
  ["D sopiyan (alamat sebut desa)", W({ nama: "PERKEBUNAN (SOPIYAN DAHLAN)", alamat: "KOMPLEK HUNTARA DESA PASIR", kdkec: "050", kddesa: "022", nmkec: "TERANGUN", nmdesa: "REJE PUDUNG" }), [D({ nama: "Tembakau kretek <Sopiyan dahlan>", alamat: "Dusun telege Durin" }, "051", "001", "TRIPE JAYA", "PASIR"), D({ nama: "TEMBAKAU <DAHLAN>", alamat: "DUSUN BLAH CIK DESA PASIR" }, "051", "001", "TRIPE JAYA", "PASIR")], "REVIEW"],
  ["D irwan kepiting~ikan", W({ nama: "USAHA PEDAGANG KEPITING (IRWAN)", alamat: "JALAN M.THAHIR DESA KILANGAN RT 04", nmdesa: "KILANGAN" }), [C({ nama: "JUALAN IKAN <IRWAN>", alamat: "KILANGAN, DUSUN 1", nmdesa: "KILANGAN" }), C({ nama: "Usaha Kelontong <MARLIN>", alamat: "KILANGAN, DUSUN 3", nmdesa: "KILANGAN" })], "REVIEW"],
  ["D reni (2 entri SBR)", W({ nama: "KIOS JUALAN ECERAN (RENI AYUMI BR KUDARI)", alamat: "DUSUN HARAPAN JAYA DESA SEUNELOP", nmdesa: "SEUNEULOP" }), [C({ nama: "Reni ayumi br kudari", alamat: "Dusun Ingin Makmur", nmdesa: "SEUNEULOP" }), C({ nama: "Jualan enceran makanan ringan<reni ayumi.br kudari> <RENI AYUMI BR. KUDARI>", alamat: "Dusun harapan jaya", nmdesa: "SEUNEULOP" })], "REVIEW"],
  ["D zulmahdi (nama sebagian)", W({ nama: "UTP TANAMAN PANGAN (ZULMAHDI)", alamat: "DUSUN SEUTIA, DESA BAHARU, KECAMATAN BLANGPIDIE, ACEH BARAT DAYA", nmdesa: "BAHARU" }), [C({ nama: "Pangkalan Berkah <Zulmahdi Anggara>", alamat: "Dusun Seutia", nmdesa: "BAHARU" })], "REVIEW"],
  ["D robi (4 kata, beda kec)", W({ nama: "JASA SEWA RUMAH (ROBI MAULI OKTA RIZKI)", alamat: "JALAN ANGGREK DUSUN DARUSSALAM" }), [D({ nama: "ROBI MAULI OKTA RIZKI", alamat: "PULO LATONG" }, "040", "009", "BABUSSALAM", "PULO LATONG")], "REVIEW"],
  ["D sulvia tenun", W({ nama: "BERTENUN KAIN ULOS (SULVIA KRISTINA SIMORANGKIR)", alamat: "JLN MR RUFINUS TOBING", nmdesa: "PARBUBU I" }), [C({ nama: "Pengrajin tenun <Sulvia Kristina Simorangkir >", alamat: "Jln. Desa Parbubu 1 kecamatan Tarutung kabupaten Tapanuli Utara , RT 0/RW 0", nmdesa: "PARBUBU I" })], "REVIEW"],
  // ---- dummy: harusnya BUKAN ----
  ["D tambang pasir (generik)", W({ nama: "TAMBANG PENGGALIAN PASIR", alamat: "LORONG 1" }), [C({ nama: "PENGGALIAN PASIR <WILLEM>", alamat: "x" })], "UNMATCH"],
  ["D baju keliling (generik)", W({ nama: "USAHA BAJU KELILING", alamat: "LR SEULAWAH" }), [C({ nama: "USAHA JUAL BAJU KELILING <DAFRIZAL>", alamat: "JL BUKIT KUBU" })], "UNMATCH"],
  ["D rusli vs basri (alamat sama)", W({ nama: "Hortikultura (rusli)", alamat: "DUSUN REJE BUJANG DESA UNING PUNE", nmdesa: "UNING PUNE" }), [C({ nama: "TOKO USAHA BARU <BASRI>", alamat: "KP UNING PUNE DUSUN REJE BUJANG", nmdesa: "UNING PUNE" }), D({ nama: "SEREH WANGI <RUSLI>", alamat: "x" }, "040", "011", "RIKIT", "PINANG")], "SKIP"],
  ["D bonar vs tunggul", W({ nama: "UTP JAGUNG (BONAR)", alamat: "PERUMAHAN KORPRI LORONG 6" }), [C({ nama: "TUNGGUL SIANIPAR", alamat: "SIBARANI NASAMPULU PERUMAHAN KORPRI LORONG IV NO.100" })], "UNMATCH"],
  ["D cabai vs sere (beda kec)", W({ nama: "INDUSTRI CABAI RAWIT ( ABU BAKAR )", alamat: "DUSUN RUMPI" }), [D({ nama: "INDUSTRI SERE WANGI <ABU BAKAR >", alamat: "DUSUN IMEM" }, "011", "007", "BLANG JERANGO", "AKUL")], "UNMATCH"],
  ["D hendri vs anyaman", W({ nama: "USAHA PERTANIAN PINANG ( HENDRI )", alamat: "DUSUN SEULANGO BARU", nmdesa: "LATALING" }), [C({ nama: "USAHA ANYAMAN TIKAR PANDAN IBU MAWANI", alamat: "DUSUN SELANGO BARU DESA LATALING", nmdesa: "LATALING" })], "UNMATCH"],
];
let ok = 0;
for (const [name, tm, cands, exp] of cases) {
  const d = decide(tm, cands, conf);
  const got = d.rule3 ? "REVIEW" : d.action;
  const pass = got === exp;
  ok += pass;
  console.log(`${pass ? "OK   " : "GAGAL"} ${name.padEnd(36)} ${got.padEnd(8)} ${d.reason}`);
}
console.log(`\n${ok}/${cases.length} sesuai`);
console.log("pengusaha 'USAHA MIE SO ( CUT ERA ) <CUT ERAWATI>' =", splitName("USAHA MIE SO ( CUT ERA ) <CUT ERAWATI>").owner.join(" "));
console.log("pengusaha 'TAMBANG PENGGALIAN PASIR' =", JSON.stringify(splitName("TAMBANG PENGGALIAN PASIR").owner));
process.exit(ok === cases.length ? 0 : 1);
