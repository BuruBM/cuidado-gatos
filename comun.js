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
// - Sus días: los días en que tildó algo, más los días en que nadie tildó nada
//   (si nadie fue, les resta a todos; si cuidó solo, todos los días son suyos)
// - Hechas: todo lo que tildó (tomas, suplementos y piedras)
// - Pendientes: tomas de seco que nadie hizo en sus días, y piedras si nadie las limpió
//   ni ese día ni el anterior (mínimo día por medio)
// Lo que hizo otra persona no le resta. Los suplementos no hechos no restan.
// El día en curso todavía no cuenta como pendiente, salvo que la persona haya tocado
// "Terminé mis días" (hastaDia = hoy): ahí su % se calcula hasta hoy y queda congelado.
function calcularVictoria(tareas, pid, recorrido, hastaDia){
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
  if(dias.size === 0) return null;
  for(let d = 1; d <= hasta; d++) if(!diasConAlgo.has(d)) dias.add(d);
  let pendientes = 0;
  dias.forEach(d => {
    if(d > hasta) return;
    TAREAS_OBLIGATORIAS.forEach(k => { if(!tareas[d + "_" + k]) pendientes++; });
    if(d >= 2 && !tareas[d + "_piedras"] && !tareas[(d-1) + "_piedras"]) pendientes++;
  });
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
