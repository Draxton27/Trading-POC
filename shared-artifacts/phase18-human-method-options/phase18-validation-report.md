# Fase 18 — validación de código y datos

Protocolo previo: `8aecb621b4bf284320a9b2fa3e5f0a8fd8a5006f`. Los SHA-256 exactos de `phase18-core.ts` y `phase18-run.ts` están en [integridad](phase18-data-integrity.json). El comando `npm run study:phase18` volvió a generar los cuatro CSV cuantitativos y el informe con 32.510 observaciones, 9.684 filas de evento y 1.242 señales anteriores.

| Comprobación | Resultado |
| --- | --- |
| `npm ci --cache /tmp/phase18-npm-cache` | Correcta; cuatro paquetes instalados. |
| `npm run typecheck` | Correcta. |
| `npm test` | **168/168** pruebas aprobadas, incluidas nueve pruebas nuevas F18. |
| `validate:nvda`, `validate:nvda-volume`, `validate:nvda-indicators`, `validate:nvda-sma-context` | Correctos. |
| `validate:nvda-pullback-breakout`, `validate:nvda-failed-breakouts`, `validate:nvda-volatility` | Correctos. |
| `validate:phase14-context`, `validate:phase15-confirmation` | Correctos. |
| Hashes de fuentes NVDA/QQQ/SMH y auxiliares | Coinciden exactamente con los doce hashes del informe F14; NVDA coincide con `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`. |
| Causalidad y correspondencia | Referencias SMA horarias/diarias terminan a más tardar al inicio de la observación; recuperaciones quedan dentro de dos velas de su episodio; las 1.242 señales coinciden en índice, timestamp, retorno, retornos ETF, régimen y grupo F15. |
| Integridad de Fases 12, 14 y 15 | Sus `SHA256SUMS.txt` originales verifican; `git status` no incluye cambios de resultados históricos. |

**Nota de reproducción de validadores:** los comandos históricos F12/F14/F15 regeneran informes con el hash del commit que los ejecuta. Al correr F12 desde esta rama, el campo editorial `codeVersion` de su paquete cambió temporalmente y F13 rechazó el hash, como debía. Se restauró el paquete F12 publicado; luego F13 validó correctamente. Se restauraron igualmente los paquetes F14/F15 después de sus validaciones. Esos archivos publicados se mantuvieron intactos en el PR. Ninguna discrepancia de señal o precio motivó el incidente.

Las pruebas de opciones emplean cotizaciones **sintéticas** para comprobar validez temporal, bid/ask, selección OCC y separación de escenarios. La cuenta no aportó quotes históricos OPRA autorizados; no se calculó rentabilidad de opciones ni se envió una orden.
