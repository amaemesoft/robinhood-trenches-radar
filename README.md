# Robinhood Trenches Radar — Beta operativa

Radar móvil/read-only desplegado sobre Robinhood Chain. El sistema combina seguimiento on-chain de Money Wallets, confluencia independiente, Safety Gate, Exitability y calibración con retornos observados. Nunca opera una wallet ni convierte datos incompletos en una recomendación.

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
- Feed live firmado de Alchemy para cinco Money Wallets y backfill conservador de siete días.
- Verificación on-chain de lanzamientos Pons, procedencia de factory/pool y quotes read-only para Exitability.
- Historial persistente de precio por token y retornos futuros a 5m, 15m, 1h, 3h, 6h, 24h, 3d y 7d.
- Calibración por wallet con muestra, win rate, mediana, MAE y MFE; sin promoción automática hasta tener entradas económicas verificadas.
- Estados finales: `IGNORE`, `WATCH`, `ENTRY_CANDIDATE`, `HIGH_CONFLUENCE`, `DO_NOT_CHASE`, `DISTRIBUTION`, `BLOCKED`.
- PWA móvil con resumen, señales, calibración y ranking adaptativo.

## Fuentes live

1. **Actividad:** webhook de Alchemy firmado, limitado a las cinco Money Wallets resueltas.
2. **Histórico:** Alchemy Transfers sobre una ventana de 604.800 bloques, con clasificación económica conservadora.
3. **Verdad on-chain:** RPC de Robinhood Chain (chain 4663), receipts, logs y contratos.
4. **Mercado:** DexScreener para precio, market cap y liquidez observados.
5. **Safety / Exitability:** factories y pools Pons verificados on-chain más quotes read-only al tamaño objetivo.
6. **Ingesta externa:** `/api/events` y `/api/token-state` para futuras fuentes sociales o de diligencia.

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

### Consultar calibración observada

`GET /api/calibration`

Devuelve el estado de la muestra por Money Wallet, retornos futuros completados, medianas, MAE y MFE. Si todavía no hay compras económicas verificadas, responde `INSUFFICIENT_VERIFIED_ENTRIES` y conserva las wallets como provisionales.

## Arranque

```bash
cp .env.example .env
npm install
node server.js
```

Abre `http://localhost:8787`.

## Validación realizada

`npm test` ejecuta 29 pruebas y comprueba, entre otras reglas:

- un riesgo crítico bloquea aunque haya alpha;
- un UNKNOWN crítico nunca se presenta como Entry;
- una señal que ya corrió demasiado se convierte en `DO_NOT_CHASE`;
- dos salidas independientes producen `DISTRIBUTION`;
- muestras pequeñas reciben menos confianza que históricos amplios.
- actividad receive-only no se etiqueta como compra;
- los retornos futuros, MAE y MFE se calculan sólo con precios realmente observados.

## Límites conocidos de la beta

- El backfill disponible no contiene trazas internas nativas en el plan actual de Alchemy; por eso los movimientos sin evidencia económica quedan como `ACQUIRE` o `TRANSFER_OUT`, nunca como BUY/SELL inventados.
- La calibración necesita acumular compras reales y esperar sus horizontes futuros antes de promover wallets.
- Las notificaciones nativas en segundo plano y la build APK quedan fuera de esta beta web.
- El Social Radar mantiene perfiles provisionales hasta conectar una fuente social verificable.

## Principio operativo

La app no debe decir “compra” porque una wallet popular compró. Sólo crea una candidata cuando coinciden **WHO + WHEN + SAFE + CAN WE EXIT**, y siempre puede degradarla a WATCH, BLOCKED o DO NOT CHASE.

---

## Railway-ready (v0.4)

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
