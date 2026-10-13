const http = require("http"); const fs = require("fs"); const path = require("path");
// Prueba de punta a punta de la página de turnos (y de los borradores), contra los emuladores de Firebase.
const { chromium } = require("playwright");
const REPO = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "capturas", "visita");
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, getDocs, collection } = require("firebase/firestore");

const tipos = { html:"text/html; charset=utf-8", js:"application/javascript", json:"application/json", png:"image/png", css:"text/css" };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split("?")[0]));
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipos[f.split(".").pop()] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(8771);
const BASE = "http://127.0.0.1:8771";

const iso = (offset) => { const d = new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const errores = [];
let fallas = 0, oks = 0;
const check = (cond, msg) => { if(cond) oks++; else fallas++; console.log((cond ? "ok - " : "FALLA - ") + msg); };

let browser, env;
async function pagina(cuenta, opts = {}){
  const ctx = await browser.newContext({ viewport: { width: opts.ancho || 390, height: 860 }, serviceWorkers: "block", colorScheme: opts.esquema || "light" });
  const page = await ctx.newPage();
  page.nombre = (cuenta && cuenta.name) || opts.nombre || "anon";
  page.dialogos = [];
  page.on("pageerror", e => errores.push(page.nombre + ": " + e.message));
  page.on("console", m => { if(m.type() === "error" && !/PERMISSION_DENIED|permission|ERR_FAILED|Failed to load resource/i.test(m.text())) errores.push(page.nombre + ": " + m.text()); });
  page.on("dialog", d => { page.dialogos.push(d.message()); d.accept(); });
  if(process.env.DEBUG) page.on("console", m => { if(m.type() === "warning") console.log("WARN", new Date().toISOString().slice(14,23), page.nombre, m.text().slice(0, 200)); });
  await page.route(/gstatic\.com\/firebasejs\/.*\/(firebase-[a-z-]+\.js)/, route =>
    route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "node_modules/firebase/" + route.request().url().split("/").pop())) }));
  await page.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort());
  await page.route("**/comun.js", route => {
    let body = fs.readFileSync(REPO + "/comun.js", "utf8");
    body = body.replace("const auth = firebase.auth();", `const auth = firebase.auth();
db.useEmulator("127.0.0.1", 8089); auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
window.__login = (c) => auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify(c)));`);
    route.fulfill({ contentType: "application/javascript", body });
  });
  page.cuenta = cuenta;
  return page;
}
async function loginEn(page){
  await page.evaluate(c => window.__login(c), page.cuenta);
  await page.waitForFunction(() => auth.currentUser && !auth.currentUser.isAnonymous, null, { timeout: 10000 });
}
const esperar = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 });
async function leer(ruta){ let out = null; await env.withSecurityRulesDisabled(async c => { const s = await getDoc(doc(c.firestore(), ruta)); out = s.exists() ? s.data() : null; }); return out; }
async function leerCol(ruta){ const out = {}; await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), ruta))).forEach(d => out[d.id] = d.data()); }); return out; }
async function abrirTurnos(page, rid = "oct"){
  await page.goto(`${BASE}/turnos.html?r=${rid}`);
  await page.waitForSelector(".resumen, .mensaje h1, .gate h1", { timeout: 10000 });
}
// Pantalla de entrada de turnos: poner el código de 6 números
async function entrarTurnos(page, codigo, esperarCalendario = true){
  await page.waitForSelector("#gCodigo", { timeout: 10000 });
  await page.fill("#gCodigo", codigo);
  await page.click("#gEntrar");
  if(esperarCalendario) await page.waitForSelector(".resumen", { timeout: 10000 });
}
async function anotarDesdeLista(page, fecha){
  await page.click(`.seg.vista [data-vista="lista"]`);
  await page.click(`[data-fila="${fecha}"] [data-anotar]`);
  await page.waitForSelector("#velo.show");
}
async function hojaCerrada(page){
  try{ await page.waitForSelector("#velo.show", { state: "detached", timeout: 10000 }); }
  catch(e){ throw new Error(`${page.nombre}: la hoja no se cerró. Aviso: "${await avisoHoja(page)}"`); }
}
const avisoHoja = page => page.textContent("#hoja .aviso").catch(() => "");
async function sinDesborde(page, nombre){
  const x = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(x <= 0, `${nombre}: sin scroll horizontal (${x}px)`);
}

const ADMIN = { sub:"uAdmin", email:"bm.blancom@gmail.com", email_verified:true, name:"Bárbara" };

// Prueba del checklist de visitas: un recorrido en curso con el checklist viejo pasa al nuevo
(async () => {
  env = await initializeTestEnvironment({ projectId: "michis-en-casa", firestore: { rules: fs.readFileSync(REPO + "/firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 } });
  await env.clearFirestore();
  // Recorrido de 11 días que empezó ayer (hoy es el día 2), todavía con el checklist viejo.
  // Ayer Caro tildó con el checklist viejo.
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, "recorridos/oct"), { nombre:"Cuidado Octubre", dias:11, fechaInicio:iso(-1), activo:true, borrador:false, creado:2 });
    for(const [id, nombre] of [["sofi","Sofi"], ["caro","Caro"]])
      await setDoc(doc(f, `recorridos/oct/participantes/${id}`), { nombre, uid:null, recorridoNombre:"Cuidado Octubre", vioPopupGlobal:true });
    await setDoc(doc(f, "recorridos/oct/codigos/sofi"), { codigo:"123456" });
    await setDoc(doc(f, "accesos/123456"), { rid:"oct", pid:"sofi" });
    const viejo = (key, creado) => ({ dia:1, key, pid:"caro", nombre:"Caro", uid:"uCaro", creado });
    for(const [key, creado] of [["milo_seco_1", 1], ["milo_seco_2", 2], ["zoe_seco_2", 3], ["milo_humedo", 4], ["piedras", 5]])
      await setDoc(doc(f, `recorridos/oct/tareas/1_${key}`), viejo(key, creado));
    // Un recorrido viejo, ya terminado: conserva su checklist
    await setDoc(doc(f, "recorridos/viejo"), { nombre:"Septiembre", dias:3, fechaInicio:"2026-09-01", activo:true, borrador:false, creado:1 });
    await setDoc(doc(f, "recorridos/viejo/tareas/1_milo_seco_1"), { dia:1, key:"milo_seco_1", pid:"caro", nombre:"Caro", uid:"uCaro", creado:1 });
  });
  browser = await chromium.launch();

  // ===== 1) El admin pasa el recorrido en curso al checklist de visitas =====
  const admin = await pagina(ADMIN);
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector("#loginBtn"); await loginEn(admin);
  await admin.waitForSelector(".recorrido-item", { timeout: 10000 });
  const itemOct = admin.locator(".recorrido-item", { hasText: "Cuidado Octubre" });
  const itemViejo = admin.locator(".recorrido-item", { hasText: "Septiembre" });
  check(await itemOct.locator('[data-accion="pasar-visita"]').count() === 1, "el recorrido en curso ofrece pasar al checklist de visitas");
  check(await itemViejo.locator('[data-accion="pasar-visita"]').count() === 0, "un recorrido terminado no (queda como estaba)");
  await itemOct.locator('[data-accion="pasar-visita"]').click();
  await esperar(admin, () => document.getElementById("toast").textContent.includes("checklist de visitas"));
  const r = await leer("recorridos/oct");
  check(r.checklist === "visita" && r.checklistDesde === 2, `queda con el checklist de visitas desde hoy (día ${r.checklistDesde})`);
  const t = await leerCol("recorridos/oct/tareas");
  check(t["1_milo_comida"] && t["1_milo_comida"].pid === "caro" && t["1_milo_comida"].creado === 1, "las tomas de Milo de ayer cuentan como 'Milo comió de su taza', a nombre de Caro");
  check(t["1_zoe_comida"] && t["1_zoe_comida"].pid === "caro", "…y la de Zoe como 'Zoe comió de su taza'");
  check(!t["1_milo_seco_1"] && !t["1_milo_seco_2"] && !t["1_zoe_seco_2"], "las tomas viejas ya no quedan sueltas");
  check(t["1_milo_humedo"] && t["1_piedras"], "el húmedo y las piedras quedan como estaban");
  check(((await leerCol("recorridos/viejo/tareas"))["1_milo_seco_1"] || {}).key === "milo_seco_1", "el recorrido viejo no se toca");
  await admin.waitForFunction(() => ![...document.querySelectorAll('[data-accion="pasar-visita"]')].length, null, { timeout: 10000 });
  check(true, "ya pasado, el botón desaparece");

  // ===== 2) Sofi va hoy =====
  const sofi = await pagina(null, { nombre:"sofi", ancho:390 });
  await sofi.goto(`${BASE}/index.html?r=oct`);
  await sofi.waitForSelector("#gateCodigoInput", { state:"visible", timeout: 10000 });
  await sofi.fill("#gateCodigoInput", "123456");
  await sofi.click("#gateCodigoEntrar");
  await sofi.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  const grupos = await sofi.$$eval("#panel-2 .task-group-title", els => els.map(e => e.textContent.trim()));
  check(JSON.stringify(grupos) === JSON.stringify(["Milo","Zoe","Antes de irte","General"]), "checklist del día: Milo, Zoe, Antes de irte, General (" + grupos.join(", ") + ")");
  const claves = await sofi.$$eval("#panel-2 .task", els => els.map(e => e.dataset.key));
  check(JSON.stringify(claves) === JSON.stringify(["milo_comida","milo_humedo","zoe_comida","zoe_humedo","gallito","agua","piedras"]), "7 ítems: comida de cada uno, húmedos, gallito, agua y piedras");
  check((await sofi.textContent('#panel-2 .task[data-key="zoe_comida"]')).includes("marca de la cinta"), "la comida de Zoe aclara la marca de la cinta");
  check((await sofi.textContent('#panel-2 .task[data-key="agua"]')).includes("opcional"), "el agua es opcional");
  check(await sofi.locator('.day-tab.done[data-day="1"]').count() === 1, "ayer (antes del cambio) queda completo sin gallito");
  await sofi.screenshot({ path: `${SHOTS}/01-checklist.png`, fullPage: true });

  // Primer tilde del día: aviso de la visita
  await sofi.click('#panel-2 .task[data-key="milo_comida"]');
  await sofi.waitForSelector("#gallitoOverlay.show", { timeout: 5000 });
  check((await sofi.textContent("#gallitoOverlay")).includes("Antes de irte, lo que quede va al gallito"), "primer tilde del día: aviso 'Para tu visita' con el gallito al irse");
  await sofi.screenshot({ path: `${SHOTS}/02-aviso.png` });
  await sofi.click("#gallitoClose");
  await sofi.click('#panel-2 .task[data-key="zoe_comida"]');
  await sofi.waitForTimeout(600);
  check(!(await sofi.evaluate(() => document.getElementById("modalOverlay").classList.contains("show"))), "con la comida de los dos todavía no hay festejo (falta el gallito)");
  check(!(await sofi.evaluate(() => document.getElementById("gallitoOverlay").classList.contains("show"))), "el aviso sale una sola vez por día");
  await sofi.click('#panel-2 .task[data-key="gallito"]');
  await sofi.waitForSelector("#modalOverlay.show", { timeout: 5000 });
  check((await sofi.textContent("#festejoTexto")).includes("les dejaste el gallito"), "con los 3 obligatorios: festejo y galleta de la fortuna");
  await sofi.screenshot({ path: `${SHOTS}/03-festejo.png` });
  await sofi.click("#modalClose");
  await sofi.click('#panel-2 .task[data-key="agua"]');
  await sofi.waitForTimeout(800);
  const tareas = await leerCol("recorridos/oct/tareas");
  const pts = pid => Object.values(tareas).filter(x => x.pid === pid).reduce((s, x) => s + ({ piedras:20, gallito:15, agua:5, milo_humedo:15, zoe_humedo:15 }[x.key] || 10), 0);
  check(pts("sofi") === 40, `puntos de Sofi: comida 10 + 10, gallito 15, agua 5 = ${pts("sofi")}`);
  check((await sofi.textContent("#standings")).includes("40 pts"), "las posiciones muestran los 40 puntos de Sofi");
  const pct = await sofi.evaluate(() => ({ caro: calcularVictoria(tareas, "caro", recorrido), sofi: calcularVictoria(tareas, "sofi", recorrido, diaDeHoy()) }));
  check(pct.caro === 100, `Caro ayer hizo todo lo que se pedía (sin gallito antes del cambio): ${pct.caro}%`);
  check(pct.sofi === 100, `Sofi hoy, con los 3 obligatorios: ${pct.sofi}%`);
  const sinGallito = await sofi.evaluate(() => { const t = { ...tareas }; delete t["2_gallito"]; return calcularVictoria(t, "sofi", recorrido, diaDeHoy()); });
  check(sinGallito < 100, `sin dejar el gallito no llega al 100% (${sinGallito}%)`);
  check(await sofi.locator('.day-tab.done[data-day="2"]').count() === 1, "hoy queda completo");

  // Guía
  const guia = await sofi.textContent("#guia");
  check(guia.includes("Cómo es una visita") && guia.includes("aspiradora de mano") && !guia.includes("dormís en casa"), "la guía explica la visita y recomienda aspirar lo que queda del gallito");
  await sofi.evaluate(() => { document.querySelectorAll("#guia details")[1].open = true; document.documentElement.style.scrollBehavior = "auto"; document.querySelectorAll("#guia details")[1].scrollIntoView(); });
  await sofi.waitForTimeout(300);
  await sofi.screenshot({ path: `${SHOTS}/04-guia.png` });

  // ===== 3) El recorrido viejo conserva su checklist; los nuevos arrancan con el de visitas =====
  await admin.goto(`${BASE}/index.html?r=viejo&modo=admin`);
  await admin.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  check(await admin.locator('#panel-1 .task[data-key="milo_seco_1"]').count() === 1 && await admin.locator('#panel-1 .task[data-key="gallito"]').count() === 0, "el recorrido viejo sigue con sus tomas de seco");
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector(".recorrido-item", { timeout: 10000 });
  await admin.fill("#fNombre", "Diciembre");
  await admin.fill("#fFecha", iso(60));
  await admin.fill("#fPersonas .p-nombre", "Pam");
  await admin.click("#crearBtn");
  await esperar(admin, () => [...document.querySelectorAll(".recorrido-item")].some(e => e.textContent.includes("Diciembre")));
  const dic = Object.values(await leerCol("recorridos")).find(x => x.nombre === "Diciembre");
  check(dic && dic.checklist === "visita" && dic.checklistDesde === 1, "un recorrido nuevo arranca con el checklist de visitas");

  // Home: la guía también cambió
  const home = await pagina(null);
  await home.goto(`${BASE}/index.html`);
  await home.waitForSelector("#entrarHome", { state:"visible", timeout: 10000 });
  const guiaHome = await home.textContent("#landingWrap");
  check(guiaHome.includes("Cómo es una visita") && guiaHome.includes("marca de la cinta") && guiaHome.includes("aspiradora de mano"), "la guía de la home también explica la visita");

  check(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log(`\n${oks} ok, ${fallas} fallas`);
  await browser.close(); server.close(); await env.cleanup();
  process.exit(fallas ? 1 : 0);
})().catch(async e => { console.error(e); try{ await browser.close(); }catch(_){} process.exit(1); });
