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

Última revisión completa: 104 chequeos del recorrido y 64 de reglas, todos OK.
