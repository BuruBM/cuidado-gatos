const http = require("http"); const fs = require("fs"); const path = require("path");
// Prueba de punta a punta de la página de turnos (y de los borradores), contra los emuladores de Firebase.
const { chromium } = require("playwright");
const REPO = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "capturas", "turnos");
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, getDocs, collection } = require("firebase/firestore");

const tipos = { html:"text/html; charset=utf-8", js:"application/javascript", json:"application/json", png:"image/png", css:"text/css" };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split("?")[0]));
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipos[f.split(".").pop()] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(8768);
const BASE = "http://127.0.0.1:8768";

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
  await page.waitForSelector(".resumen, .mensaje h1", { timeout: 10000 });
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

const PAM = { sub:"uPam", email:"pame@x.com", email_verified:true, name:"Pamela" };
const JULI = { sub:"uJuli", email:"juli@x.com", email_verified:true, name:"Julieta" };
const ADMIN = { sub:"uAdmin", email:"bm.blancom@gmail.com", email_verified:true, name:"Bárbara" };

(async () => {
  env = await initializeTestEnvironment({ projectId: "michis-en-casa", firestore: { rules: fs.readFileSync(REPO + "/firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 } });
  await env.clearFirestore();
  // Recorrido de 11 días que empezó ayer: ayer ya pasó, hoy y los que vienen se pueden tomar
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, "recorridos/oct"), { nombre:"Cuidado Octubre", dias:11, fechaInicio:iso(-1), activo:true, creado:2 });
    for(const [id, nombre] of [["pam","Pam"], ["sofi","Sofi"], ["juli","Juli"], ["caro","Caro"]])
      await setDoc(doc(f, `recorridos/oct/participantes/${id}`), { nombre, uid:null, recorridoNombre:"Cuidado Octubre" });
    await setDoc(doc(f, "recorridos/oct/codigos/sofi"), { codigo:"123456" });
    await setDoc(doc(f, "recorridos/oct/codigos/caro"), { codigo:"654321" });
    await setDoc(doc(f, `recorridos/oct/turnos/${iso(-1)}`), { fecha:iso(-1), pid:"caro", nombre:"Caro", comentario:"Llegué 19 h", uid:null, actualizado:1 });
    await setDoc(doc(f, "recorridos/borr"), { nombre:"Viaje secreto", dias:3, fechaInicio:iso(20), activo:true, borrador:true, creado:3 });
    await setDoc(doc(f, "recorridos/borr/participantes/pam"), { nombre:"Pam", uid:null });
  });
  browser = await chromium.launch();

  // ===== 1) Sin cuenta: ve todo, sin entrar =====
  const sofi = await pagina(null, { nombre:"sofi", ancho:360 });
  await abrirTurnos(sofi);
  check((await sofi.textContent(".resumen")).includes("1 de 11"), "sin cuenta: ve el contador (1 de 11 cubiertos)");
  check(await sofi.locator(".celda.ok").count() === 1 && await sofi.locator(".celda.libre").count() === 10, "calendario: 1 día cubierto y 10 libres");
  check(await sofi.locator(".seg [data-filtro]").count() === 0, "sin cuenta: no aparece el filtro Mis días");
  check((await sofi.textContent(".detalle")).includes("Libre") && await sofi.locator(".detalle [data-anotar]").count() === 1, "calendario: hoy seleccionado, libre, con Anotarme");
  await sofi.click(`.celda[data-fecha="${iso(-1)}"]`);
  check((await sofi.textContent(".detalle")).includes("Caro") && (await sofi.textContent(".detalle")).includes("Llegué 19 h"), "tocar un día muestra quién va y su comentario");
  check(await sofi.locator(".detalle [data-editar]").count() === 0, "sin cuenta: no puede editar el día de otro");
  await sinDesborde(sofi, "turnos a 360px");
  const altoArriba = await sofi.evaluate(() => document.querySelector(".cal").getBoundingClientRect().top);
  check(altoArriba < 520, `el calendario entra en la primera pantalla (${Math.round(altoArriba)}px)`);
  const bienvenida = await sofi.textContent(".bienvenida");
  check(bienvenida.includes("necesitan quién los cuide") && await sofi.locator(".bienvenida .guia-btn[href='index.html?r=oct']").count() === 1, "primer contacto: bienvenida con acceso a 📖 Guía y tareas");
  await sofi.screenshot({ path: `${SHOTS}/01-calendario-sin-cuenta.png`, fullPage: true });
  await sofi.click(`.celda[data-fecha="${iso(-1)}"]`);

  // Lista: el día que ya pasó no se puede tomar
  await sofi.click(`.seg.vista [data-vista="lista"]`);
  check(await sofi.locator(".fila").count() === 11, "lista: 11 filas");
  check(await sofi.locator(`[data-fila="${iso(-1)}"] [data-anotar]`).count() === 0, "lista: el día que ya pasó no tiene Anotarme");
  await sofi.screenshot({ path: `${SHOTS}/02-lista-sin-cuenta.png`, fullPage: true });
  await sofi.reload(); await sofi.waitForSelector(".resumen");
  check(await sofi.locator(".fila").count() === 11, "la vista elegida (lista) se recuerda al volver");

  // ===== 2) Anotarse con código =====
  await sofi.click(`[data-fila="${iso(2)}"] [data-anotar]`);
  await sofi.waitForSelector("#velo.show");
  check(await sofi.locator("#hoja .persona").count() === 4, "anotarse: primero elige su nombre de la lista (4 personas)");
  await sofi.click(`#hoja [data-persona="sofi"]`);
  check(await sofi.locator("#hCodigo").count() === 1, "anotarse sin cuenta: pide el código");
  check(await sofi.locator('#hoja [data-h="google"]').count() === 1, "anotarse sin cuenta: ofrece Google como alternativa");
  await sofi.fill("#hComentario", "Voy a la tarde <b>18 h</b>");
  await sofi.fill("#hCodigo", "111111");
  await sofi.click('[data-h="guardar"]');
  await esperar(sofi, () => (document.querySelector("#hoja .aviso") || {}).textContent);
  check((await avisoHoja(sofi)).includes("no es correcto"), "código incorrecto: avisa y no anota");
  check(!(await leer(`recorridos/oct/turnos/${iso(2)}`)), "código incorrecto: el día sigue libre");
  check((await sofi.inputValue("#hComentario")).includes("18 h"), "código incorrecto: no se pierde el comentario escrito");
  await sofi.fill("#hCodigo", "123456");
  await sofi.click('[data-h="guardar"]');
  await hojaCerrada(sofi);
  await esperar(sofi, f => document.querySelector(`[data-fila="${f}"].ok`), iso(2));
  const t1 = await leer(`recorridos/oct/turnos/${iso(2)}`);
  check(t1 && t1.pid === "sofi" && t1.comentario === "Voy a la tarde <b>18 h</b>", "código correcto: queda anotada con su comentario");
  check((await leer("recorridos/oct/participantes/sofi")).uid === t1.uid, "código correcto: su nombre queda vinculado a este celular");
  check(await sofi.locator(`[data-fila="${iso(2)}"] .c b`).count() === 0 && (await sofi.textContent(`[data-fila="${iso(2)}"] .c`)).includes("<b>"), "el comentario se muestra como texto (sin inyectar HTML)");
  check(await sofi.locator(`[data-fila="${iso(2)}"].mio`).count() === 1, "su día aparece marcado como suyo (VOS)");

  // Segundo día: ya no pide nombre ni código
  await sofi.click(`[data-fila="${iso(5)}"] [data-anotar]`);
  await sofi.waitForSelector("#velo.show");
  check(await sofi.locator("#hoja .persona").count() === 0 && await sofi.locator("#hCodigo").count() === 0 && (await sofi.textContent("#hoja .quien-elegido")).includes("Sofi"), "segundo día: ya sabe quién es (no pide nombre ni código)");
  await sofi.click('[data-h="guardar"]');
  await hojaCerrada(sofi);
  await esperar(sofi, f => document.querySelector(`[data-fila="${f}"].ok`), iso(5));
  check(((await leer(`recorridos/oct/turnos/${iso(5)}`)) || {}).pid === "sofi", "segundo día anotado");

  // Filtro Mis días
  check((await sofi.textContent('[data-filtro="mis"]')).includes("(2)"), "aparece el filtro Mis días (2)");
  await sofi.click('[data-filtro="mis"]');
  check(await sofi.locator(".fila").count() === 2, "Mis días en lista: solo sus 2 días");
  await sofi.screenshot({ path: `${SHOTS}/03-mis-dias-lista.png`, fullPage: true });
  await sofi.click(`.seg.vista [data-vista="cal"]`);
  check(await sofi.locator(".cal.filtro").count() === 1 && (await sofi.getAttribute(".celda.sel", "data-fecha")) === iso(2), "Mis días en calendario: resalta los suyos y selecciona el primero");
  await sofi.screenshot({ path: `${SHOTS}/04-mis-dias-calendario.png`, fullPage: true });
  await sofi.click('[data-filtro="todos"]');

  // Editar y liberar
  await sofi.click(`.celda[data-fecha="${iso(5)}"]`);
  await sofi.click(".detalle [data-editar]");
  await sofi.waitForSelector("#velo.show");
  await sofi.fill("#hComentario", "Paso a las 9");
  await sofi.click('[data-h="guardar"]');
  await hojaCerrada(sofi);
  check(((await leer(`recorridos/oct/turnos/${iso(5)}`)) || {}).comentario === "Paso a las 9", "edita el comentario de su día");
  await sofi.click(".detalle [data-editar]");
  await sofi.click('[data-h="liberar"]');
  await hojaCerrada(sofi);
  await esperar(sofi, f => document.querySelector(`.celda.libre[data-fecha="${f}"]`), iso(5));
  check(!(await leer(`recorridos/oct/turnos/${iso(5)}`)), "libera su día y queda libre");

  // ===== 3) Dos personas a la vez sobre el mismo día =====
  const pam = await pagina(PAM);
  await abrirTurnos(pam);
  await loginEn(pam);
  await anotarDesdeLista(pam, iso(4));
  await pam.click(`#hoja [data-persona="pam"]`);
  check(await pam.locator("#hCodigo").count() === 0 && (await pam.textContent("#hoja")).includes("pame@x.com"), "con Google y el nombre libre: no pide código, vincula la cuenta");
  await sofi.click(`.seg.vista [data-vista="lista"]`);
  await sofi.click(`[data-fila="${iso(4)}"] [data-anotar]`);
  await sofi.waitForSelector("#velo.show");
  await pam.click('[data-h="guardar"]');
  await hojaCerrada(pam);
  check(((await leer(`recorridos/oct/turnos/${iso(4)}`)) || {}).pid === "pam", "Pam se anota primero");
  await esperar(sofi, () => (document.querySelector("#hoja .aviso") || {}).textContent);
  check((await avisoHoja(sofi)).includes("Alguien se anotó en este día recién. Elegí otro."), "a Sofi (con la hoja abierta) le avisa que alguien se anotó recién");
  check(await sofi.locator('[data-h="guardar"]:disabled').count() === 1, "y no la deja guardar ese día");
  await sofi.screenshot({ path: `${SHOTS}/05-alguien-se-anoto.png` });
  await sofi.click('[data-h="cancelar"]');
  // Carrera real: la hoja todavía no se enteró y el guardado choca con el día tomado
  await sofi.click(`[data-fila="${iso(6)}"] [data-anotar]`);
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), `recorridos/oct/turnos/${iso(6)}`), { fecha:iso(6), pid:"pam", nombre:"Pam", comentario:"", uid:"uPam", actualizado:2 }));
  await sofi.waitForTimeout(600);
  // Simula que el aviso en vivo no llegó a tiempo: la hoja cree que el día sigue libre
  await sofi.evaluate(() => { hoja.aviso = ""; hoja.ocupado = false; document.querySelector('[data-h="guardar"]').disabled = false; });
  await sofi.click('[data-h="guardar"]');
  await esperar(sofi, () => (document.querySelector("#hoja .aviso") || {}).textContent);
  check((await avisoHoja(sofi)).includes("Alguien se anotó"), "carrera al guardar: la transacción no pisa y avisa");
  check(((await leer(`recorridos/oct/turnos/${iso(6)}`)) || {}).pid === "pam", "carrera al guardar: el día sigue siendo de quien llegó primero");
  await sofi.click('[data-h="cancelar"]');
  await hojaCerrada(sofi);
  check(await pam.locator(`[data-fila="${iso(2)}"] [data-editar]`).count() === 0, "Pam no ve Editar en el día de Sofi");

  // ===== 4) Google: nombre ya vinculado a otra cuenta pide código =====
  const juli = await pagina(JULI);
  await abrirTurnos(juli);
  await loginEn(juli);
  await anotarDesdeLista(juli, iso(7));
  await juli.click(`#hoja [data-persona="sofi"]`);
  check(await juli.locator("#hCodigo").count() === 1, "con Google, un nombre ya vinculado pide el código");
  await juli.click("#hoja [data-cambiar]");
  await juli.click(`#hoja [data-persona="juli"]`);
  await juli.click('[data-h="guardar"]');
  await hojaCerrada(juli);
  const tJuli = (await leer(`recorridos/oct/turnos/${iso(7)}`)) || {};
  const juliUid = await juli.evaluate(() => auth.currentUser.uid);
  check(tJuli.pid === "juli" && tJuli.uid === juliUid && (await leer("recorridos/oct/participantes/juli")).uid === juliUid, "Juli entra con Google desde turnos y queda anotada");

  // Entrar a turnos sirve para el recorrido (una sola entrada)
  await juli.click(".guia-btn");
  await juli.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  check((await juli.textContent("#appSession")).includes("Juli"), "después de anotarse, 'Guía y tareas' entra directo como Juli");
  // En el recorrido: quién viene cada día y cuáles son los suyos (día 1 = ayer)
  await esperar(juli, () => document.querySelector('.day-tab[data-day="9"].mio'));
  check((await juli.textContent('.day-tab[data-day="9"] .dt-quien')) === "Vos", "recorrido: su día (el 9) está marcado como Vos");
  check((await juli.textContent('.day-tab[data-day="1"] .dt-quien')) === "Caro", "recorrido: cada pestaña muestra quién viene (día 1: Caro)");
  check((await juli.textContent('.day-tab[data-day="5"] .dt-quien')) === "libre", "recorrido: los días sin nadie dicen 'libre'");
  check((await juli.locator(".day-tab").count()) === 11 && await juli.locator('.day-tab.hoy[data-day="2"]').count() === 1, "recorrido: 11 pestañas con fecha y 'hoy' en el día de hoy");
  await juli.click('.day-tab[data-day="9"]');
  check((await juli.textContent("#turno-9")).includes("Es tu día"), "recorrido: arriba de las tareas de su día dice 'Es tu día'");
  await juli.click('.day-tab[data-day="1"]');
  check((await juli.textContent("#turno-1")).includes("Viene Caro") && (await juli.textContent("#turno-1")).includes("Llegué 19 h"), "recorrido: en otro día dice quién viene y su comentario");
  await juli.click('.day-tab[data-day="5"]');
  check(await juli.locator("#turno-5 a", { hasText: "Anotarme" }).count() === 1, "recorrido: un día libre ofrece anotarse");
  const altoTab = await juli.evaluate(() => document.querySelector('.day-tab[data-day="9"]').getBoundingClientRect().height);
  check(altoTab <= 58, `recorrido: pestañas de los días compactas (${Math.round(altoTab)}px de alto)`);
  // Recordatorios: solo en sus días de turnos
  const nota = await juli.textContent("#notifDiasNota");
  const [, mJ, dJ] = iso(7).split("-");
  check(nota.includes("solo en tus días") && nota.includes(`${Number(dJ)}/${Number(mJ)}`), "recordatorios: avisa que llegan solo en sus días de turnos");
  check(JSON.stringify(await juli.evaluate(() => misFechasDeTurno())) === JSON.stringify([iso(7)]), "recordatorios: sus días son solo el que se anotó");
  const disparos = await juli.evaluate(async (hoyEsSuDia) => {
    const orig = window.mostrarNotificacion, avisos = [];
    window.mostrarNotificacion = async (t, c) => avisos.push(c);
    Object.defineProperty(window, "Notification", { value: { permission: "granted" }, configurable: true });
    const hhmm = new Date().toTimeString().slice(0,5);
    document.getElementById("notif-manana-on").checked = true;
    document.getElementById("notif-manana-hora").value = hhmm;
    checkReminders();
    window.mostrarNotificacion = orig;
    return avisos.length;
  });
  check(disparos === 0, "recordatorios: hoy no es su día de turnos, no le llega el aviso");
  await juli.click('.day-tab[data-day="9"]');
  await juli.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, document.getElementById("tareas").getBoundingClientRect().top + window.scrollY - 10); });
  await juli.waitForTimeout(300);
  await juli.screenshot({ path: `${SHOTS}/06a-recorrido-dias.png` });
  const nav = await juli.evaluate(() => ({ href: document.getElementById("navTurnos").getAttribute("href"), desborde: document.querySelector(".app-nav").scrollWidth - document.querySelector(".app-nav").clientWidth }));
  check(nav.href === "turnos.html?r=oct", "el recorrido tiene el acceso 🗓️ Turnos a esta página");
  check(nav.desborde <= 0, `los 5 accesos del recorrido entran en una línea a 390px (${nav.desborde}px)`);
  await juli.setViewportSize({ width: 360, height: 800 });
  const desborde360 = await juli.evaluate(() => document.querySelector(".app-nav").scrollWidth - document.querySelector(".app-nav").clientWidth);
  check(desborde360 <= 0, `los 5 accesos entran en una línea a 360px (${desborde360}px)`);
  await juli.screenshot({ path: `${SHOTS}/06-recorrido-nav.png` });

  // ===== 5) Admin =====
  const admin = await pagina(ADMIN);
  await abrirTurnos(admin);
  await loginEn(admin);
  await esperar(admin, () => document.querySelector(".pie") && document.querySelector(".pie").textContent.includes("admin"));
  check(await admin.locator(`.celda[data-fecha="${iso(-1)}"]`).count() === 1, "admin ve el calendario");
  await admin.click(`.celda[data-fecha="${iso(-1)}"]`);
  check(await admin.locator(".detalle [data-editar]").count() === 1, "admin puede editar hasta un día que ya pasó");
  await admin.click(".detalle [data-editar]");
  await admin.click(`#hoja [data-persona="juli"]`);
  await admin.click('[data-h="guardar"]');
  await hojaCerrada(admin);
  check(((await leer(`recorridos/oct/turnos/${iso(-1)}`)) || {}).pid === "juli", "admin cambia quién fue un día");
  await admin.click(`.celda[data-fecha="${iso(8)}"]`);
  await admin.click(".detalle [data-anotar]");
  check(await admin.locator("#hCodigo").count() === 0 && await admin.locator("#hoja .persona").count() === 4, "admin anota a cualquiera sin código");
  await admin.click(`#hoja [data-persona="caro"]`);
  await admin.click('[data-h="guardar"]');
  await hojaCerrada(admin);
  check(((await leer(`recorridos/oct/turnos/${iso(8)}`)) || {}).pid === "caro", "admin anota a Caro");
  await admin.click(`.celda[data-fecha="${iso(2)}"]`);
  await admin.click(".detalle [data-editar]");
  await admin.click('[data-h="liberar"]');
  await hojaCerrada(admin);
  check(!(await leer(`recorridos/oct/turnos/${iso(2)}`)), "admin libera el día de Sofi");
  await esperar(sofi, f => document.querySelector(`[data-fila="${f}"].libre`), iso(2));
  check(true, "Sofi ve el cambio sin recargar");

  // Admin: contador de turnos, borrador y publicar
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector(".recorrido-item", { timeout: 10000 });
  await esperar(admin, () => [...document.querySelectorAll(".turnos-cuenta")].some(e => /días cubiertos/.test(e.textContent)));
  const cuenta = await admin.evaluate(() => [...document.querySelectorAll(".turnos-cuenta")].map(e => e.textContent).join(" | "));
  check(cuenta.includes("5 de 11"), `admin ve cuántos días están cubiertos (${cuenta})`);
  const borrItem = admin.locator(".recorrido-item", { hasText: "Viaje secreto" });
  check((await borrItem.textContent()).includes("borrador") && await borrItem.locator('[data-accion="publicar"]').count() === 1, "el borrador se ve en el admin con el botón Publicar");
  await admin.fill("#fNombre", "Finde largo");
  await admin.fill("#fFecha", iso(30));
  await admin.fill("#fPersonas .p-nombre", "Pam");
  await admin.click("#borradorBtn");
  await esperar(admin, () => [...document.querySelectorAll(".recorrido-item")].some(e => e.textContent.includes("Finde largo")));
  const finde = Object.entries(await leerCol("recorridos")).find(([, r]) => r.nombre === "Finde largo");
  check(finde && finde[1].borrador === true, "Guardar borrador crea el recorrido como borrador");
  await admin.screenshot({ path: `${SHOTS}/07-admin.png`, fullPage: true });

  // ===== 6) El borrador no se ve =====
  const otra = await pagina(null, { nombre:"otra" });
  await otra.goto(`${BASE}/index.html`);
  await otra.waitForSelector("#recorridosActivos .recorrido-btn", { timeout: 10000 });
  await otra.waitForTimeout(800);
  const home = await otra.textContent("#landingWrap");
  check(home.includes("Cuidado Octubre") && !home.includes("Viaje secreto") && !home.includes("Finde largo"), "home: los borradores no aparecen");
  await esperar(otra, () => document.querySelector(".turnos-home"));
  check((await otra.textContent(".turnos-home")).includes("5 de 11 cubiertos"), "home: línea de turnos con los días cubiertos");
  check(await otra.locator(".turnos-home").count() === 1, "home: una sola línea de turnos (el borrador no suma)");
  await otra.screenshot({ path: `${SHOTS}/08-home.png` });
  await abrirTurnos(otra, "borr");
  check((await otra.textContent(".mensaje")).includes("todavía no está publicado"), "turnos de un borrador: 'todavía no está publicado'");
  await otra.goto(`${BASE}/index.html?r=borr`);
  await esperar(otra, () => document.getElementById("gateSubtitle").textContent.includes("publicado"));
  check(await otra.locator("#gateLoginStep:visible").count() === 0, "recorrido borrador: no ofrece entrar");
  await admin.goto(`${BASE}/turnos.html?r=borr`);
  await admin.waitForSelector(".resumen", { timeout: 10000 });
  check(true, "admin sí ve los turnos del borrador");
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector(".recorrido-item");
  await admin.locator(".recorrido-item", { hasText: "Viaje secreto" }).locator('[data-accion="publicar"]').click();
  await esperar(admin, () => [...document.querySelectorAll(".recorrido-item")].some(e => e.textContent.includes("Viaje secreto") && e.textContent.includes("activo")));
  check((await leer("recorridos/borr")).borrador === false, "Publicar lo saca de borrador");
  await abrirTurnos(otra, "borr");
  check(await otra.locator(".resumen").count() === 1, "publicado: los turnos ya se ven");

  // Bienvenida editable desde el admin
  await admin.goto(`${BASE}/admin.html`);
  await admin.waitForSelector(".recorrido-item");
  const itemOct = admin.locator(".recorrido-item", { hasText: "Cuidado Octubre" });
  await itemOct.locator('[data-accion="editar"]').click();
  await itemOct.locator(".e-bienvenida").fill("¡Hola! Nos vamos de viaje 🧳\nAnotate en los días que puedas <3");
  await itemOct.locator('[data-accion="guardar"]').click();
  await esperar(admin, () => document.getElementById("toast").textContent.includes("guardados"));
  await abrirTurnos(otra);
  const bienv = await otra.textContent(".bienvenida p");
  check(bienv.includes("Nos vamos de viaje") && bienv.includes("<3") && !bienv.includes("necesitan quién"), "la bienvenida de turnos se edita desde el admin (y se muestra como texto)");
  check(await otra.evaluate(() => document.querySelector(".bienvenida p").innerText.split("\n").length) === 2, "la bienvenida respeta los saltos de línea");

  // % de victoria con turnos: un día vacío con alguien anotado le resta solo a esa persona
  const pct = await otra.evaluate(() => {
    const r = { dias: 3, fechaInicio: "2020-03-01" };
    const tareas = {};
    ["milo_seco_1","milo_seco_2","zoe_seco_1","zoe_seco_2","piedras"].forEach(k => tareas["1_" + k] = { dia: 1, key: k, pid: "ana" });
    const turnosB = { "2020-03-02": { pid: "beto" } };
    return {
      anaSin: calcularVictoria(tareas, "ana", r),
      anaCon: calcularVictoria(tareas, "ana", r, undefined, turnosB),
      betoSin: calcularVictoria(tareas, "beto", r),
      betoCon: calcularVictoria(tareas, "beto", r, undefined, turnosB),
      futuro: calcularVictoria({}, "beto", { dias: 3, fechaInicio: "2999-01-01" }, undefined, { "2999-01-02": { pid: "beto" } })
    };
  });
  check(pct.anaSin === 36 && pct.betoSin === null, `% sin turnos: igual que antes (Ana 36%, Beto sin días) → ${JSON.stringify(pct)}`);
  check(pct.anaCon === 50, `% con turnos: el día vacío de Beto ya no le resta a Ana (50%) → ${pct.anaCon}`);
  check(pct.betoCon === 0, `% con turnos: a Beto, anotado y sin tildar nada, le resta su día (0%) → ${pct.betoCon}`);
  check(pct.futuro === null, "% con turnos: si su día todavía no llegó, no muestra %");

  // ===== 7) Modo oscuro =====
  const oscuro = await pagina(null, { nombre:"oscuro", esquema:"dark", ancho:375 });
  await abrirTurnos(oscuro);
  const fondos = await oscuro.evaluate(() => {
    const ok = document.querySelector(".celda.ok"), libre = document.querySelector(".celda.libre");
    return [getComputedStyle(ok).backgroundColor, getComputedStyle(libre).backgroundColor, getComputedStyle(document.body).backgroundColor];
  });
  check(new Set(fondos).size === 3, `oscuro: día con alguien, día libre y fondo tienen colores distintos (${fondos.join(" / ")})`);
  await oscuro.screenshot({ path: `${SHOTS}/09-oscuro-calendario.png`, fullPage: true });
  await oscuro.click(`.seg.vista [data-vista="lista"]`);
  await oscuro.screenshot({ path: `${SHOTS}/10-oscuro-lista.png`, fullPage: true });

  check(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log(`\n${oks} ok, ${fallas} fallas`);
  await browser.close(); server.close(); await env.cleanup();
  process.exit(fallas ? 1 : 0);
})().catch(async e => { console.error(e); try{ await browser.close(); }catch(_){} process.exit(1); });
