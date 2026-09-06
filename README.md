# Robinhood Trenches Radar — V2 Adaptive Engine

MVP móvil/read-only del sistema que estamos diseñando para Robinhood Chain. La V2 pone el **cerebro antes que la interfaz**: actores adaptativos, confluencia independiente, Safety Gate, Exitability y `DO NOT CHASE`.

## Qué está implementado

- Dos universos separados: **Social Radar** y **Money Radar**.
- La wallet y la identidad humana son objetos conceptualmente separados mediante `identityConfidence` / `identitySource`.
- Exact contract address obligatorio para eventos externos; el símbolo nunca identifica un token.
- Adaptive Radar con divisiones `PROVISIONAL / TESTED / CORE`.
- Ajuste por tamaño de muestra: `n/(n+8)` y decay por inactividad.
- Perfiles por función (`discovery`, `confirmation`, `execution`, `reentry`, `narrative`) en lugar de un ranking único.
- Confluencia por **actores independientes**, no por número bruto de posts/eventos.
- `Safety Gate`: un FAIL crítico bloquea; un UNKNOWN crítico nunca se convierte en Entry.
- `Exitability`: incorpora liquidez y degradación estimada de una venta de tamaño relevante.
- `DO NOT CHASE`: una señal buena se rechaza si el precio se ha alejado demasiado de la primera señal.
- `DISTRIBUTION`: dos actores independientes reduciendo/saliendo tienen prioridad sobre una señal antigua de compra.
- Snapshot por evento con `blockNumber`, `blockHash`, `blockTime`, MC y liquidez cuando la fuente los suministra.
- Estados finales: `IGNORE`, `WATCH`, `ENTRY_CANDIDATE`, `HIGH_CONFLUENCE`, `DO_NOT_CHASE`, `DISTRIBUTION`, `BLOCKED`.
- PWA móvil con `Morning / Live / Token / Traders / Alerts`.
- Notificaciones locales del navegador al aparecer Entry/High Confluence/Distribution mientras la PWA está activa y puede refrescar.
- Demo sintético explícito para probar el motor sin fabricar hallazgos live.

## Fuentes live previstas

1. **Identidad:** FomoScan cuando se proporciona `FOMOSCAN_API_KEY`.
2. **Wallet truth:** RPC de Robinhood Chain (chain 4663), leyendo Transfer logs y neteando por transacción.
3. **Market snapshot:** DexScreener.
4. **Social calls / deployer / structure:** se conectarán como ingestas externas mediante `/api/events` y `/api/token-state`.
5. **Safety / Exitability:** upstream de diligencia y quotes read-only; el motor considera UNKNOWN cualquier check crítico no resuelto.

La app no necesita seed phrase, private key ni permiso de trading.

## API mínima de integración

### Añadir una call / compra / venta externa

`POST /api/events`

```json
{
  "actorId":"kenjidgn",
  "action":"CALL",
  "tokenAddress":"0x...40 hex chars...",
  "symbol":"XYZ",
  "marketCap":420000,
  "blockTime":"2026-09-06T00:10:00Z",
  "source":"robinx"
}
```

Acciones válidas: `CALL`, `BUY`, `ADD`, `REENTRY`, `ACQUIRE`, `TRIM`, `SELL`, `EXIT`.

### Cerrar Safety / Execution de un token

`POST /api/token-state`

```json
{
  "tokenAddress":"0x...",
  "state":{
    "marketCap":720000,
    "safety":{
      "tokenControl":"PASS",
      "upgradeAuthority":"PASS",
      "canonicalLp":"PASS",
      "sellRestriction":"PASS"
    },
    "execution":{
      "liquidityUsd":190000,
      "sellImpactPct":3.4,
      "maxChaseMultiple":2
    }
  }
}
```

### Alimentar estadísticas del backfill

`POST /api/actors/performance`

```json
{
  "actorId":"unipcs",
  "sampleSize":14,
  "recentEdge":76,
  "lifetimeEdge":72,
  "copyability":68
}
```

## Arranque

```bash
cp .env.example .env
node server.js
```

Abre `http://localhost:8787`. Para probar la lógica sin fuentes live, usa **Alerts → Cargar demo**. Los tokens demo son claramente sintéticos.

## Validación realizada

`npm test` comprueba, entre otras reglas:

- un riesgo crítico bloquea aunque haya alpha;
- un UNKNOWN crítico nunca se presenta como Entry;
- una señal que ya corrió demasiado se convierte en `DO_NOT_CHASE`;
- dos salidas independientes producen `DISTRIBUTION`;
- muestras pequeñas reciben menos confianza que históricos amplios.

## Lo que NO está terminado todavía

- El backfill completo de las Money Wallets aún debe alimentar `sampleSize`, returns y role scores con resultados reales.
- Safety Gate live todavía necesita su ingestor de contrato/LP/deployer.
- Exitability live necesita quotes read-only al tamaño objetivo; no debe aproximarse sólo por TVL.
- Las notificaciones en segundo plano con la app cerrada se harán en la versión Android final mediante push nativo (FCM o equivalente). La PWA actual no pretende sustituir esa capa.
- La build APK no está incluida en esta V2; primero queremos validar el motor y sus datos.

## Principio operativo

La app no debe decir “compra” porque una wallet popular compró. Sólo crea una candidata cuando coinciden **WHO + WHEN + SAFE + CAN WE EXIT**, y siempre puede degradarla a WATCH, BLOCKED o DO NOT CHASE.

---

## Railway-ready (v0.3)

Esta variante incorpora persistencia Postgres y separación `app ↔ worker` para Railway:

- `lib/storage.js`: usa Postgres cuando existe `DATABASE_URL` y JSON local como fallback de desarrollo.
- `worker.js`: proceso 24/7 que dispara el sync privado de la app.
- `railway.json`: configuración del servicio web.
- `railway.worker.json`: configuración del worker.
- `DEPLOY_RAILWAY.md`: pasos exactos de despliegue.
- Los endpoints de escritura están protegidos por `WRITE_API_TOKEN` en producción.
- Los endpoints de sincronización están protegidos por `INTERNAL_SYNC_TOKEN`.
- Iconos PWA incluidos para una instalación fiable en Android.

La app sigue siendo **read-only respecto a wallets** y nunca necesita claves privadas.
