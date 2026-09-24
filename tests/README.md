# Pruebas

Corren contra los emuladores de Firebase (no tocan la base real).

```
cd tests
npm install
npx playwright install chromium   # solo la primera vez
npm test
```

- `reglas.mjs`: reglas de seguridad de Firestore (quién puede tildar, vincular nombres, comentar, etc.).
- `recorrido-multiple.cjs`: un recorrido de 3 días con 4 personas, de punta a punta en el navegador
  (admin, login con Google, apodos, checklist compartido, cierre, ranking, home). Guarda capturas en `capturas/`.
- `turnos.cjs`: la página de turnos (anotarse con código o con Google, dos personas a la vez sobre el mismo día,
  Mis días, calendario y lista, admin, borradores, modo oscuro). Guarda capturas en `capturas/turnos/`.

Última revisión completa: 119 chequeos del recorrido, 79 de turnos y 114 de reglas, todos OK.
