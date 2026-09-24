// Código compartido por index.html, admin.html y leaderboard.html

const firebaseConfig = {
  apiKey: "AIzaSyAi-tOBkoxFtBuw_Bgk6WCfX8wrQYxbrG4",
  authDomain: "michis-en-casa.firebaseapp.com",
  projectId: "michis-en-casa",
  storageBucket: "michis-en-casa.firebasestorage.app",
  messagingSenderId: "644207160311",
  appId: "1:644207160311:web:f63cdcf0a1025170891cf2"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// ===== Tema claro / oscuro: automático según el celular, o elegido con el botón (se guarda en este dispositivo) =====
const TEMAS = ["auto", "oscuro", "claro"];
const ETIQUETA_TEMA = { auto:"🌓 Auto", oscuro:"🌙 Oscuro", claro:"☀️ Claro" };
const mqOscuro = window.matchMedia("(prefers-color-scheme: dark)");
function temaElegido(){
  try{ return localStorage.getItem("lesgates_tema") || "auto"; }catch(e){ return "auto"; }
}
function aplicarTema(){
  const t = temaElegido();
  const oscuro = t === "oscuro" || (t === "auto" && mqOscuro.matches);
  document.documentElement.classList.toggle("dark", oscuro);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = oscuro ? "#1B1814" : "#F2EEE1";
  document.querySelectorAll("[data-tema]").forEach(b => { b.textContent = ETIQUETA_TEMA[t]; b.title = "Tema: automático, oscuro o claro"; });
}
function botonTema(){ return `<button class="tema-btn" data-tema>${ETIQUETA_TEMA[temaElegido()]}</button>`; }
aplicarTema();
if(mqOscuro.addEventListener) mqOscuro.addEventListener("change", aplicarTema);
document.addEventListener("click", e => {
  if(!e.target.closest("[data-tema]")) return;
  const siguiente = TEMAS[(TEMAS.indexOf(temaElegido()) + 1) % TEMAS.length];
  try{ localStorage.setItem("lesgates_tema", siguiente); }catch(err){}
  aplicarTema();
});
document.addEventListener("DOMContentLoaded", aplicarTema);

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Tiene que coincidir con la lista de firestore.rules
const ADMIN_EMAILS = ["bm.blancom@gmail.com", "barbarabmontero@gmail.com"];

// Quien entró con su código personal tiene una sesión anónima (sin mail)
function esAnonimo(user){ return !!(user && user.isAnonymous); }

function esAdmin(user){
  return !!(user && user.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));
}

// Navegadores internos de apps (Instagram, Facebook, TikTok…): Google bloquea el login ahí
function navegadorEmbebido(){
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(navigator.userAgent);
}
const AVISO_EMBEBIDO = "Google no deja iniciar sesión desde el navegador de esta app. Abrí el link en Chrome o Safari: tocá los tres puntos (⋮ o …) y elegí \"Abrir en el navegador\". El link ya quedó copiado.";

async function loginGoogle(){
  if(navegadorEmbebido()){
    // Copiar sin esperar: en algunos navegadores internos el portapapeles nunca responde
    try{ navigator.clipboard.writeText(location.href).catch(() => {}); }catch(e){}
    alert(AVISO_EMBEBIDO);
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try{
    await auth.signInWithPopup(provider);
  }catch(e){
    // Navegadores dentro de apps (Instagram, WhatsApp) bloquean popups
    if(e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment"){
      await auth.signInWithRedirect(provider);
    } else if(e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request"){
      console.error(e);
      alert(mensajeErrorLogin(e));
    }
  }
}

// Los errores de configuración de Firebase dicen exactamente qué falta activar
function mensajeErrorLogin(e){
  const dominio = location.hostname;
  if(e.code === "auth/unauthorized-domain")
    return `Falta autorizar este sitio en Firebase: Authentication → Settings → Authorized domains → agregar "${dominio}".`;
  if(e.code === "auth/operation-not-allowed" || e.code === "auth/configuration-not-found")
    return "El acceso con Google no está activado en Firebase: Authentication → Sign-in method → Google → Habilitar (elegí el correo de asistencia y Guardar).";
  if(e.code === "auth/network-request-failed")
    return "No hay conexión. Probá de nuevo en un rato.";
  return `No se pudo entrar con Google (${e.code || e.message}). Probá de nuevo.`;
}

function escapeHtml(str){
  return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// ===== Apodos: "pam", "pame" y "pamela" son la misma persona; "lauti" y "lautaro" también =====
function normalizarNombre(nombre){
  return String(nombre || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function nombresCoinciden(a, b){
  const na = normalizarNombre(a), nb = normalizarNombre(b);
  if(!na || !nb) return false;
  if(Math.min(na.length, nb.length) < 3) return na === nb;
  if(na.startsWith(nb) || nb.startsWith(na)) return true;
  // Apodos que no son el comienzo del nombre completo (lauti/lautaro): comparten 4 letras iniciales
  return na.length >= 4 && nb.length >= 4 && na.slice(0,4) === nb.slice(0,4);
}
function slugify(nombre){
  return String(nombre || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cuidador";
}

// ===== Tareas =====
// Tomas de seco: obligatorias todos los días. Suplementos: suman si se hacen, no restan. Piedras: día por medio.
const TAREAS_OBLIGATORIAS = ["milo_seco_1", "milo_seco_2", "zoe_seco_1", "zoe_seco_2"];

function tareasDelDia(){
  return [
    { key:"milo_seco_1", group:"Milo", title:"Alimento seco (1ra toma)", detail:"Hypoallergenic (o Anallergenic si lo rechaza)" },
    { key:"milo_seco_2", group:"Milo", title:"Alimento seco (2da toma)", detail:"Hypoallergenic (o Anallergenic si lo rechaza)" },
    { key:"milo_humedo", group:"Milo", title:"Alimento húmedo + suplementos", detail:"Un poco de Royal Canin + 2 pastillas trituradas", etiqueta:"opcional · suma" },
    { key:"zoe_seco_1", group:"Zoe", title:"Alimento seco (1ra toma)", detail:"Hypoallergenic" },
    { key:"zoe_seco_2", group:"Zoe", title:"Alimento seco (2da toma)", detail:"Hypoallergenic" },
    { key:"zoe_humedo", group:"Zoe", title:"Alimento húmedo + suplementos", detail:"Sieger + 2 pastillas trituradas + 10 gotas Proteliv + 1ml Felifat", etiqueta:"opcional · suma" },
    { key:"piedras", group:"General", title:"Limpiar piedras", detail:"Al menos día por medio, en cocina o baño", etiqueta:"día por medio" },
  ];
}

// Puntos por tarea: las que más cuestan valen más
const PUNTOS = { seco:10, humedo:15, piedras:20 };
function puntosDeTarea(key){
  if(key === "piedras") return PUNTOS.piedras;
  if(String(key).includes("humedo")) return PUNTOS.humedo;
  return PUNTOS.seco;
}
function puntosPosiblesPorDia(){
  return tareasDelDia().reduce((suma, t) => suma + puntosDeTarea(t.key), 0);
}

// Fecha de hoy "AAAA-MM-DD" en hora local (toISOString usa UTC y en Argentina cambia de día a las 21 hs)
function hoyISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Día de hoy dentro del recorrido (1 = primer día). Sin fecha de inicio, 0 (nunca termina).
function diaDelRecorrido(recorrido){
  if(!recorrido.fechaInicio) return 0;
  const inicio = new Date(recorrido.fechaInicio + "T00:00:00");
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return Math.round((hoy - inicio) / 86400000) + 1;
}

// % de victoria de una persona: hechas ÷ (hechas + pendientes), solo sobre sus días.
// - Sus días: los días en que tildó algo, los días en que se anotó en turnos, y los días en que
//   nadie tildó nada ni nadie estaba anotado (si nadie fue, les resta a todos; si cuidó solo,
//   todos los días son suyos). Un día vacío con alguien anotado le resta solo a quien se anotó.
// - Hechas: todo lo que tildó (tomas, suplementos y piedras)
// - Pendientes: tomas de seco que nadie hizo en sus días, y piedras si nadie las limpió
//   ni ese día ni el anterior (mínimo día por medio)
// Lo que hizo otra persona no le resta (si alguien te cubrió, ese día no te resta). Los
// suplementos no hechos no restan.
// El día en curso todavía no cuenta como pendiente, salvo que la persona haya tocado
// "Terminé mis días" (hastaDia = hoy): ahí su % se calcula hasta hoy y queda congelado.
// turnos: { "2026-10-10": { pid, ... } } de la página de turnos (opcional)
function calcularVictoria(tareas, pid, recorrido, hastaDia, turnos){
  const totalDias = recorrido.dias || 3;
  const hoy = diaDelRecorrido(recorrido);
  const terminado = !!recorrido.fechaInicio && hoy > totalDias;
  const hasta = hastaDia !== undefined ? Math.min(hastaDia, totalDias) : (terminado ? totalDias : hoy - 1);
  const dias = new Set();
  const diasConAlgo = new Set();
  let hechas = 0;
  for(const id in tareas){
    const d = Number(tareas[id].dia);
    diasConAlgo.add(d);
    if(tareas[id].pid !== pid) continue;
    dias.add(d);
    hechas++;
  }
  const anotado = {};   // día del recorrido -> pid anotado en turnos
  fechasDelRecorrido(recorrido).forEach((f, i) => { if(turnos && turnos[f]) anotado[i + 1] = turnos[f].pid; });
  for(const d in anotado) if(anotado[d] === pid) dias.add(Number(d));
  if(dias.size === 0) return null;
  for(let d = 1; d <= hasta; d++) if(!diasConAlgo.has(d) && !anotado[d]) dias.add(d);
  let pendientes = 0;
  dias.forEach(d => {
    if(d > hasta) return;
    TAREAS_OBLIGATORIAS.forEach(k => { if(!tareas[d + "_" + k]) pendientes++; });
    if(d >= 2 && !tareas[d + "_piedras"] && !tareas[(d-1) + "_piedras"]) pendientes++;
  });
  if(hechas + pendientes === 0) return null;   // todavía no llegó ninguno de sus días
  return Math.round(hechas / (hechas + pendientes) * 100);
}

// Progreso viejo (antes del checklist compartido) que todavía no se migró
function tareasLegacy(p){
  if(p.migrado || !p.state) return 0;
  let total = 0;
  Object.keys(p.state).forEach(d => {
    Object.keys(p.state[d] || {}).forEach(k => { if(p.state[d][k]) total += puntosDeTarea(k); });
  });
  return total;
}

// Los participantes viejos guardaban el avatar del "héroe" del recorrido: solo vale si es esa persona
function avatarDe(p){
  if(p.avatar) return p.avatar;
  if(p.heroeAvatar && nombresCoinciden(p.nombre, p.heroeNombre)) return p.heroeAvatar;
  return "";
}

// ===== Avatar: cuerpo pixelado genérico (mismo para todos, en distintos colores) + la cabeza de cada uno =====
// La cabeza es la foto recortada y pixelada que carga el admin; sin foto, una burbuja con la inicial.
const COMBOS_AVATAR = [
  { camisa:"#3E6C64", pantalon:"#C79A2E" },   // verde / mostaza (el del camino)
  { camisa:"#DD8A3D", pantalon:"#355F58" },   // naranja / verde oscuro
  { camisa:"#A65136", pantalon:"#E3B04B" },   // terracota / amarillo
  { camisa:"#3E9C8E", pantalon:"#A65136" },   // verde agua / terracota
  { camisa:"#C79A2E", pantalon:"#6B4E3D" },   // mostaza / marrón
  { camisa:"#7B6A9E", pantalon:"#C79A2E" },   // violeta / mostaza
  { camisa:"#C96F7E", pantalon:"#355F58" },   // rosa / verde oscuro
  { camisa:"#5B82A6", pantalon:"#DD8A3D" }    // azul / naranja
];
function comboAvatar(clave){
  const txt = normalizarNombre(clave) || "x";
  let h = 0;
  for(const ch of txt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COMBOS_AVATAR[h % COMBOS_AVATAR.length];
}
// Filas del cuerpo, 8 columnas de 2.6 de ancho: C = camisa, P = pantalón, Z = zapatos
// La muesca a los dos lados del torso (filas 2 y 3) separa los brazos
const CUERPO_AVATAR = ["CCCCCCCC", ".CCCCCC.", ".CCCCCC.", "CCPPPPCC", "PPPPPPPP", "PP....PP", "ZZ....ZZ"];
function cuerpoAvatarSVG(combo){
  const color = { C: combo.camisa, P: combo.pantalon, Z: "#4A3728" };
  let r = "";
  CUERPO_AVATAR.forEach((fila, y) => [...fila].forEach((ch, x) => {
    if(ch !== ".") r += `<rect x="${(-10.4 + x * 2.6).toFixed(2)}" y="${(-3.4 + y * 2.6).toFixed(2)}" width="2.62" height="2.62" fill="${color[ch]}"/>`;
  }));
  return r;
}
// p: datos del participante (nombre, avatar); texto: lo que va en la burbuja si no hay foto (por defecto la inicial)
function avatarSVG(p, texto){
  p = p || {};
  const combo = comboAvatar(p.nombre);
  const foto = avatarDe(p);
  const letra = escapeHtml(texto || (p.nombre || "?").trim().charAt(0).toUpperCase());
  const cabeza = foto
    ? `<image href="${foto}" x="-10" y="-21.2" width="20" height="20" preserveAspectRatio="xMidYMax meet" style="image-rendering:pixelated"/>`
    : `<circle cx="0" cy="-10.6" r="8.4" fill="${combo.camisa}" stroke="#fff" stroke-width="1"/><text x="0" y="-7.2" text-anchor="middle" font-size="${letra.length > 1 ? 8.5 : 10}" font-weight="700" fill="#fff" font-family="Karla, sans-serif">${letra}</text>`;
  return `<svg class="av" viewBox="-11 -21.5 22 36.5" shape-rendering="crispEdges" aria-label="${escapeHtml(p.nombre || "")}">${cuerpoAvatarSVG(combo)}${cabeza}</svg>`;
}

// ===== Entrar a un recorrido (lo usan el recorrido y la página de turnos) =====
// Con Google: se vincula la cuenta a un nombre libre de la lista.
async function vincularConGoogle(recorridoId, pid){
  await db.collection("recorridos").doc(recorridoId).collection("participantes").doc(pid)
    .update({ uid: auth.currentUser.uid, reclamado: Date.now() });
}
// Con código: sesión anónima + en el mismo lote el intento (ingresos/{uid}) y el vínculo; las reglas
// solo lo aceptan si el código coincide con el del participante.
async function vincularConCodigo(recorridoId, pid, codigo){
  if(!auth.currentUser) await auth.signInAnonymously();
  const ref = db.collection("recorridos").doc(recorridoId);
  const uid = auth.currentUser.uid;
  const lote = db.batch();
  lote.set(ref.collection("ingresos").doc(uid), { pid, codigo });
  lote.update(ref.collection("participantes").doc(pid), { uid, reclamado: Date.now() });
  await lote.commit();
  return uid;
}
function mensajeErrorCodigo(e, nombre){
  if(e.code === "auth/operation-not-allowed" || e.code === "auth/admin-restricted-operation")
    return "El ingreso con código todavía no está activado. Avisale a quien te invitó (Firebase → Authentication → Anónimo).";
  if(e.code === "permission-denied")
    return "Ese código no es correcto para " + nombre + ". Revisalo o pedile uno nuevo a quien te invitó.";
  return "No se pudo entrar. Revisá la conexión y probá de nuevo.";
}

// ===== Turnos: un documento por fecha ("2026-10-10") con quién viene ese día =====
function fechasDelRecorrido(r){
  if(!r || !r.fechaInicio) return [];
  const [y, m, d] = r.fechaInicio.split("-").map(Number);
  return Array.from({ length: r.dias || 3 }, (_, i) => {
    const f = new Date(y, m - 1, d + i);
    return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,"0")}-${String(f.getDate()).padStart(2,"0")}`;
  });
}
function turnosCubiertos(r, turnos){
  return fechasDelRecorrido(r).filter(f => turnos[f]).length;
}

// ===== Ranking global: puntos por tarea tildada, sumando todos los recorridos =====
async function calcularRanking(){
  const [partsSnap, tareasSnap] = await Promise.all([
    db.collectionGroup("participantes").get(),
    db.collectionGroup("tareas").get()
  ]);
  const puntosPorSlot = {};
  tareasSnap.forEach(doc => {
    const t = doc.data();
    const rid = doc.ref.parent.parent.id;
    const k = rid + "/" + t.pid;
    puntosPorSlot[k] = (puntosPorSlot[k] || 0) + puntosDeTarea(t.key);
  });
  const map = {};
  partsSnap.forEach(doc => {
    const p = doc.data();
    const rid = doc.ref.parent.parent.id;
    const puntos = (puntosPorSlot[rid + "/" + doc.id] || 0) + tareasLegacy(p);
    if(puntos === 0) return;
    // Misma cuenta de Google = misma persona en todos los recorridos
    const key = p.uid || "n:" + slugify(p.nombre);
    if(!map[key]) map[key] = { nombre: p.nombre || "Anónimo", puntos: 0, recorridos: new Set(), avatar: "" };
    map[key].puntos += puntos;
    if(p.recorridoNombre) map[key].recorridos.add(p.recorridoNombre);
    const av = avatarDe(p);
    if(av) map[key].avatar = av;
  });
  const personas = Object.values(map).map(p => ({ ...p, recorridos: Array.from(p.recorridos) }));
  personas.sort((a, b) => b.puntos - a.puntos);
  return personas;
}
