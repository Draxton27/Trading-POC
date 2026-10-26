# Fase 41J · Dashboard prospectivo IEX

## Alcance y arquitectura

La sección **Predicciones prospectivas IEX** muestra exclusivamente el protocolo 41I v2 y el modelo XGBoost IEX 38F congelado para NVDA, velas de 15 minutos, feed IEX Live y precios `raw`. Comparadores lineal y por frecuencia proceden de la **misma predicción** 38F. El experimento histórico de `TRADING_POC_ML_RUN_DIR` sigue separado y puede estar en `NO_MODEL` mientras el panel 41J funciona.

El servidor lee el ancla 41I, verifica el SHA del modelo congelado, las cadenas de hashes de IEX Live, predicciones 38F y decisiones 41I, y enlaza cada decisión `RECORDED` con su predicción y las primeras versiones Live disponibles. Las revisiones posteriores permanecen en los ledgers, pero no sustituyen la fuente de una predicción anterior. El calentamiento REST, cuando aparece entre las fuentes de una predicción, requiere su registro inmutable `TRADING_POC_IEX_WARMUP_REGISTRY`; se verifican sus hashes y fechas de registro. El servidor deriva estados de evaluación y coincidencia por modelo al leer. Los GET no ejecutan Python, XGBoost, Alpaca, órdenes, suscripciones ni escrituras.

Los endpoints locales son:

| Endpoint GET | Contenido |
| --- | --- |
| `/api/v1/ml/iex/prospective/overview` | Estado, identidad, recuentos, fechas y cobertura |
| `/api/v1/ml/iex/prospective/history` | Cohorte paginada; `symbol=NVDA`, `timeframe=15m`, `offset`, `limit<=100`, `from`, `to`, `dominantClass`, `actualClass`, `evaluationStatus`, `evaluatedOnly` |
| `/api/v1/ml/iex/prospective/history/:predictionId` | Detalle verificable de una predicción (identificador SHA-256) |
| `/api/v1/ml/iex/prospective/metrics` | Proyección del último snapshot 41I seleccionado y verificado |
| `/api/v1/ml/iex/prospective/coverage` | Velas candidatas, admitidas, abstenciones y captura IEX |

Los contratos de respuesta y estados están en `packages/contracts/src/ml.ts`. El cliente no elige rutas ni nombres de archivos. El detalle publica hasta las últimas 40 referencias de velas fuente y su número total; el listado general no publica hashes de todas las fuentes. Las lecturas tienen límites de tamaño y filas. Las respuestas de error no contienen rutas privadas ni secretos.

## Configuración local Windows

La configuración permanece en `.env.local` de la raíz, fuera de Git. El servidor usa las mismas rutas privadas del recolector:

```dotenv
TRADING_POC_IEX_FROZEN_DIR=C:\ruta\privada\modelo-38f-congelado
# Opcionales si se usan ubicaciones distintas de las predeterminadas:
TRADING_POC_PRIVATE_DIR=C:\ruta\privada\Trading-POC
TRADING_POC_IEX_LEDGER=C:\ruta\privada\iex\ledger.jsonl
TRADING_POC_IEX_CALENDAR=C:\ruta\privada\iex\calendar.json
TRADING_POC_IEX_OBSERVATION_LEDGER=C:\ruta\privada\ml-iex\observations.jsonl
TRADING_POC_IEX_WARMUP_REGISTRY=C:\ruta\privada\ml-iex\warmup-registry.json
TRADING_POC_IEX_41I_PROTOCOL_DIR=C:\ruta\privada\ml-iex\phase41i-prospective-protocol-v2
TRADING_POC_IEX_41J_REPORT_DIR=C:\ruta\privada\ml-iex\phase41i-prospective-report-v2
```

La carpeta del protocolo 41I v2 usa por defecto `private/ml-iex/phase41i-prospective-protocol-v2` bajo el repositorio o `TRADING_POC_PRIVATE_DIR`; la ruta del reporte predeterminado es `phase41i-prospective-report-v2` bajo esa misma base. IEX Live y observaciones mantienen las ubicaciones privadas configuradas por las fases 38A y 38F. El modelo 38F se selecciona **solo** con `TRADING_POC_IEX_FROZEN_DIR`, sin sustituirlo por el modelo SIP o por el experimento histórico.

Para publicar métricas agregadas nuevas, ejecutar el comando de reporte 41I de solo lectura con un **nuevo** `--out-dir`, comprobar sus archivos y apuntar `TRADING_POC_IEX_41J_REPORT_DIR` a ese directorio. El dashboard no elige automáticamente el reporte más reciente ni sobrescribe versiones antiguas. Ver `docs/phase41i-prospective-validation.md` para el comando de reporte y la activación vigente. Nunca repetir `activate` para usar este dashboard.

## Estados y tiempo

`NO_PROSPECTIVE_DATA` indica ancla válida sin predicciones enlazadas; `COLLECTING`, `INSUFFICIENT_EVIDENCE`, `DESCRIPTIVE_PROSPECTIVE_RESULTS` y `PROSPECTIVE_REVIEW_GATE_REACHED` son los estados de investigación 41I. `INVALID_ARTIFACT` oculta una cohorte que no supera integridad. `UNAVAILABLE` indica modelo o protocolo no configurado. Un resultado aún no evaluado es `PENDING` antes de su horizonte más 30 minutos y `OVERDUE_UNEVALUATED` después. `MISSING_ENTRY` y `MISSING_OUTCOME` no cuentan como aciertos o errores de clasificación.

Las horas de vela, recepción, registro, apertura de referencia y fin de horizonte se almacenan en UTC y se presentan en la interfaz con zona de Nueva York. La recepción es el momento en que nuestro proceso obtuvo el dato; la apertura OHLC no representa un fill. `RECORDED` permanece admitida aunque un ledger antiguo contenga después un intento `STALE_LIVE_DATA`; los fallos anteriores a la recuperación se muestran aparte.

La cobertura muestra intervalos de 15 minutos cerrados según las sesiones del calendario oficial **almacenado desde la activación** y cuántas primeras versiones completas Live se recibieron. La ausencia de captura no implica cero operaciones o transacciones. Los períodos sin calendario oficial almacenado no pueden validarse como cobertura completa. Si falta calendario para un nuevo día hábil, el estado es `CALENDAR_UNAVAILABLE`; un fin de semana se muestra como mercado cerrado. Durante mercado cerrado se indica que no se esperan nuevas velas regulares. La infraestructura conserva sus tarjetas existentes de feed, recolector y tarea diaria; una vela vieja fuera de sesión no equivale por sí sola a fallo.

React Query consulta resumen y última predicción cada 30 segundos, historial y cobertura cada 60 segundos, y métricas cada 120 segundos. Son lecturas del backend local. La API reutiliza durante un máximo de dos segundos una proyección ya verificada, siempre que no cambien el tamaño o las marcas de modificación de los archivos relevantes; después vuelve a verificar hashes y reconstruir los estados temporales. No se crea un WebSocket adicional ni se inicia inferencia al abrir la vista.

## Métricas y límites

El servidor verifica `SHA256SUMS`, `manifest.json`, el reporte y su pertenencia al modelo, ancla y cohorte activos. Utiliza las métricas de `ml/phase41i/report.py`; React no reproduce sus fórmulas. `METRICS_SNAPSHOT_STALE` indica predicciones o evaluaciones posteriores al snapshot; su fecha y tamaño de muestra siguen visibles. Un snapshot alterado produce `INVALID_ARTIFACT` para las métricas, sin ocultar predicciones cuyo ledger sigue íntegro. Con cero evaluaciones se muestran `N/D`; con cero BAJISTA real, recall, precision y F1 BAJISTA se presentan como no estimables, y ROC-AUC/PR-AUC conservan los `null` del reporte. Se muestran matrices de confusión y los tres comparadores solo para el mismo conjunto evaluable.

El protocolo continúa siendo experimental. Una predicción correcta no valida causalidad económica ni rentabilidad de opciones; probabilidades y clases argmax no son señales CALL/PUT. El reporte 41I es una fotografía; su manifiesto demuestra integridad de los archivos seleccionados, no sustituye la revisión metodológica o permisos de fuente. El panel no recalcula reportes y no modifica activaciones, modelos ni ledgers.

## Validación

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas sintéticas usan directorios temporales. Cubren ancla y modelo, hashes, estados de ausencia, enlace `RECORDED`, fallos antes/después del éxito, evaluaciones, snapshot, filtros y parámetros de API. Las pruebas E2E DEMO simulan únicamente las respuestas de la vista; no atribuyen esos porcentajes a una sesión bursátil real.
