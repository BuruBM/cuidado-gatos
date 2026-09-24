const http = require("http"); const fs = require("fs"); const path = require("path");
// Prueba de punta a punta: un recorrido de 3 días con 4 personas, contra los emuladores de Firebase.
const { chromium } = require("playwright");
const REPO = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "capturas");
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDocs, collection } = require("firebase/firestore");

const tipos = { html:"text/html; charset=utf-8", js:"application/javascript", json:"application/json", png:"image/png", css:"text/css" };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split("?")[0]));
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipos[f.split(".").pop()] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(8766);
const BASE = "http://127.0.0.1:8766";

const iso = (offset) => { const d = new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const errores = [];
let fallas = 0, oks = 0;
const check = (cond, msg) => { if(cond) oks++; else fallas++; console.log((cond ? "ok - " : "FALLA - ") + msg); };

let browser, env;
async function pagina(cuenta, opts = {}){
  const ctx = await browser.newContext({ viewport: { width: opts.ancho || 400, height: 860 }, serviceWorkers: "block",
    userAgent: opts.ua, permissions: opts.permisos || [], colorScheme: opts.esquema || "light" });
  const page = await ctx.newPage();
  page.nombre = (cuenta && cuenta.name) || "anon";
  page.dialogos = [];
  page.on("pageerror", e => errores.push(page.nombre + ": " + e.message));
  page.on("console", m => { if(m.type() === "error" && !/PERMISSION_DENIED|permission|ERR_FAILED|Failed to load resource/i.test(m.text())) errores.push(page.nombre + ": " + m.text()); });
  page.on("dialog", d => { page.dialogos.push(d.message()); d.type() === "prompt" ? d.accept(page.respuestaPrompt || "ELIMINAR") : d.accept(); });
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
const login = (page) => page.evaluate(c => window.__login(c), page.cuenta);
async function elegir(page, nombre){
  await page.waitForSelector("#gatePersonas .gate-persona", { timeout: 10000 });
  await page.locator("#gatePersonas .gate-persona", { hasText: nombre }).first().click();
  await page.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
}
const cerrarModales = (page) => page.evaluate(() => document.querySelectorAll(".modal-overlay.show").forEach(m => m.classList.remove("show")));
async function irADia(page, d){ await page.click(`.day-tab[data-day="${d}"]`); }
async function tildar(page, d, key){ await irADia(page, d); await page.click(`#panel-${d} .task[data-key="${key}"]`); }
async function esperarTarea(page, d, key, quien){
  await page.waitForFunction(([d,key,quien]) => {
    const el = document.querySelector(`#panel-${d} .task[data-key="${key}"] .task-by`);
    return el && el.textContent.includes(quien);
  }, [d, key, quien], { timeout: 10000 });
}
async function guardado(page){ await page.waitForFunction(() => !document.querySelector(".task[data-busy]"), null, { timeout: 10000 }); await page.waitForTimeout(150); }
async function toast(page){ await page.waitForFunction(() => document.getElementById("toast") && document.getElementById("toast").classList.contains("show"), null, { timeout: 5000 }); return page.textContent("#toast"); }
async function moverFecha(rid, offset){ await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "recorridos/" + rid), { fechaInicio: iso(offset) }, { merge: true })); }
async function leerTareas(rid){
  let out = {};
  await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), `recorridos/${rid}/tareas`))).forEach(d => out[d.id] = d.data()); });
  return out;
}
async function leerParticipantes(rid){
  let out = {};
  await env.withSecurityRulesDisabled(async c => { (await getDocs(collection(c.firestore(), `recorridos/${rid}/participantes`))).forEach(d => out[d.id] = d.data()); });
  return out;
}
async function sinDesborde(page, nombre){
  const x = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(x <= 0, `${nombre}: sin scroll horizontal a 360px (${x}px)`);
}

// Oráculo independiente (misma regla que te expliqué, escrita de nuevo acá para comparar)
const OBLIG = ["milo_seco_1","milo_seco_2","zoe_seco_1","zoe_seco_2"];
const pts = k => k === "piedras" ? 20 : k.includes("humedo") ? 15 : 10;
function oraculo(tareas, pid, dias, hasta){
  const mios = Object.values(tareas).filter(t => t.pid === pid);
  if(!mios.length) return null;
  const susDias = new Set(mios.map(t => t.dia));
  const conAlgo = new Set(Object.values(tareas).map(t => t.dia));
  for(let d = 1; d <= hasta; d++) if(!conAlgo.has(d)) susDias.add(d);
  let pend = 0;
  susDias.forEach(d => {
    if(d > hasta) return;
    OBLIG.forEach(k => { if(!tareas[d+"_"+k]) pend++; });
    if(d >= 2 && !tareas[d+"_piedras"] && !tareas[(d-1)+"_piedras"]) pend++;
  });
  return Math.round(mios.length / (mios.length + pend) * 100);
}
const puntosOraculo = (tareas, pid) => Object.values(tareas).filter(t => t.pid === pid).reduce((s,t) => s + pts(t.key), 0);

(async () => {
  env = await initializeTestEnvironment({ projectId: "michis-en-casa", firestore: { rules: fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8"), host:"127.0.0.1", port:8089 } });
  await env.clearFirestore();
  browser = await chromium.launch();

  // ================= ADMIN: crear el recorrido desde el panel =================
  console.log("\n== Admin crea el recorrido ==");
  const adm = await pagina({ sub:"admin", email:"bm.blancom@gmail.com", email_verified:true, name:"Admin" });
  await adm.goto(BASE + "/admin.html");
  await adm.waitForSelector("#loginBtn"); await login(adm);
  await adm.waitForSelector("#panelWrap", { state:"visible" });
  check((await adm.inputValue("#fFecha")) === iso(0), "fecha por defecto = hoy en hora local");
  check(await adm.isVisible('#panelWrap a[href="index.html"]'), "el panel tiene 'Volver al inicio'");
  await adm.fill("#fNombre", "Prueba Octubre");
  await adm.fill("#fDias", "3");
  await adm.fill("#fPopup", "¡Gracias por venir! Cualquier cosa escribinos.");
  const nombres = ["Lauti", "Pam", "Juan", "Sofi", "Juana"];
  for(let i = 1; i < nombres.length; i++) await adm.click("#fAgregarPersona");
  const filas = await adm.$$("#fPersonas .persona-form");
  for(let i = 0; i < nombres.length; i++) await (await filas[i].$(".p-nombre")).fill(nombres[i]);
  await (await filas[0].$(".p-foto")).setInputFiles(REPO + "/icon-512.png");
  await adm.waitForSelector("#fPersonas .p-preview[src^='data:image']", { state:"attached" });
  await adm.click("#crearBtn");
  await adm.waitForSelector("#crearMsg a", { timeout: 15000 });
  check(adm.dialogos.some(m => m.includes('"Juan" y "Juana" se parecen')), "avisa que Juan y Juana se parecen");
  const link = await adm.getAttribute("#crearMsg a", "href");
  const rid = new URL(link).searchParams.get("r");
  check(!!rid, "recorrido creado, link: " + link.replace(/^https?:\/\/[^/]+/, ""));
  await adm.waitForFunction(() => document.querySelectorAll(".persona-row").length === 5, null, { timeout: 10000 });
  check(true, "admin ve las 5 personas");
  // Quitar a Juana (fue un error de carga)
  const filaJuana = adm.locator(".persona-row", { hasText: "Juana" });
  await filaJuana.locator('[data-p="quitar"]').click();
  await adm.waitForFunction(() => document.querySelectorAll(".persona-row").length === 4, null, { timeout: 10000 });
  check(true, "admin quita a Juana");
  const urlDe = (p) => `${BASE}/index.html?r=${rid}`;

  // ================= DÍA 1 =================
  console.log("\n== Día 1: entran Pam, Lauti y Juan ==");
  const pam = await pagina({ sub:"uPam", email:"pame@x.com", email_verified:true, name:"Pamela Gómez" }, { permisos:["notifications"] });
  const lau = await pagina({ sub:"uLau", email:"lauti@x.com", email_verified:true, name:"Lautaro Pérez" });
  const jua = await pagina({ sub:"uJua", email:"juan@x.com", email_verified:true, name:"" });

  for(const p of [pam, lau, jua]){ await p.goto(urlDe(p)); await p.waitForSelector("#gateLoginBtn", { state:"visible" }); }
  check(await pam.isHidden("#appWrap"), "sin login no se ve el recorrido");
  await pam.screenshot({ path: SHOTS + "/01-entrada.png" });

  // Pamela → "Pam"
  await login(pam);
  await pam.waitForSelector("#gatePersonas .gate-persona", { timeout: 10000 });
  const botones = await pam.$$eval("#gatePersonas .gate-persona-nombre", els => els.map(e => e.textContent.trim()));
  check(botones.length === 4 && ["Juan","Lauti","Pam","Sofi"].every(n => botones.some(b => b.startsWith(n))), "'¿Quién sos?' muestra las 4 personas: " + botones.join(", "));
  check(!(await pam.textContent("#gateSubtitle")).includes("Pamela"), "no asume quién sos por el nombre de Google");
  await pam.screenshot({ path: SHOTS + "/01b-quien-sos.png" });
  await elegir(pam, "Pam");
  check(pam.dialogos.some(m => m.includes("¿Sos Pam?") && m.includes("pame@x.com")), "Pamela elige 'Pam' y confirma con su mail");
  await pam.waitForSelector("#avisoOverlay.show");
  check((await pam.textContent("#avisoTexto")).includes("Gracias por venir"), "Pam ve el mensaje de bienvenida");
  await pam.click("#avisoClose");

  // Lautaro → "Lauti"
  await login(lau);
  await elegir(lau, "Lauti");
  check(lau.dialogos.some(m => m.includes("¿Sos Lauti?")), "Lautaro elige 'Lauti'");
  await lau.click("#avisoClose");
  const cara = await lau.getAttribute("#avatarFaceImg", "href");
  check(cara && cara.startsWith("data:image/png"), "Lauti usa la foto pixelada que cargó el admin");

  // Juan: el nombre de Pam ya está tomado
  await login(jua);
  await jua.waitForSelector("#gatePersonas .gate-persona", { timeout: 10000 });
  check(await jua.locator("#gatePersonas .gate-persona", { hasText: "Pam" }).isDisabled(), "Juan ve 'Pam' deshabilitado (ya entró)");
  check(await jua.locator("#gatePersonas .gate-persona", { hasText: "Lauti" }).isDisabled(), "…y 'Lauti' también");
  check((await jua.textContent("#gateError")).includes("¿No estás en la lista?"), "explica qué hacer si no está en la lista");
  await elegir(jua, "Juan");
  await jua.click("#avisoClose");
  check(true, "Juan entra eligiendo su nombre");

  // Día futuro bloqueado
  await tildar(pam, 2, "milo_seco_1");
  check((await toast(pam)).includes("todavía no llegó"), "no se puede tildar el día 2 durante el día 1");
  check(!(await leerTareas(rid))["2_milo_seco_1"], "…y no se guardó nada");

  // Tildes del día 1
  await tildar(pam, 1, "milo_seco_1");
  await pam.waitForSelector("#gallitoOverlay.show", { timeout: 5000 });
  check(true, "Pam tilda la 1ra toma del día y le aparece el aviso del gallito");
  await cerrarModales(pam);
  await tildar(pam, 1, "zoe_seco_1"); await esperarTarea(pam, 1, "zoe_seco_1", "Vos");
  check(!(await pam.evaluate(() => document.getElementById("gallitoOverlay").classList.contains("show"))), "el gallito no se repite en la 2da toma");
  await tildar(lau, 1, "milo_seco_2"); await esperarTarea(lau, 1, "milo_seco_2", "Vos");
  check(!(await lau.evaluate(() => document.getElementById("gallitoOverlay").classList.contains("show"))), "a Lauti no le sale el gallito (ya había tomas ese día)");
  await tildar(lau, 1, "zoe_seco_2");
  await lau.waitForSelector("#modalOverlay.show", { timeout: 5000 });
  check(true, "Lauti completa la 4ta toma y le sale la galleta de la fortuna");
  check(!(await pam.evaluate(() => document.getElementById("modalOverlay").classList.contains("show"))), "a Pam no le sale la galleta (no tildó la 4ta)");
  await cerrarModales(lau);
  await esperarTarea(pam, 1, "zoe_seco_2", "Lauti");
  check(true, "Pam ve en vivo la tarea de Lauti");

  // Carrera: Pam y Juan tildan lo mismo a la vez
  await irADia(pam, 1); await irADia(jua, 1);
  await Promise.all([ pam.click('#panel-1 .task[data-key="zoe_humedo"]'), jua.click('#panel-1 .task[data-key="zoe_humedo"]') ]);
  await pam.waitForTimeout(1500);
  const tRace = (await leerTareas(rid))["1_zoe_humedo"];
  check(!!tRace, "carrera: la tarea quedó tildada una sola vez, por " + (tRace && tRace.nombre));
  const ganador = tRace.pid === "pam" ? pam : jua, perdedor = tRace.pid === "pam" ? jua : pam;
  await esperarTarea(perdedor, 1, "zoe_humedo", tRace.nombre);
  check(true, "carrera: quien perdió ve el nombre de quien ganó");
  // Destildar lo ajeno
  await tildar(perdedor, 1, "zoe_humedo");
  check((await toast(perdedor)).includes("ya lo hizo"), "no se puede destildar lo de otro");
  check(!!(await leerTareas(rid))["1_zoe_humedo"], "…y sigue tildada");
  // Destildar lo propio
  await tildar(ganador, 1, "zoe_humedo");
  await ganador.waitForFunction(() => !document.querySelector('#panel-1 .task[data-key="zoe_humedo"]').classList.contains("checked"), null, { timeout: 5000 });
  check(!(await leerTareas(rid))["1_zoe_humedo"], "quien tildó puede destildar lo suyo");
  await tildar(jua, 1, "zoe_humedo"); await esperarTarea(jua, 1, "zoe_humedo", "Vos");
  await tildar(lau, 1, "piedras"); await esperarTarea(lau, 1, "piedras", "Vos");
  await irADia(pam, 2);
  await pam.waitForFunction(() => document.querySelector('#panel-2 .task[data-key="piedras"] .task-detail').textContent.includes("Lauti ayer"), null, { timeout: 5000 });
  check(true, "día 2 muestra 'Las limpió Lauti ayer — hoy es opcional'");

  // Mensajes del admin: a Juan (conectado) y a Sofi (todavía no entró)
  await adm.waitForSelector('.msg-dest input[data-pid="juan"]');
  await adm.check('.msg-dest input[data-pid="juan"]');
  await adm.check('.msg-dest input[data-pid="sofi"]');
  await adm.fill(".msg-txt", "Recuerden cerrar la terraza");
  await adm.click("[data-accion='mensaje']");
  await jua.waitForFunction(() => document.getElementById("avisoOverlay").classList.contains("show") && document.getElementById("avisoTexto").textContent.includes("terraza"), null, { timeout: 10000 });
  check(true, "Juan recibe el mensaje del admin al instante");
  await jua.click("#avisoClose");
  await pam.waitForTimeout(800);
  check(!(await pam.evaluate(() => document.getElementById("avisoOverlay").classList.contains("show"))), "Pam no recibe un mensaje que no era para ella");

  // Comentarios
  await pam.fill("#comentarioTexto", "Milo comió todo hoy");
  await pam.click("#comentarioBtn");
  await pam.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Milo comió todo hoy"));
  await jua.evaluate(() => loadComentarios());
  await jua.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Milo comió todo hoy"));
  check(!(await jua.textContent("#comentariosFeed")).includes("Editar"), "Juan ve el comentario de Pam pero no puede editarlo");
  await pam.click("#comentariosFeed .comentario-acciones button:has-text('Editar')");
  await pam.fill("#comentariosFeed .comentario-edit textarea", "Milo comió todo hoy (y Zoe también)");
  await pam.click("#comentariosFeed .comentario-edit button:has-text('Guardar')");
  await pam.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Zoe también") && document.getElementById("comentariosFeed").textContent.includes("editado"));
  check(true, "Pam edita su comentario");
  await jua.click('.comentario-tab[data-muro="global"]');
  await jua.fill("#comentarioTexto", "Primera vez cuidando michis");
  await jua.click("#comentarioBtn");
  await jua.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Primera vez"));
  check(true, "Juan comenta en el muro global");

  // Recordatorios de Pam
  await pam.check("#notif-manana-on");
  await pam.fill("#notif-manana-hora", "08:30");
  await pam.click("#notifBtn");
  await pam.waitForFunction(() => document.getElementById("notifStatus").textContent.includes("Activados"), null, { timeout: 5000 });
  const notifPam = (await leerParticipantes(rid)).pam.notif;
  check(notifPam && notifPam.manana.on && notifPam.manana.hora === "08:30", "los horarios de Pam quedan guardados en su cuenta");
  await pam.click("#notifProbarBtn");
  await pam.waitForFunction(() => document.getElementById("notifStatus").textContent.includes("enviado"), null, { timeout: 5000 });
  check(true, "'Probar aviso' funciona");
  check(!(await leerParticipantes(rid)).lauti.notif, "Lauti no tiene recordatorios (son opcionales)");

  // Mismo Google en otro dispositivo entra directo
  const pam2 = await pagina({ sub:"uPam", email:"pame@x.com", email_verified:true, name:"Pamela Gómez" });  // mismo Google
  await pam2.goto(urlDe()); await pam2.waitForSelector("#gateLoginBtn", { state:"visible" }); await login(pam2);
  await pam2.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  check((await pam2.textContent("#appSession")).includes("Pam"), "Pam en un 2do dispositivo entra directo, sin volver a escribir el nombre");
  check((await pam2.inputValue("#notif-manana-hora")) === "08:30", "…y ve sus mismos horarios de recordatorio");
  await pam2.context().close();

  // Navegador interno de Instagram
  const insta = await pagina(null, { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0" });
  await insta.goto(urlDe()); await insta.waitForSelector("#gateLoginBtn", { state:"visible" });
  check((await insta.textContent("#gateError")).includes("Google no deja"), "abierto desde Instagram: explica que hay que abrirlo en Chrome/Safari");
  await insta.click("#gateLoginBtn");
  await insta.waitForTimeout(500);
  check(insta.dialogos.some(m => m.includes("Abrí el link en Chrome o Safari")), "…y el botón de Google da el mismo aviso");
  await insta.context().close();

  // Home con sesión: "Tu recorrido" arriba y la lista de activos sin repetirlo
  const homeSin = await pagina(null);
  await homeSin.goto(BASE + "/index.html");
  await homeSin.waitForSelector("#recorridosActivos .recorrido-btn", { timeout: 10000 });
  const ordenHome = await homeSin.evaluate(() => { const t = [...document.querySelectorAll(".landing-inner > *")]; return t.indexOf(document.getElementById("activosWrap")) < t.indexOf(document.querySelector(".cats-intro")); });
  check(ordenHome, "home sin sesión: 'Recorridos activos' aparece arriba, antes de la foto");
  check(await homeSin.evaluate(() => { const h = document.querySelector(".landing-marca"); return h.querySelector(".landing-icono") && Math.round(h.getBoundingClientRect().height) <= 50; }), "home: ícono nuevo a la izquierda del título, en una sola línea");
  await homeSin.waitForSelector(".podio-mini-spot", { timeout: 10000 });
  const altoPodio = await homeSin.evaluate(() => Math.round(document.querySelector(".podio-card").getBoundingClientRect().height));
  check(altoPodio <= 150, "home: el podio ocupa poco alto (" + altoPodio + "px)");
  await homeSin.screenshot({ path: SHOTS + "/06-home-sin-sesion.png" });
  await homeSin.context().close();
  const homePam = await pagina({ sub:"uPam", email:"pame@x.com", email_verified:true, name:"Pamela Gómez" });
  await homePam.goto(BASE + "/index.html");
  await homePam.waitForSelector("#recorridosActivos .recorrido-btn", { timeout: 10000 });
  await login(homePam);
  await homePam.waitForSelector("#tuRecorrido .tu-recorrido", { timeout: 10000 });
  const tarjeta = await homePam.textContent("#tuRecorrido .tu-recorrido");
  check(tarjeta.includes("Prueba Octubre") && tarjeta.includes("Pam") && tarjeta.includes("Día 1 de 3") && tarjeta.includes("Ir →"), "home con sesión: tarjeta 'Tu recorrido · Pam — Prueba Octubre — Día 1 de 3 — Ir →'");
  check(await homePam.isHidden("#activosWrap"), "home con sesión: la lista de activos no repite su recorrido (y se oculta si queda vacía)");
  await homePam.screenshot({ path: SHOTS + "/07-home-tu-recorrido.png" });
  await homePam.click("#tuRecorrido .tu-recorrido");
  await homePam.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  check((await homePam.textContent("#appSession")).includes("Pam"), "'Ir →' lleva directo a su recorrido, ya adentro");
  await homePam.context().close();

  // Posiciones en vivo
  await pam.waitForFunction(() => document.getElementById("standings").textContent.includes("Juan"), null, { timeout: 5000 });
  let tareas = await leerTareas(rid);
  const txtPos = await pam.textContent("#standings");
  for(const [pid, nom] of [["pam","Pam"],["lauti","Lauti"],["juan","Juan"]]){
    check(txtPos.includes(`${puntosOraculo(tareas, pid)} pts`), `posiciones: ${nom} tiene ${puntosOraculo(tareas, pid)} pts`);
  }
  await pam.waitForFunction(() => document.querySelectorAll("#otrosMarcadores .otro-marcador").length === 2, null, { timeout: 5000 });
  const marcadores = await pam.$$eval("#otrosMarcadores .otro-marcador", els => els.map(e => ({ t: e.textContent.trim(), img: !!e.querySelector("img"), w: e.getBoundingClientRect().width })));
  check(marcadores.every(m => m.w >= 29), "marcadores de los demás de 30px (" + marcadores.map(m => m.w).join(", ") + ")");
  check(marcadores.some(m => m.img) && marcadores.some(m => m.t === "J"), "Lauti aparece con su foto y Juan con 'J'");
  const abrevs = await pam.evaluate(() => {
    const guardado = participantes;
    participantes = { a:{nombre:"Pam"}, b:{nombre:"Pedro"}, c:{nombre:"Juan"}, d:{nombre:"Juana"}, e:{nombre:"Sofi"} };
    const r = abreviaturas(); participantes = guardado; return r;
  });
  check(abrevs.a === "Pa" && abrevs.b === "Pe" && abrevs.c === "Jn" && abrevs.d === "Ja" && abrevs.e === "S", "iniciales sin repetir: Pam=Pa, Pedro=Pe, Juan=Jn, Juana=Ja, Sofi=S");
  const orden = await pam.evaluate(() => {
    const pos = id => [...document.querySelectorAll("#appWrap *")].indexOf(document.getElementById(id));
    return pos("dayTabs") < pos("guia") && pos("guia") < pos("avisos") && pos("avisos") < pos("muro");
  });
  check(orden, "orden de la página: tareas → guía → recordatorios → muro");
  check(!(await pam.evaluate(() => [...document.querySelectorAll("#guia details")].some(d => d.open))), "la guía arranca plegada");
  await pam.click('.app-nav a[href="#muro"]'); await pam.waitForTimeout(1200);
  check(await pam.evaluate(() => { const r = document.getElementById("muro").getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight - 100; }), "el acceso rápido '💬 Muro' lleva al muro");
  await pam.click('.app-nav a[href="#tareas"]').catch(() => {}); await pam.evaluate(() => window.scrollTo(0, 0));
  await cerrarModales(pam);
  await pam.evaluate(() => window.scrollTo(0, 0));
  await pam.screenshot({ path: SHOTS + "/02-dia1-pam.png", fullPage: true });
  await pam.screenshot({ path: SHOTS + "/02b-dia1-pam-arriba.png" });

  // Admin libera a Juan (se equivocó de cuenta) y Juan vuelve a entrar
  const filaJuan = adm.locator(".persona-row", { hasText: "Juan" });
  await filaJuan.locator('[data-p="liberar"]').click();
  await adm.waitForFunction(() => [...document.querySelectorAll(".persona-row")].find(r => r.textContent.includes("Juan")).textContent.includes("sin vincular"), null, { timeout: 5000 });
  await jua.reload();
  await elegir(jua, "Juan");
  await esperarTarea(jua, 1, "zoe_humedo", "Vos");
  check(true, "admin libera a Juan, Juan se vuelve a vincular y conserva sus tareas");

  // ================= DÍA 2: solo va Sofi =================
  console.log("\n== Día 2: va solo Sofi ==");
  await moverFecha(rid, -1);
  const sof = await pagina({ sub:"uSof", email:"sofi@x.com", email_verified:true, name:"Sofía Ruiz" });
  await sof.goto(urlDe()); await sof.waitForSelector("#gateLoginBtn", { state:"visible" }); await login(sof);
  await elegir(sof, "Sofi");
  check(sof.dialogos.some(m => m.includes("¿Sos Sofi?")), "Sofía elige 'Sofi'");
  check((await sof.getAttribute(".day-tab.active", "data-day")) === "2", "Sofi abre directo en el día de hoy (día 2)");
  await sof.waitForSelector("#avisoOverlay.show");
  check((await sof.textContent("#avisoTexto")).includes("Gracias por venir"), "Sofi ve primero la bienvenida…");
  await sof.click("#avisoClose");
  await sof.waitForFunction(() => document.getElementById("avisoOverlay").classList.contains("show") && document.getElementById("avisoTexto").textContent.includes("terraza"), null, { timeout: 5000 });
  check(true, "…y después el mensaje que le mandó el admin antes de que entrara");
  await sof.click("#avisoClose");
  for(const k of ["milo_seco_1","milo_seco_2","zoe_seco_1","zoe_seco_2"]){ await tildar(sof, 2, k); await esperarTarea(sof, 2, k, "Vos"); await guardado(sof); await cerrarModales(sof); }
  await tildar(sof, 3, "milo_seco_1");
  check((await toast(sof)).includes("todavía no llegó"), "Sofi no puede adelantar el día 3");
  // Lauti tilda algo de ayer (se había olvidado)
  await lau.reload(); await lau.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  await tildar(lau, 1, "milo_humedo"); await esperarTarea(lau, 1, "milo_humedo", "Vos");
  check(true, "Lauti puede tildar algo del día anterior que se olvidó");
  // Sofi cierra sus días
  await sof.waitForSelector("#terminarCard", { state:"visible" });
  await sof.click("#terminarBtn");
  await sof.waitForSelector("#victoryOverlay.show", { timeout: 5000 });
  tareas = await leerTareas(rid);
  const pctSofi = oraculo(tareas, "sofi", 3, 2);
  check((await sof.textContent("#cierrePct")) === pctSofi + "%", `Sofi cierra sus días: ${pctSofi}% (esperado ${pctSofi}%) — "${await sof.textContent("#victoryTitulo")}"`);
  await sof.click("#victoryClose");
  await sof.evaluate(() => window.scrollTo(0, 0));
  await sof.screenshot({ path: SHOTS + "/03-dia2-sofi-cerro.png" });

  // ================= DÍA 4: terminó (día de gracia) =================
  console.log("\n== Día 4: el recorrido terminó ayer (nadie fue el día 3) ==");
  await moverFecha(rid, -3);
  tareas = await leerTareas(rid);
  for(const [p, pid, nom] of [[pam,"pam","Pam"],[lau,"lauti","Lauti"],[jua,"juan","Juan"]]){
    await p.reload(); await p.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
    await p.waitForSelector("#victoryOverlay.show", { timeout: 10000 });
    const esperado = oraculo(tareas, pid, 3, 3);
    const titulo = await p.textContent("#victoryTitulo");
    check((await p.textContent("#cierrePct")) === esperado + "%", `${nom}: cierre automático ${esperado}% — "${titulo}"`);
    await p.click("#victoryClose");
  }
  await sof.reload(); await sof.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  await sof.waitForTimeout(1500);
  check(!(await sof.evaluate(() => document.getElementById("victoryOverlay").classList.contains("show"))), "a Sofi no le repite el cierre (ya lo vio)");
  check((await sof.textContent("#cierrePct")) === pctSofi + "%", "el % de Sofi quedó congelado aunque nadie fue el día 3");
  check((await pam.textContent("#standings")).includes("🏁"), "en las posiciones Sofi figura con 🏁");
  const grupo = await pam.textContent("#cierreGrupo");
  check(grupo.includes("2 de 3"), "resumen del grupo: todas las tomas completas en 2 de 3 días (" + grupo.trim().slice(0, 70) + "…)");
  // Día de gracia: se puede tildar; al día siguiente no
  await tildar(lau, 3, "zoe_seco_1"); await esperarTarea(lau, 3, "zoe_seco_1", "Vos"); await guardado(lau);
  check(!(await lau.evaluate(() => document.getElementById("gallitoOverlay").classList.contains("show"))), "tildar un día pasado no muestra el aviso del gallito");
  await tildar(lau, 3, "zoe_seco_1");
  await lau.waitForFunction(() => !document.querySelector('#panel-3 .task[data-key="zoe_seco_1"]').classList.contains("checked"), null, { timeout: 5000 });
  check(true, "día de gracia (el día después del final): todavía se puede tildar/destildar");
  await pam.evaluate(() => window.scrollTo(0, 0));
  await pam.screenshot({ path: SHOTS + "/04-cierre-pam.png" });

  console.log("\n== Día 5: cerrado ==");
  await moverFecha(rid, -4);
  await lau.reload(); await lau.waitForSelector("#appWrap", { state:"visible", timeout: 10000 }); await cerrarModales(lau);
  await tildar(lau, 3, "zoe_seco_1");
  check((await toast(lau)).includes("ya terminó"), "después del día de gracia no se puede tildar");

  // Participantes en un recorrido cerrado: solo mirar
  check(await lau.isHidden("#muro .comentario-form") && await lau.isVisible("#muroCerradoNota"), "recorrido cerrado: el muro queda de solo lectura");
  check(await lau.isHidden("#avisos"), "recorrido cerrado: no se muestran los recordatorios");
  await pam.reload(); await pam.waitForSelector("#appWrap", { state:"visible", timeout: 10000 }); await cerrarModales(pam);
  await pam.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Milo comió"), null, { timeout: 10000 });
  check(!(await pam.textContent("#comentariosFeed")).includes("Editar"), "recorrido cerrado: Pam ya no puede editar su comentario");
  await moverFecha(rid, -5);   // día 6: las reglas ya cerraron seguro (cierran a las 03:00 del día siguiente al de gracia)
  const hackCerrado = await lau.evaluate(() => db.collection("recorridos").doc(recorridoId).collection("tareas").doc("3_milo_seco_2")
    .set({ dia:3, key:"milo_seco_2", pid:"lauti", nombre:"Lauti", uid:auth.currentUser.uid, creado:1 }).then(() => "ok", e => e.code));
  check(hackCerrado === "permission-denied", "recorrido cerrado: tildar por consola lo bloquean las reglas");

  // Modo admin
  console.log("\n== Modo admin en el recorrido cerrado ==");
  await adm.goto(urlDe());
  await adm.waitForSelector("#gatePersonas .gate-admin", { timeout: 10000 });
  check(true, "el admin ve 'Entrar como admin' en la lista");
  await adm.click("#gatePersonas .gate-admin");
  await adm.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  check(await adm.isVisible("#modoAdminNota") && await adm.isHidden("#avatarMarker"), "modo admin: nota visible y sin muñequito propio");
  await irADia(adm, 3); await adm.click('#panel-3 .task[data-key="milo_seco_1"]');
  await adm.waitForSelector("#elegirOverlay.show"); await adm.waitForTimeout(600);
  await adm.screenshot({ path: SHOTS + "/16-admin-elegir.png" });
  await adm.locator("#elegirLista .gate-persona", { hasText: "Juan" }).click();
  await esperarTarea(adm, 3, "milo_seco_1", "Juan"); await guardado(adm);
  check((await leerTareas(rid))["3_milo_seco_1"].pid === "juan", "admin tilda una tarea del día 3 a nombre de Juan (recorrido cerrado)");
  await irADia(adm, 1); await adm.click('#panel-1 .task[data-key="milo_seco_1"]');
  await adm.locator("#elegirLista .gate-persona", { hasText: "Lauti" }).click();
  await esperarTarea(adm, 1, "milo_seco_1", "Lauti"); await guardado(adm);
  check((await leerTareas(rid))["1_milo_seco_1"].pid === "lauti", "admin cambia quién hizo una tarea (de Pam a Lauti)");
  await esperarTarea(pam, 1, "milo_seco_1", "Lauti");
  check(true, "Pam ve el cambio en vivo");
  await adm.click('#panel-1 .task[data-key="milo_seco_1"]');
  await adm.locator("#elegirLista .gate-persona", { hasText: "Nadie" }).click();
  await adm.waitForFunction(() => !document.querySelector('#panel-1 .task[data-key="milo_seco_1"]').classList.contains("checked"), null, { timeout: 5000 }); await guardado(adm);
  check(!(await leerTareas(rid))["1_milo_seco_1"], "admin destilda una tarea");
  await adm.click('#panel-1 .task[data-key="milo_seco_1"]');
  await adm.click("#elegirCancelar");
  check(!(await leerTareas(rid))["1_milo_seco_1"], "Cancelar no cambia nada");
  await adm.locator('.app-nav a[href="#muro"]').click();
  await adm.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("Milo comió"), null, { timeout: 10000 });
  check(await adm.isVisible("#muro .comentario-form"), "modo admin: puede comentar en el recorrido cerrado");
  await adm.click("#comentariosFeed .comentario-acciones button:has-text('Editar')");
  await adm.fill("#comentariosFeed .comentario-edit textarea", "Milo comió todo hoy (editado por admin)");
  await adm.click("#comentariosFeed .comentario-edit button:has-text('Guardar')");
  await adm.waitForFunction(() => document.getElementById("comentariosFeed").textContent.includes("editado por admin"), null, { timeout: 5000 });
  check(true, "modo admin: edita el comentario de Pam");
  // Renombrar desde el panel
  await adm.goto(BASE + "/admin.html"); await adm.waitForSelector(".persona-row", { timeout: 10000 });
  adm.respuestaPrompt = "Sofía";
  await adm.locator(".persona-row", { hasText: "Sofi" }).locator('[data-p="nombre"]').click();
  await adm.waitForFunction(() => document.querySelector(".personas-list").textContent.includes("Sofía"), null, { timeout: 5000 });
  await pam.waitForFunction(() => document.getElementById("standings").textContent.includes("Sofía"), null, { timeout: 10000 });
  check(true, "admin renombra a Sofi como Sofía y todos lo ven");

  // Home y ranking
  console.log("\n== Home y ranking ==");
  const home = await pagina(null, { ancho: 360 });
  await home.goto(BASE + "/index.html");
  await home.waitForSelector("#recorridosPasados .recorrido-btn", { timeout: 10000 });
  check((await home.textContent("#recorridosPasados")).includes("Prueba Octubre"), "home: el recorrido figura en 'pasados'");
  check(await home.isHidden("#activosWrap"), "home: sin recorridos activos, la sección no aparece");
  await home.waitForFunction(() => document.getElementById("comentariosFeedLanding").textContent.includes("Primera vez"), null, { timeout: 10000 });
  check(true, "home: el muro global muestra el comentario de Juan");
  check(!(await home.textContent("#comentariosFeedLanding")).includes("Milo comió todo"), "home: el comentario del recorrido no aparece en el muro global");
  await sinDesborde(home, "home");
  await home.screenshot({ path: SHOTS + "/05-home.png", fullPage: true });
  const lb = await pagina(null, { ancho: 360 });
  await lb.goto(BASE + "/leaderboard.html"); await lb.waitForSelector(".fila");
  tareas = await leerTareas(rid);
  const txtLb = await lb.textContent("#lista");
  for(const pid of ["pam","lauti","juan","sofi"]){  // puntos después de los cambios del admin
    const pp = puntosOraculo(tareas, pid);
    check(pp === 0 || txtLb.includes(pp + " pts"), `ranking: ${pid} con ${pp} pts`);
  }
  await sinDesborde(lb, "ranking");
  await pam.setViewportSize({ width: 360, height: 800 }); await sinDesborde(pam, "recorrido");
  await adm.setViewportSize({ width: 360, height: 800 }); await sinDesborde(adm, "admin");
  const filaSofi = await adm.locator(".persona-row", { hasText: "Sofía" }).textContent();
  check(filaSofi.includes(`🏁 ${pctSofi}%`), "admin ve el % congelado de Sofi con 🏁");

  // ================= MODO OSCURO =================
  console.log("\n== Modo oscuro ==");
  const homeOsc = await pagina(null, { esquema: "dark" });
  await homeOsc.goto(BASE + "/index.html");
  await homeOsc.waitForSelector("#recorridosPasados .recorrido-btn", { timeout: 10000 });
  check(await homeOsc.evaluate(() => document.documentElement.classList.contains("dark")), "con el celular en modo oscuro, la app arranca oscura (Auto)");
  check((await homeOsc.textContent(".landing-topbar [data-tema]")).includes("Auto"), "el botón dice '🌓 Auto'");
  await homeOsc.screenshot({ path: SHOTS + "/10-oscuro-home.png", fullPage: true });
  await homeOsc.click(".landing-topbar [data-tema]");
  check((await homeOsc.textContent(".landing-topbar [data-tema]")).includes("Oscuro"), "1er toque: 🌙 Oscuro");
  await homeOsc.click(".landing-topbar [data-tema]");
  check(!(await homeOsc.evaluate(() => document.documentElement.classList.contains("dark"))), "2do toque: ☀️ Claro, aunque el celular esté oscuro");
  await homeOsc.reload(); await homeOsc.waitForSelector(".landing-topbar [data-tema]");
  check((await homeOsc.textContent(".landing-topbar [data-tema]")).includes("Claro") && !(await homeOsc.evaluate(() => document.documentElement.classList.contains("dark"))), "la elección queda guardada al recargar");
  await homeOsc.click(".landing-topbar [data-tema]");
  check((await homeOsc.textContent(".landing-topbar [data-tema]")).includes("Auto") && await homeOsc.evaluate(() => document.documentElement.classList.contains("dark")), "3er toque: vuelve a 🌓 Auto");
  const pamOsc = await pagina({ sub:"uPam", email:"pame@x.com", email_verified:true, name:"Pamela Gómez" }, { esquema: "dark" });
  await pamOsc.goto(urlDe()); await pamOsc.waitForSelector("#gateLoginBtn", { state:"visible" });
  await pamOsc.screenshot({ path: SHOTS + "/11-oscuro-entrada.png" });
  await login(pamOsc); await pamOsc.waitForSelector("#appWrap", { state:"visible", timeout: 10000 });
  await pamOsc.waitForTimeout(800); await cerrarModales(pamOsc);
  await pamOsc.evaluate(() => { document.querySelectorAll("#guia details")[0].open = true; window.scrollTo(0, 0); });
  await pamOsc.screenshot({ path: SHOTS + "/12-oscuro-recorrido.png", fullPage: true });
  await pamOsc.evaluate(() => showVictory(mensajeCierre(86)));
  await pamOsc.waitForTimeout(900);
  await pamOsc.screenshot({ path: SHOTS + "/13-oscuro-cierre.png" });
  const lbOsc = await pagina(null, { esquema: "dark" });
  await lbOsc.goto(BASE + "/leaderboard.html"); await lbOsc.waitForSelector(".fila");
  await lbOsc.screenshot({ path: SHOTS + "/14-oscuro-ranking.png", fullPage: true });
  const admOsc = await pagina({ sub:"admin", email:"bm.blancom@gmail.com", email_verified:true, name:"Admin" }, { esquema: "dark" });
  await admOsc.goto(BASE + "/admin.html"); await admOsc.waitForSelector("#loginBtn"); await login(admOsc);
  await admOsc.waitForSelector(".persona-row", { timeout: 10000 });
  const nombresCortados = await admOsc.$$eval(".persona-row .info", els => els.filter(e => e.getBoundingClientRect().width < 120).length);
  check(nombresCortados === 0, "admin: los nombres de las personas no se parten letra por letra");
  await admOsc.screenshot({ path: SHOTS + "/15-oscuro-admin.png", fullPage: true });
  check(true, "capturas en modo oscuro de home, entrada, recorrido, cierre, ranking y admin");

  check(errores.length === 0, "sin errores de JavaScript en ninguna página" + (errores.length ? ":\n   " + errores.join("\n   ") : ""));
  console.log(`\n${oks} OK, ${fallas} FALLAS`);
  await browser.close(); server.close(); await env.cleanup();
  process.exit(fallas ? 1 : 0);
})().catch(async e => { try{ for(const p of browser.contexts().flatMap(c => c.pages())) await p.screenshot({ path: SHOTS + "/error-" + (p.nombre||"x") + ".png" }); }catch(_){} console.error("ERROR:", e.message.split("\n").slice(0,6).join("\n")); try{ await browser.close(); }catch(_){} process.exit(1); });
