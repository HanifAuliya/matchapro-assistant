const { JSDOM } = require("jsdom");
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "matchapro-otomatis.user.js"), "utf8");
const W = { kdprov: "31", kdkab: "75", kdkec: "010", kddesa: "002", nmkec: "CIRACAS", nmdesa: "CIBUBUR", nmkab: "JAKARTA TIMUR", status_perusahaan: "AKTIF" };
const recA = { to_match: { ...W, id_table: "A", nama: "WARUNG RIZKI (TRI WAHYUNI)", alamat: "JALAN H TIRIN" },
  to_possible: [{ ...W, idsbr: "111", nama: "Warung Rizki <Tri Wahyuni>", alamat: "Jl Taruna Jaya RT 7" }, { ...W, idsbr: "333", nama: "WARUNG <TRI WAHYUNI>", alamat: "Gg Swakarya 2" }, { ...W, idsbr: "444", nama: "TOKO (BUDI)", alamat: "x" }] };
const recB = { to_match: { ...W, id_table: "B", nama: "PABRIK BATA (FAUZI)", alamat: "DUSUN X" },
  // kandidat di kecamatan lain dengan nama 1 kata: ragu biasa -> Skip (bukan review)
  to_possible: [{ ...W, idsbr: "222", nama: "PABRIK BATA <FAUZI>", alamat: "DUSUN Y", kdkec: "999", nmkec: "LAIN" }] };
const queue = [recA, recB, recA, recB, recA];
const dom = new JSDOM(`<!doctype html><body><input id="to_match_id"><div><span id="to_match_nama_display"></span></div><div><span id="to_match_alamat_display"></span></div>
<div id="candidates_list"></div><button id="btn_match"></button><button id="btn_unmatch"></button><button id="btn_skip"></button><div id="completed_card" class="d-none"></div></body>`,
  { runScripts: "outside-only", pretendToBeVisual: true, url: "https://matchapro.web.bps.go.id/matching/kegiatan/27" });
const w = dom.window, d = w.document;
w.HTMLElement.prototype.scrollIntoView = function () {};
const esc = s => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const saved = [];
let ajaxHandler = null, cur = null, selected = null;
function render(rec) {
  cur = rec;
  d.getElementById("to_match_id").value = rec.to_match.id_table;
  d.getElementById("to_match_nama_display").textContent = rec.to_match.nama;
  d.getElementById("candidates_list").innerHTML = rec.to_possible.map((c, i) =>
    `<div class="mp-candidate mp-candidate-card" data-idsbr="${c.idsbr}" id="candidate_${i}"><div class="mp-candidate-body"><div class="mp-candidate-name">${esc(c.nama)}</div></div></div>`).join("");
}
function next(skip) {
  const rec = queue.shift();
  if (!rec) { d.getElementById("completed_card").classList.remove("d-none"); return; }
  render(rec);
  setTimeout(() => ajaxHandler && ajaxHandler({}, { status: 200, responseJSON: rec }, { url: "https://matchapro.web.bps.go.id/matching/kegiatan/27/data", type: "POST", data: skip ? "skip_data=" + skip : "" }), 20);
}
// fake Swal
let dlg = null;
w.Swal = {
  isVisible: () => !!dlg, getTitle: () => dlg && { textContent: dlg.title }, getHtmlContainer: () => dlg && { textContent: dlg.html },
  clickConfirm: () => { const x = dlg; dlg = null; x.onOk(); }, clickCancel: () => { dlg = null; }, close: () => { dlg = null; }, fire: () => Promise.resolve({}),
};
// fake jQuery
w.jQuery = (x) => ({
  trigger: () => {
    const el = typeof x === "string" ? d.querySelector(x) : x;
    if (el.classList && el.classList.contains("mp-candidate-card")) { d.querySelectorAll(".mp-candidate-card").forEach(c => c.classList.remove("selected")); el.classList.add("selected"); selected = el.dataset.idsbr; return; }
    const id = cur.to_match.id_table;
    if (el.id === "btn_skip") dlg = { title: "Lewati Data Ini?", html: "", onOk: () => { saved.push("SKIP " + id); next(id); } };
    if (el.id === "btn_match") dlg = { title: "Konfirmasi Match", html: "ID: x · IDSBR: " + selected, onOk: () => { saved.push("MATCH " + id + "→" + selected); setTimeout(() => ajaxHandler({}, { status: 200 }, { url: "https://matchapro.web.bps.go.id/matching/kegiatan/27", type: "POST", data: "status=MATCH" }), 5); next(); } };
    if (el.id === "btn_unmatch") dlg = { title: "Konfirmasi Unmatch", html: "", onOk: () => { saved.push("UNMATCH " + id); next(); } };
  },
});
w.jQuery.fn = {};
const docJQ = w.jQuery; w.jQuery = Object.assign((x) => x === d ? { ajaxComplete: (fn) => { ajaxHandler = fn; } } : docJQ(x), { fn: {} });
w.open = () => ({ focus() {} });
w.localStorage.setItem("mpo_conf", JSON.stringify({ speed: 2, limit: 50 }));
Object.defineProperty(d.getElementById("btn_match"), "offsetParent", { get: () => d.body });
w.eval(src);
d.dispatchEvent(new w.Event("DOMContentLoaded"));
next();
(async () => {
  await new Promise(r => setTimeout(r, 300));
  const api = w.__mpo;
  const runP = (async () => { await w.eval("(" + (() => 0).toString() + ")"); })();
  // start run via the panel's start function (exposed through openSheet button)
  w.document.getElementById("mpo-launch").click();
  d.getElementById("mpo-start").click();
  // wait until review appears
  for (let i = 0; i < 200 && !api.run.review; i++) await new Promise(r => setTimeout(r, 50));
  const panel = d.getElementById("mpo-maps");
  console.log("review muncul untuk:", api.run.review && api.run.review.tm.id_table);
  console.log("panel peta:", !!panel, "| iframe:", panel && [...panel.querySelectorAll("iframe")].map(f => decodeURIComponent(f.src).replace("https://www.google.com/maps?output=embed&z=16&q=", "")));
  const items = [...panel.querySelectorAll(".mp-item")].map(i => i.querySelector(".mp-badge").textContent + " " + i.querySelector(".mp-n").textContent + (i.classList.contains("open") ? " [terbuka]" : " [tertutup]") + (i.classList.contains("sel") ? " [dipilih]" : ""));
  console.log("label kiri:", panel.querySelector(".mp-side .mp-badge").textContent, "| kanan:", items);
  console.log("label di kartu halaman:", [...d.querySelectorAll(".mp-candidate-card")].map(c => c.dataset.idsbr + ":" + (c.querySelector(".mpo-klabel")?.textContent || "-")));
  // tutup K1, pilih K2
  panel.querySelector('[data-toggle="111"]').click();
  w.document.getElementById("mpo-maps").querySelector('[data-pick="333"]').click();
  await new Promise(r => setTimeout(r, 150));
  const p2 = d.getElementById("mpo-maps");
  console.log("setelah tutup K1 & pilih K2:", [...p2.querySelectorAll(".mp-item")].map(i => i.querySelector(".mp-badge").textContent + (i.classList.contains("open") ? " terbuka" : " tertutup") + (i.classList.contains("sel") ? " dipilih" : "")));
  // kecilkan dengan G
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "g", bubbles: true }));
  console.log("dikecilkan:", d.getElementById("mpo-maps").classList.contains("min"));
  d.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "m", bubbles: true }));
  for (let i = 0; i < 200 && api.run.active; i++) await new Promise(r => setTimeout(r, 50));
  console.log("urutan aksi:", saved);
  console.log("pesan akhir:", api.run.lines.at(-1));
  console.log("panel peta dihapus:", !d.getElementById("mpo-maps"), "| label kartu dibersihkan:", !d.querySelector(".mpo-klabel"));
  console.log("A masih diingat sebagai aturan 3:", Object.keys(JSON.parse(w.localStorage.getItem("mpo_r3_/matching/kegiatan/27") || "{}")));
  process.exit(0);
})();
