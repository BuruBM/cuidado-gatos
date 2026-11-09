const http = require("http"); const fs = require("fs"); const path = require("path");
// Prueba de punta a punta de la encuesta de después del viaje, contra los emuladores de Firebase.
const { chromium } = require("playwright");
const REPO = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "capturas", "encuesta");
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, getDocs, collection } = require("firebase/firestore");

const tipos = { html:"text/html; charset=utf-8", js:"application/javascript", json:"application/json", png:"image/png", css:"text/css" };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split("?")[0]));
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipos[f.split(".").pop()] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(8769);
const BASE = "http://127.0.0.1:8769";

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
  await page.route(/\/comun\.js(\?.*)?$/, route => {
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
async function sinDesborde(page, nombre){
  const x = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(x <= 0, `${nombre}: sin scroll horizontal (${x}px)`);
}
async function abrirEncuesta(page, rid = "viaje"){
  await page.goto(`${BASE}/encuesta.html?r=${rid}`);
  await page.waitForSelector(".gate h1, .mensaje h1, .preg, .panel", { timeout: 10000 });
}
async function entrarConCodigoEn(page, codigo){
  await page.waitForSelector("#gCodigo", { timeout: 10000 });
  await page.fill("#gCodigo", codigo);
  await page.click("#gEntrar");
  await page.waitForSelector(".mensaje h1, .preg", { timeout: 10000 });
}
const tocar = (page, k, texto) => page.click(`[data-preg="${k}"] .op:text-is("${texto}")`);
const tocarValor = (page, k, v) => page.click(`[data-preg="${k}"] .op[data-v="${v}"]`);
const elegidas = (page, k) => page.$$eval(`[data-preg="${k}"] .op.on`, els => els.map(e => e.textContent.trim()));

const ADMIN = { sub:"uAdmin", email:"bm.blancom@gmail.com", email_verified:true, name:"Bárbara" };

(async () => {
  env = await initializeTestEnvironment({ projectId: "michis-en-casa", firestore: { rules: fs.readFileSync(REPO + "/firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 } });
  await env.clearFirestore();
  // Un viaje que ya terminó, con 3 personas y la encuesta todavía cerrada
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, "recorridos/viaje"), { nombre:"Viaje a Brasil", dias:5, fechaInicio:iso(-10), activo:true, creado:1, checklist:"visita" });
    for(const [id, nombre, codigo] of [["sofi","Sofi","123456"], ["caro","Caro","654321"], ["pam","Pam","222333"]]){
      await setDoc(doc(f, `recorridos/viaje/participantes/${id}`), { nombre, uid:null, recorridoNombre:"Viaje a Brasil" });
      await setDoc(doc(f, `recorridos/viaje/codigos/${id}`), { codigo });
      await setDoc(doc(f, `accesos/${codigo}`), { rid:"viaje", pid:id });
    }
  });
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});   // CHROMIUM: otro navegador ya instalado

  // ===== Cerrada: Sofi entra con su código y no puede responder =====
  const sofi = await pagina(null, { nombre:"Sofi" });
  await abrirEncuesta(sofi);
  check(await sofi.isVisible("#gCodigo"), "sin código, pide el código");
  await entrarConCodigoEn(sofi, "123456");
  check((await sofi.textContent(".mensaje h1")).includes("todavía no está abierta"), "cerrada: le avisa que todavía no está abierta");
  await sofi.goto(`${BASE}/index.html`);
  await sofi.waitForSelector("#pasadosWrap", { state:"visible", timeout: 10000 });
  await sofi.waitForTimeout(800);
  check(await sofi.$$eval(".encuesta-home", e => e.length) === 0, "cerrada: no aparece en la home");

  // ===== El admin la abre desde los resultados =====
  const admin = await pagina(ADMIN);
  await admin.goto(`${BASE}/admin.html`);
  await loginEn(admin);
  await admin.waitForSelector(".recorrido-item", { timeout: 10000 });
  check(await admin.isVisible('.recorrido-item a[href*="encuesta.html?r=viaje"]'), "admin: el recorrido tiene el link a la encuesta");
  await admin.click('.recorrido-item a[href*="encuesta.html?r=viaje"]');
  await admin.waitForSelector(".panel", { timeout: 10000 });
  check((await admin.textContent(".panel h2")).includes("Respondieron 0 de 3"), "admin: 0 de 3 respondieron");
  check((await admin.textContent(".tag")).includes("Cerrada"), "admin: figura cerrada");
  await admin.click("#toggle");
  await esperar(admin, () => document.querySelector(".tag.abierta"));
  check(((await leer("recorridos/viaje")) || {}).encuesta === true, "admin: al abrirla queda guardado en el recorrido");
  check(admin.dialogos.some(d => d.includes("¿Abrir la encuesta?")), "admin: confirma antes de abrirla");
  await admin.screenshot({ path: `${SHOTS}/01-admin-sin-respuestas.png`, fullPage: true });

  // ===== Abierta: Sofi la ve en la home y responde sin nombre =====
  await sofi.goto(`${BASE}/index.html`);
  await sofi.waitForSelector(".encuesta-home", { timeout: 10000 });
  check(true, "abierta: aparece en la home");
  await sofi.screenshot({ path: `${SHOTS}/02-home-con-encuesta.png` });
  await sofi.click(".encuesta-home");
  await sofi.waitForSelector(".preg", { timeout: 10000 });
  check(await sofi.$$eval(".preg", e => e.length) === 15, "el formulario tiene 15 preguntas");
  await sinDesborde(sofi, "formulario");
  await tocarValor(sofi, "general", 4);
  await tocar(sofi, "codigo", "Muy fácil");
  await tocar(sofi, "partes", "Turnos para anotarme");
  await tocar(sofi, "partes", "Checklist de cada visita");
  await tocar(sofi, "puntos", "Me motivaron a hacerlo mejor");
  await tocar(sofi, "puntos", "Me dieron igual");
  check(JSON.stringify(await elegidas(sofi, "puntos")) === '["Me dieron igual"]', "opción única: elegir otra reemplaza la anterior");
  await tocar(sofi, "tranquilidad", "Una foto de cada visita");
  await tocar(sofi, "tranquilidad", "Un video cortito");
  await tocar(sofi, "tranquilidad", "La hora en que llegó y se fue");
  check((await elegidas(sofi, "tranquilidad")).length === 2, "hasta 2: la tercera no se marca");
  await tocar(sofi, "tranquilidad", "Un video cortito");
  check((await elegidas(sofi, "tranquilidad")).length === 1, "tocar una marcada la desmarca");
  await tocarValor(sofi, "nps", 9);
  await tocar(sofi, "modelo", "Que Les Gates me consiga cuidadores pagos de confianza");
  await sofi.fill('textarea[data-k="cambio"]', "Que avise cuando falta comida");
  await sofi.screenshot({ path: `${SHOTS}/03-formulario.png`, fullPage: true });
  await sofi.click("#enviar");
  await sofi.waitForSelector(".mensaje h1", { timeout: 10000 });
  check((await sofi.textContent(".mensaje h1")).includes("¡Gracias!"), "Sofi: al enviar, le agradece");
  check(!!(await leer("recorridos/viaje/encuestaHecha/sofi")), "Sofi: queda marcada como respondida");
  let resp = Object.values(await leerCol("recorridos/viaje/encuestas"));
  check(resp.length === 1, "hay 1 respuesta guardada");
  check(resp[0] && !resp[0].nombre && !JSON.stringify(resp[0]).includes("sofi"), "sin nombre: la respuesta no dice de quién es");
  check(resp[0] && resp[0].r.general === 4 && resp[0].r.nps === 9 && resp[0].r.puntos === "Me dieron igual"
    && JSON.stringify(resp[0].r.tranquilidad) === '["Una foto de cada visita"]' && resp[0].r.cambio === "Que avise cuando falta comida"
    && !("foto" in resp[0].r), "se guarda exactamente lo que respondió (y nada de lo que dejó sin responder)");
  await abrirEncuesta(sofi);
  check((await sofi.textContent(".mensaje h1")).includes("Ya respondiste"), "Sofi: si vuelve, ya respondió");
  await sofi.goto(`${BASE}/index.html`);
  await sofi.waitForSelector("#pasadosWrap", { state:"visible", timeout: 10000 });
  await sofi.waitForTimeout(800);
  check(await sofi.$$eval(".encuesta-home", e => e.length) === 0, "Sofi: ya no le aparece en la home");

  // ===== Caro responde con su nombre (desde el link de WhatsApp, en modo oscuro) =====
  const caro = await pagina(null, { nombre:"Caro", esquema:"dark" });
  await abrirEncuesta(caro);
  await entrarConCodigoEn(caro, "654321");
  check(await caro.isVisible(".preg"), "Caro: con el link directo entra y ve el formulario");
  const enviarVacio = await caro.click("#enviar").then(() => caro.textContent("#error"));
  check(enviarVacio.includes("al menos una"), "vacía no se envía");
  await tocarValor(caro, "general", 5);
  await tocarValor(caro, "nps", 6);
  await tocar(caro, "hoy", "Grupo de WhatsApp");
  await tocar(caro, "pagarias", "Lo que sale un café");
  await caro.fill('textarea[data-k="confuso"]', "No sabía si tenía que tildar el agua");
  await caro.check("#conNombre");
  await caro.screenshot({ path: `${SHOTS}/04-oscuro-formulario.png`, fullPage: true });
  await caro.click("#enviar");
  await caro.waitForSelector(".mensaje h1", { timeout: 10000 });
  resp = Object.values(await leerCol("recorridos/viaje/encuestas"));
  check(resp.length === 2 && resp.filter(r => r.nombre === "Caro").length === 1, "Caro: su respuesta va con su nombre");

  // ===== Resultados =====
  await admin.reload();
  await admin.waitForSelector(".panel", { timeout: 10000 });
  check((await admin.textContent(".panel h2")).includes("Respondieron 2 de 3"), "admin: 2 de 3 respondieron");
  const quienes = await admin.$$eval(".quienes span", els => els.map(e => e.textContent.trim()));
  check(quienes.includes("✓ Sofi") && quienes.includes("✓ Caro") && quienes.includes("Pam"), "admin: ve quiénes respondieron y quién falta");
  const texto = await admin.textContent("#app");
  check(texto.includes("4,5 de 5 en promedio"), "admin: promedio de la nota general");
  check(texto.includes("NPS 0") && texto.includes("promedio 7,5 de 10"), "admin: NPS (1 promotor, 1 detractor = 0)");
  check(texto.includes("No sabía si tenía que tildar el agua") && texto.includes("Que avise cuando falta comida"), "admin: ve los textos");
  check(await admin.$$eval(".textos div b", els => els.map(e => e.textContent).join()) === "Caro", "admin: solo el texto de Caro lleva nombre");
  await admin.screenshot({ path: `${SHOTS}/05-admin-resumen.png`, fullPage: true });
  await admin.click('[data-vista="una"]');
  check(await admin.$$eval(".resp", e => e.length) === 2, "admin: una por una muestra las 2");
  check((await admin.textContent("#app")).includes("sin nombre"), "admin: la de Sofi figura sin nombre");
  await admin.screenshot({ path: `${SHOTS}/06-admin-una-por-una.png`, fullPage: true });
  const [descarga] = await Promise.all([admin.waitForEvent("download"), admin.click("#csv")]);
  const csv = fs.readFileSync(await descarga.path(), "utf8");
  check(descarga.suggestedFilename() === "encuesta-viaje-a-brasil.csv" && csv.split("\r\n").length === 3 && csv.includes('"Caro"') && csv.includes("Grupo de WhatsApp"), "admin: descarga el CSV con las 2 respuestas");
  await sinDesborde(admin, "resultados");

  // Vista previa del admin: se ve, pero no envía
  await admin.goto(`${BASE}/encuesta.html?r=viaje&ver=form`);
  await admin.waitForSelector(".preg", { timeout: 10000 });
  check(await admin.isDisabled("#enviar"), "admin: en la vista previa no se puede enviar");

  // Cerrada otra vez: Pam ya no puede responder
  await admin.goto(`${BASE}/encuesta.html?r=viaje`);
  await admin.waitForSelector("#toggle", { timeout: 10000 });
  await admin.click("#toggle");
  await esperar(admin, () => document.querySelector(".tag.cerrada"));
  const pam = await pagina(null, { nombre:"Pam" });
  await abrirEncuesta(pam);
  await entrarConCodigoEn(pam, "222333");
  check((await pam.textContent(".mensaje h1")).includes("todavía no está abierta"), "cerrada de nuevo: Pam no puede responder");

  check(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log(`\n${oks} ok, ${fallas} fallas`);
  await browser.close(); server.close(); await env.cleanup();
  process.exit(fallas ? 1 : 0);
})().catch(async e => { console.error(e); try{ await browser.close(); }catch(_){} process.exit(1); });
