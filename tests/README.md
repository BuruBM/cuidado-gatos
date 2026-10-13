# Pruebas

Corren contra los emuladores de Firebase (no tocan la base real).

```
cd tests
npm install
npx playwright install chromium   # solo la primera vez
npm test
```

- `reglas.mjs`: reglas de seguridad de Firestore (quién ve qué, entrar con código, tildar, turnos, comentar, etc.).
- `recorrido-multiple.cjs`: un recorrido de 3 días con 4 personas, de punta a punta en el navegador
  (admin, login con Google, apodos, checklist compartido, cierre, ranking, home). Guarda capturas en `capturas/`.
- `turnos.cjs`: la página de turnos (anotarse con código o con Google, dos personas a la vez sobre el mismo día,
  Mis días, calendario y lista, admin, borradores, modo oscuro). Guarda capturas en `capturas/turnos/`.
- `visita.cjs`: el checklist de visitas (pasar un recorrido en curso, aviso, festejo, puntos, %, guía). Guarda capturas en `capturas/visita/`.

Última revisión completa: 122 chequeos del recorrido, 92 de turnos, 29 del checklist de visitas y 164 de reglas, todos OK.
