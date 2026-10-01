import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, getDocs, addDoc, query, where, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-gates", firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url),"utf8"), host:"127.0.0.1", port:8089 } });
const admin = env.authenticatedContext("adminUid", { email:"bm.blancom@gmail.com", email_verified:true }).firestore();
const admin2 = env.authenticatedContext("admin2", { email:"barbarabmontero@gmail.com", email_verified:true }).firestore();
const fakeAdmin = env.authenticatedContext("fake", { email:"bm.blancom@gmail.com", email_verified:false }).firestore();
const A = env.authenticatedContext("uidA", { email:"a@x.com", email_verified:true }).firestore();
const B = env.authenticatedContext("uidB", { email:"b@x.com", email_verified:true }).firestore();
const extraño = env.authenticatedContext("uidX", { firebase:{ sign_in_provider:"anonymous" } }).firestore();   // entró anónimo pero sin código
const anon = env.unauthenticatedContext().firestore();
let n=0; const t = async (name, p) => { await p; n++; console.log("ok -", name); };
const sinReglas = fn => env.withSecurityRulesDisabled(c => fn(c.firestore()));
// Deja a uid como persona pid del recorrido rid (lo que hace entrar con el código)
const hacerMiembro = (rid, uid, pid) => sinReglas(async f => {
  await setDoc(doc(f, `recorridos/${rid}/participantes/${pid}`), { uid }, { merge: true });
  await setDoc(doc(f, `recorridos/${rid}/miembros/${uid}`), { pid, uid, desde: 1 });
  await setDoc(doc(f, `miembros/${uid}`), { rid });
});

// ===== Admin =====
await t("anon no crea recorrido", assertFails(setDoc(doc(anon,"recorridos/r1"), {nombre:"x"})));
await t("admin email no verificado no crea", assertFails(setDoc(doc(fakeAdmin,"recorridos/r1"), {nombre:"x"})));
await t("admin crea recorrido", assertSucceeds(setDoc(doc(admin,"recorridos/r1"), {nombre:"Oct", dias:3, activo:true})));
await t("admin2 edita recorrido", assertSucceeds(updateDoc(doc(admin2,"recorridos/r1"), {dias:4})));
await t("admin crea lauti", assertSucceeds(setDoc(doc(admin,"recorridos/r1/participantes/lauti"), {nombre:"Lauti", uid:null})));
await t("admin crea juan (sin campo uid)", assertSucceeds(setDoc(doc(admin,"recorridos/r1/participantes/juan"), {nombre:"Juan"})));
await t("usuario no crea participante", assertFails(setDoc(doc(A,"recorridos/r1/participantes/intruso"), {nombre:"X", uid:"uidA"})));
await t("admin escribe un acceso", assertSucceeds(setDoc(doc(admin,"accesos/482913"), {rid:"r1", pid:"lauti"})));
await t("admin escribe el código", assertSucceeds(setDoc(doc(admin,"recorridos/r1/codigos/lauti"), {codigo:"482913"})));
await sinReglas(async f => {
  await setDoc(doc(f,"recorridos/r1/codigos/juan"), {codigo:"111222"});
  await setDoc(doc(f,"accesos/111222"), {rid:"r1", pid:"juan"});
  await setDoc(doc(f,"recorridos/r1/tareas/1_milo_seco_2"), {dia:1, key:"milo_seco_2", pid:"lauti", nombre:"Lauti", uid:"x", creado:1});
  await setDoc(doc(f,"recorridos/r1/comentarios/c0"), {uid:"x", nombre:"Lauti", mensaje:"hola"});
  await setDoc(doc(f,"recorridos/r1/turnos/2030-01-01"), {fecha:"2030-01-01", pid:"lauti"});
});

// ===== Privacidad: sin código no se ve nada del recorrido =====
for(const [quien, db] of [["sin sesión", anon], ["anónimo sin código", extraño], ["Google sin código", A]]){
  await t(`${quien}: no ve el recorrido`, assertFails(getDoc(doc(db,"recorridos/r1"))));
  await t(`${quien}: no lista los recorridos`, assertFails(getDocs(collection(db,"recorridos"))));
  await t(`${quien}: no ve los nombres`, assertFails(getDocs(collection(db,"recorridos/r1/participantes"))));
  await t(`${quien}: no ve las tareas`, assertFails(getDocs(collection(db,"recorridos/r1/tareas"))));
  await t(`${quien}: no ve los turnos`, assertFails(getDocs(collection(db,"recorridos/r1/turnos"))));
  await t(`${quien}: no ve los comentarios`, assertFails(getDocs(collection(db,"recorridos/r1/comentarios"))));
  await t(`${quien}: no ve el ranking (collectionGroup)`, assertFails(getDocs(collectionGroup(db,"participantes"))));
  await t(`${quien}: no ve el muro global`, assertFails(getDocs(collection(db,"comentarios"))));
  await t(`${quien}: no ve los códigos`, assertFails(getDoc(doc(db,"recorridos/r1/codigos/lauti"))));
}
await t("nadie lista los accesos (no se pueden adivinar mirando)", assertFails(getDocs(collection(extraño,"accesos"))));
await t("sin sesión no consulta un acceso", assertFails(getDoc(doc(anon,"accesos/482913"))));
await t("con sesión se consulta un acceso sabiendo el código", assertSucceeds(getDoc(doc(extraño,"accesos/482913"))));

// ===== Entrar con el código =====
const entrar = (db, uid, rid, pid, codigo, conMiembros = true) => {
  const b = writeBatch(db);
  b.set(doc(db,`recorridos/${rid}/ingresos/${uid}`), {pid, codigo});
  b.update(doc(db,`recorridos/${rid}/participantes/${pid}`), {uid, reclamado:1});
  if(conMiembros){
    b.set(doc(db,`recorridos/${rid}/miembros/${uid}`), {pid, uid, desde:1});
    b.set(doc(db,`miembros/${uid}`), {rid});
  }
  return b.commit();
};
const celuA1 = env.authenticatedContext("celuA1", { firebase:{ sign_in_provider:"anonymous" } }).firestore();
const celuA2 = env.authenticatedContext("celuA2", { firebase:{ sign_in_provider:"anonymous" } }).firestore();
await t("código: incorrecto rechazado", assertFails(entrar(celuA1, "celuA1", "r1", "lauti", "000000")));
await t("código: el de otra persona rechazado", assertFails(entrar(celuA1, "celuA1", "r1", "lauti", "111222")));
await t("código: sin código no se hace miembro", assertFails(setDoc(doc(celuA1,"recorridos/r1/miembros/celuA1"), {pid:"lauti", uid:"celuA1", desde:1})));
await t("código: sin código no se marca como parte de Les Gates", assertFails(setDoc(doc(celuA1,"miembros/celuA1"), {rid:"r1"})));
await t("código: Google ya no toma un nombre libre sin código", assertFails(updateDoc(doc(B,"recorridos/r1/participantes/juan"), {uid:"uidB", reclamado:2})));
await t("código: con el correcto entra (nombre + membresía)", assertSucceeds(entrar(celuA1, "celuA1", "r1", "lauti", "482913")));
await t("miembro: ve el recorrido", assertSucceeds(getDoc(doc(celuA1,"recorridos/r1"))));
await t("miembro: ve los nombres", assertSucceeds(getDocs(collection(celuA1,"recorridos/r1/participantes"))));
await t("miembro: ve las tareas", assertSucceeds(getDocs(collection(celuA1,"recorridos/r1/tareas"))));
await t("miembro: ve los turnos", assertSucceeds(getDocs(collection(celuA1,"recorridos/r1/turnos"))));
await t("miembro: ve los comentarios", assertSucceeds(getDocs(collection(celuA1,"recorridos/r1/comentarios"))));
await t("miembro: ve el ranking", assertSucceeds(getDocs(collectionGroup(celuA1,"participantes"))));
await t("miembro: ve el muro global", assertSucceeds(getDocs(collection(celuA1,"comentarios"))));
await t("miembro: no ve los códigos", assertFails(getDoc(doc(celuA1,"recorridos/r1/codigos/lauti"))));
await t("miembro: busca sus recorridos (sus membresías)", assertSucceeds(getDocs(query(collectionGroup(celuA1,"miembros"), where("uid","==","celuA1")))));
await t("miembro: no ve las membresías de otros", assertFails(getDocs(collection(celuA1,"recorridos/r1/miembros"))));
await t("miembro: tilda su tarea", assertSucceeds(setDoc(doc(celuA1,"recorridos/r1/tareas/1_milo_seco_1"), {dia:1, key:"milo_seco_1", pid:"lauti", nombre:"Lauti", uid:"celuA1", creado:1})));
await t("código: con el mismo código entra desde otro celular", assertSucceeds(entrar(celuA2, "celuA2", "r1", "lauti", "482913")));
await t("dos celulares: el primero sigue pudiendo tildar", assertSucceeds(setDoc(doc(celuA1,"recorridos/r1/tareas/1_zoe_seco_1"), {dia:1, key:"zoe_seco_1", pid:"lauti", nombre:"Lauti", uid:"celuA1", creado:2})));
await t("dos celulares: el primero guarda sus recordatorios", assertSucceeds(updateDoc(doc(celuA1,"recorridos/r1/participantes/lauti"), {notif:{manana:{on:true}}, actualizado:1})));
await t("dos celulares: el segundo destilda lo que tildó el primero (es la misma persona)", assertSucceeds(deleteDoc(doc(celuA2,"recorridos/r1/tareas/1_zoe_seco_1"))));
await t("miembro: no se hace pasar por otra persona del recorrido", assertFails(setDoc(doc(celuA1,"recorridos/r1/miembros/celuA1"), {pid:"juan", uid:"celuA1", desde:1})));
await t("miembro: no crea la membresía de otro celular", assertFails(setDoc(doc(celuA1,"recorridos/r1/miembros/otro"), {pid:"lauti", uid:"otro", desde:1})));
await t("miembro: no tilda a nombre de otra persona", assertFails(setDoc(doc(celuA1,"recorridos/r1/tareas/2_zoe_seco_1"), {dia:2, key:"zoe_seco_1", pid:"juan", nombre:"Juan", uid:"celuA1", creado:1})));
await t("nadie lee los ingresos (el código no queda a la vista)", assertFails(getDoc(doc(celuA1,"recorridos/r1/ingresos/celuA1"))));
await t("código: no escribe el ingreso de otro uid", assertFails(setDoc(doc(celuA1,"recorridos/r1/ingresos/celuA2"), {pid:"lauti", codigo:"482913"})));
await t("código: Google entra con código y queda vinculado", assertSucceeds(entrar(B, "uidB", "r1", "juan", "111222")));
await sinReglas(f => setDoc(doc(f,"recorridos/r1/codigos/lauti"), {codigo:"999888"}));
await t("código: si el admin genera uno nuevo, el viejo deja de servir", assertFails(entrar(extraño, "uidX", "r1", "lauti", "482913")));
await t("admin: ve las membresías", assertSucceeds(getDocs(collection(admin,"recorridos/r1/miembros"))));
await t("admin: saca una membresía (Liberar)", assertSucceeds(deleteDoc(doc(admin,"recorridos/r1/miembros/celuA2"))));
await t("liberado: ese celular ya no ve los turnos", assertFails(getDocs(collection(celuA2,"recorridos/r1/turnos"))));

// ===== Quien había entrado antes de los códigos se pasa solo =====
await sinReglas(async f => {
  await setDoc(doc(f,"recorridos/viejo"), {nombre:"Viejo", dias:3, activo:true});
  await setDoc(doc(f,"recorridos/viejo/participantes/pam"), {nombre:"Pam", uid:"uidPam"});
  await setDoc(doc(f,"recorridos/viejo/participantes/otra"), {nombre:"Otra", uid:null});
});
const pam = env.authenticatedContext("uidPam", { email:"pam@x.com", email_verified:true }).firestore();
await t("viejo: encuentra su propio nombre", assertSucceeds(getDocs(query(collectionGroup(pam,"participantes"), where("uid","==","uidPam")))));
await t("viejo: no ve los nombres de los demás", assertFails(getDocs(collection(pam,"recorridos/viejo/participantes"))));
await t("viejo: no se hace miembro con otro nombre", assertFails(setDoc(doc(pam,"recorridos/viejo/miembros/uidPam"), {pid:"otra", uid:"uidPam", desde:1})));
await t("viejo: se hace miembro con su nombre", assertSucceeds((() => { const b = writeBatch(pam); b.set(doc(pam,"recorridos/viejo/miembros/uidPam"), {pid:"pam", uid:"uidPam", desde:1}); b.set(doc(pam,"miembros/uidPam"), {rid:"viejo"}); return b.commit(); })()));
await t("viejo: ya ve el recorrido", assertSucceeds(getDoc(doc(pam,"recorridos/viejo"))));
await t("viejo: un miembro de otro recorrido no ve los turnos de este", assertFails(getDocs(collection(pam,"recorridos/r1/turnos"))));
await t("viejo: ni sus comentarios", assertFails(getDocs(collection(pam,"recorridos/r1/comentarios"))));
await t("viejo: ni el recorrido (nombre y fechas)", assertFails(getDoc(doc(pam,"recorridos/r1"))));

// ===== Tareas (checklist compartido) =====
const tarea = {dia:1, key:"milo_humedo", pid:"lauti", nombre:"Lauti", uid:"celuA1", creado:1};
await t("tilda una tarea", assertSucceeds(setDoc(doc(celuA1,"recorridos/r1/tareas/1_milo_humedo"), tarea)));
await t("Juan no re-tilda la tarea de Lauti", assertFails(setDoc(doc(B,"recorridos/r1/tareas/1_milo_humedo"), {...tarea, pid:"juan", uid:"uidB"})));
await t("Juan no destilda la tarea de Lauti", assertFails(deleteDoc(doc(B,"recorridos/r1/tareas/1_milo_humedo"))));
await t("id inconsistente rechazado", assertFails(setDoc(doc(B,"recorridos/r1/tareas/2_zoe_seco_1"), {dia:1, key:"zoe_seco_1", pid:"juan", uid:"uidB"})));
const base = {nombre:"Juan", pid:"juan", uid:"uidB", creado:3};
await t("tarea inventada rechazada", assertFails(setDoc(doc(B,"recorridos/r1/tareas/1_hack"), {...base, dia:1, key:"hack"})));
await t("día fuera del recorrido rechazado", assertFails(setDoc(doc(B,"recorridos/r1/tareas/99_zoe_seco_2"), {...base, dia:99, key:"zoe_seco_2"})));
await t("día 0 rechazado", assertFails(setDoc(doc(B,"recorridos/r1/tareas/0_zoe_seco_2"), {...base, dia:0, key:"zoe_seco_2"})));
await t("día como texto rechazado", assertFails(setDoc(doc(B,"recorridos/r1/tareas/1_zoe_seco_2"), {...base, dia:"1", key:"zoe_seco_2"})));
await t("campo extra (puntos) rechazado", assertFails(setDoc(doc(B,"recorridos/r1/tareas/1_zoe_seco_2"), {...base, dia:1, key:"zoe_seco_2", puntos:1000})));
await t("Juan tilda la suya", assertSucceeds(setDoc(doc(B,"recorridos/r1/tareas/1_zoe_seco_2"), {...base, dia:1, key:"zoe_seco_2"})));
await t("Lauti destilda la suya", assertSucceeds(deleteDoc(doc(celuA1,"recorridos/r1/tareas/1_milo_humedo"))));
await t("sin código no tilda", assertFails(setDoc(doc(extraño,"recorridos/r1/tareas/3_milo_seco_1"), {dia:3,key:"milo_seco_1",pid:"lauti",uid:"uidX"})));
await t("Juan no cambia su nombre", assertFails(updateDoc(doc(B,"recorridos/r1/participantes/juan"), {nombre:"Juancito"})));
await t("Juan guarda su cierre", assertSucceeds(updateDoc(doc(B,"recorridos/r1/participantes/juan"), {cierre:{pct:80, dia:2, fecha:1}, vioCierre:true})));
await t("Juan no toca el cierre de Lauti", assertFails(updateDoc(doc(B,"recorridos/r1/participantes/lauti"), {cierre:{pct:0}})));

// ===== Comentarios =====
await t("sin código no comenta en el muro global", assertFails(setDoc(doc(extraño,"comentarios/x1"), {uid:"uidX", mensaje:"hola"})));
await t("sin código no comenta en el recorrido", assertFails(setDoc(doc(extraño,"recorridos/r1/comentarios/x1"), {uid:"uidX", mensaje:"hola"})));
await t("miembro comenta global", assertSucceeds(setDoc(doc(celuA1,"comentarios/c1"), {uid:"celuA1", nombre:"Lauti", mensaje:"hola"})));
await t("comentario vacío rechazado", assertFails(setDoc(doc(celuA1,"comentarios/vacio"), {uid:"celuA1", mensaje:""})));
await t("comentario gigante rechazado", assertFails(setDoc(doc(celuA1,"comentarios/largo"), {uid:"celuA1", mensaje:"x".repeat(2001)})));
await t("no comenta como otro", assertFails(setDoc(doc(celuA1,"comentarios/c2"), {uid:"uidB", mensaje:"x"})));
await t("Juan no edita el comentario de Lauti", assertFails(updateDoc(doc(B,"comentarios/c1"), {mensaje:"hackeado"})));
await t("Juan no borra el comentario de Lauti", assertFails(deleteDoc(doc(B,"comentarios/c1"))));
await t("Lauti edita su comentario", assertSucceeds(updateDoc(doc(celuA1,"comentarios/c1"), {mensaje:"hola!", editado:1})));
await t("Lauti no transfiere su comentario", assertFails(updateDoc(doc(celuA1,"comentarios/c1"), {uid:"uidB"})));
await t("miembro comenta en su recorrido", assertSucceeds(setDoc(doc(celuA1,"recorridos/r1/comentarios/c1"), {uid:"celuA1", mensaje:"hola"})));
await t("miembro de otro recorrido no comenta en este", assertFails(setDoc(doc(pam,"recorridos/r1/comentarios/c9"), {uid:"uidPam", mensaje:"hola"})));
await t("Lauti borra su comentario del recorrido", assertSucceeds(deleteDoc(doc(celuA1,"recorridos/r1/comentarios/c1"))));
await t("admin borra comentario ajeno", assertSucceeds(deleteDoc(doc(admin,"comentarios/c1"))));

// ===== Recorridos pasados, archivados y en curso =====
const hoy = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
await sinReglas(async f => {
  await setDoc(doc(f,"recorridos/pasado"), {nombre:"Pasado", dias:3, fechaInicio:"2020-01-01", activo:true});
  await setDoc(doc(f,"recorridos/pasado/participantes/lauti"), {nombre:"Lauti"});
  await setDoc(doc(f,"recorridos/pasado/tareas/1_milo_seco_1"), {dia:1, key:"milo_seco_1", pid:"lauti", uid:"uidA", nombre:"Lauti", creado:1});
  await setDoc(doc(f,"recorridos/pasado/comentarios/c1"), {uid:"uidA", nombre:"Lauti", mensaje:"hola"});
  await setDoc(doc(f,"recorridos/archivado"), {nombre:"Arch", dias:3, fechaInicio:iso(hoy), activo:false});
  await setDoc(doc(f,"recorridos/archivado/participantes/lauti"), {nombre:"Lauti"});
  await setDoc(doc(f,"recorridos/encurso"), {nombre:"En curso", dias:3, fechaInicio:iso(hoy), activo:true});
  await setDoc(doc(f,"recorridos/encurso/participantes/lauti"), {nombre:"Lauti"});
});
for(const rid of ["pasado", "archivado", "encurso"]) await hacerMiembro(rid, "uidA", "lauti");
const tareaA = (dia,key) => ({dia, key, pid:"lauti", nombre:"Lauti", uid:"uidA", creado:5});
await t("en curso: Lauti tilda", assertSucceeds(setDoc(doc(A,"recorridos/encurso/tareas/1_zoe_seco_1"), tareaA(1,"zoe_seco_1"))));
await t("en curso: Lauti guarda su cierre", assertSucceeds(updateDoc(doc(A,"recorridos/encurso/participantes/lauti"), {cierre:{pct:90}})));
await t("pasado: Lauti lo puede mirar", assertSucceeds(getDocs(collection(A,"recorridos/pasado/tareas"))));
await t("pasado: Lauti no puede tildar", assertFails(setDoc(doc(A,"recorridos/pasado/tareas/2_zoe_seco_1"), tareaA(2,"zoe_seco_1"))));
await t("pasado: Lauti no puede destildar lo suyo", assertFails(deleteDoc(doc(A,"recorridos/pasado/tareas/1_milo_seco_1"))));
await t("pasado: Lauti no cambia recordatorios ni cierre", assertFails(updateDoc(doc(A,"recorridos/pasado/participantes/lauti"), {cierre:{pct:100}})));
await t("pasado: Lauti sí puede marcar que vio el cierre", assertSucceeds(updateDoc(doc(A,"recorridos/pasado/participantes/lauti"), {vioCierre:true})));
await t("pasado: Lauti no comenta en el muro del recorrido", assertFails(setDoc(doc(A,"recorridos/pasado/comentarios/c2"), {uid:"uidA", mensaje:"tarde"})));
await t("pasado: Lauti no edita su comentario", assertFails(updateDoc(doc(A,"recorridos/pasado/comentarios/c1"), {mensaje:"editado"})));
await t("pasado: Lauti no borra su comentario", assertFails(deleteDoc(doc(A,"recorridos/pasado/comentarios/c1"))));
await t("archivado: Lauti no puede tildar", assertFails(setDoc(doc(A,"recorridos/archivado/tareas/1_zoe_seco_1"), tareaA(1,"zoe_seco_1"))));
await t("pasado: admin tilda a nombre de Lauti", assertSucceeds(setDoc(doc(admin,"recorridos/pasado/tareas/2_zoe_seco_1"), {...tareaA(2,"zoe_seco_1"), uid:null})));
await t("pasado: admin cambia quién hizo una tarea", assertSucceeds(setDoc(doc(admin,"recorridos/pasado/tareas/2_zoe_seco_1"), {dia:2, key:"zoe_seco_1", pid:"otro", nombre:"Otro", uid:null, creado:6})));
await t("pasado: admin destilda", assertSucceeds(deleteDoc(doc(admin,"recorridos/pasado/tareas/1_milo_seco_1"))));
await t("pasado: admin edita el comentario de Lauti", assertSucceeds(updateDoc(doc(admin,"recorridos/pasado/comentarios/c1"), {mensaje:"(editado por admin)"})));
await t("pasado: admin cambia el nombre de una persona", assertSucceeds(updateDoc(doc(admin,"recorridos/pasado/participantes/lauti"), {nombre:"Lautaro"})));

// ===== Turnos: un documento por fecha, un día por persona a la vez =====
const masDias = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
const fTurno = k => iso(masDias(hoy, k));
await sinReglas(async f => {
  // Empezó hace 2 días y dura 11: hay días pasados, hoy y días que vienen
  await setDoc(doc(f,"recorridos/tur"), {nombre:"Turnos", dias:11, fechaInicio:fTurno(-2), activo:true});
  await setDoc(doc(f,"recorridos/tur/participantes/libre"), {nombre:"Libre", uid:null});
  await setDoc(doc(f,"recorridos/tur/turnos/" + fTurno(-1)), {fecha:fTurno(-1), pid:"lauti", nombre:"Lauti", comentario:"", uid:"uidA", actualizado:1});
  await setDoc(doc(f,"recorridos/borr"), {nombre:"Borrador", dias:3, fechaInicio:fTurno(1), activo:true, borrador:true});
});
await hacerMiembro("tur", "uidA", "lauti");
await hacerMiembro("tur", "uidB", "juan");
await hacerMiembro("borr", "uidA", "lauti");
const turno = (fecha, pid, uid, extra = {}) => ({fecha, pid, nombre:pid, comentario:"", uid, actualizado:5, ...extra});
const tRef = (db, fecha, rid = "tur") => doc(db, `recorridos/${rid}/turnos/${fecha}`);
await t("turnos: las personas del recorrido los ven", assertSucceeds(getDocs(collection(B,"recorridos/tur/turnos"))));
await t("turnos: sin código no se anota", assertFails(setDoc(tRef(extraño, fTurno(3)), turno(fTurno(3), "lauti", "uidX"))));
await t("turnos: Lauti se anota en un día libre", assertSucceeds(setDoc(tRef(A, fTurno(3)), turno(fTurno(3), "lauti", "uidA", {comentario:"Llego 19 h"}))));
await t("turnos: Juan no pisa el día de Lauti", assertFails(setDoc(tRef(B, fTurno(3)), turno(fTurno(3), "juan", "uidB"))));
await t("turnos: Juan no edita el comentario de Lauti", assertFails(updateDoc(tRef(B, fTurno(3)), {comentario:"jaja", uid:"uidB"})));
await t("turnos: Juan no libera el día de Lauti", assertFails(deleteDoc(tRef(B, fTurno(3)))));
await t("turnos: Juan no anota a Lauti", assertFails(setDoc(tRef(B, fTurno(4)), turno(fTurno(4), "lauti", "uidB"))));
await t("turnos: nadie anota a alguien sin vincular", assertFails(setDoc(tRef(B, fTurno(4)), turno(fTurno(4), "libre", "uidB"))));
await t("turnos: Lauti edita su comentario", assertSucceeds(updateDoc(tRef(A, fTurno(3)), {comentario:"Llego 20 h", uid:"uidA", actualizado:6})));
await t("turnos: Lauti no le pasa su día a Juan", assertFails(updateDoc(tRef(A, fTurno(3)), {pid:"juan", uid:"uidA"})));
await t("turnos: comentario de más de 400 rechazado", assertFails(updateDoc(tRef(A, fTurno(3)), {comentario:"x".repeat(401), uid:"uidA"})));
await t("turnos: nombre vacío rechazado", assertFails(setDoc(tRef(A, fTurno(5)), turno(fTurno(5), "lauti", "uidA", {nombre:""}))));
await t("turnos: campo extra rechazado", assertFails(setDoc(tRef(A, fTurno(5)), turno(fTurno(5), "lauti", "uidA", {puntos:100}))));
await t("turnos: fecha distinta al id rechazada", assertFails(setDoc(tRef(A, fTurno(5)), turno(fTurno(6), "lauti", "uidA"))));
await t("turnos: día fuera del recorrido (después) rechazado", assertFails(setDoc(tRef(A, fTurno(9)), turno(fTurno(9), "lauti", "uidA"))));
await t("turnos: último día del recorrido sí", assertSucceeds(setDoc(tRef(A, fTurno(8)), turno(fTurno(8), "lauti", "uidA"))));
await t("turnos: id que no es fecha rechazado", assertFails(setDoc(tRef(A, "hola"), turno("hola", "lauti", "uidA"))));
await t("turnos: hoy todavía se puede anotar", assertSucceeds(setDoc(tRef(B, fTurno(0)), turno(fTurno(0), "juan", "uidB"))));
await t("turnos: un día que ya pasó no se toma", assertFails(setDoc(tRef(B, fTurno(-2)), turno(fTurno(-2), "juan", "uidB"))));
await t("turnos: un día que ya pasó no se libera", assertFails(deleteDoc(tRef(A, fTurno(-1)))));
await t("turnos: un día que ya pasó no se edita", assertFails(updateDoc(tRef(A, fTurno(-1)), {comentario:"x", uid:"uidA"})));
await t("turnos: Lauti libera su día", assertSucceeds(deleteDoc(tRef(A, fTurno(3)))));
await t("turnos: liberado, Juan lo toma", assertSucceeds(setDoc(tRef(B, fTurno(3)), turno(fTurno(3), "juan", "uidB"))));
await t("turnos: admin anota a cualquiera", assertSucceeds(setDoc(tRef(admin, fTurno(6)), turno(fTurno(6), "libre", "adminUid"))));
await t("turnos: admin cambia a la persona de un día", assertSucceeds(updateDoc(tRef(admin, fTurno(3)), {pid:"lauti", nombre:"Lauti"})));
await t("turnos: admin libera un día que ya pasó", assertSucceeds(deleteDoc(tRef(admin, fTurno(-1)))));
await t("turnos: si el admin anotó a Lauti, Lauti igual lo edita", assertSucceeds(updateDoc(tRef(A, fTurno(3)), {comentario:"ok", uid:"uidA"})));
await t("turnos: recorrido archivado, no se anota", assertFails(setDoc(tRef(A, iso(hoy), "archivado"), turno(iso(hoy), "lauti", "uidA"))));
await t("turnos: recorrido que ya terminó, no se anota", assertFails(setDoc(tRef(A, "2020-01-02", "pasado"), turno("2020-01-02", "lauti", "uidA"))));
await t("borrador: una persona no lo ve", assertFails(getDoc(doc(A,"recorridos/borr"))));
await t("borrador: Lauti no se anota", assertFails(setDoc(tRef(A, fTurno(1), "borr"), turno(fTurno(1), "lauti", "uidA"))));
await t("borrador: Lauti no tilda", assertFails(setDoc(doc(A,"recorridos/borr/tareas/1_milo_seco_1"), tareaA(1,"milo_seco_1"))));
await t("borrador: Lauti no comenta", assertFails(setDoc(doc(A,"recorridos/borr/comentarios/c1"), {uid:"uidA", mensaje:"hola"})));
await t("borrador: admin sí lo ve y anota", assertSucceeds(setDoc(tRef(admin, fTurno(1), "borr"), turno(fTurno(1), "lauti", "adminUid"))));
await t("borrador: admin lo publica", assertSucceeds(updateDoc(doc(admin,"recorridos/borr"), {borrador:false})));
await t("publicado: Lauti ya lo ve", assertSucceeds(getDoc(doc(A,"recorridos/borr"))));
await t("publicado: Lauti ya puede anotarse", assertSucceeds(setDoc(tRef(A, fTurno(2), "borr"), turno(fTurno(2), "lauti", "uidA"))));
await t("borrador: un usuario no lo publica", assertFails(updateDoc(doc(A,"recorridos/borr"), {borrador:true})));

console.log(`\n${n} pruebas OK`);
await env.cleanup();
process.exit(0);
