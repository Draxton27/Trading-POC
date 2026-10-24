# Fase 39 · Radar de Mercado v1

La vista **Radar de Mercado** y `GET /api/v1/radar` leen NVDA, QQQ y SMH. El endpoint acepta `symbols=NVDA,QQQ,SMH` (de uno a tres activos, sin duplicados) y `right=CALL|PUT` para consultar referencias documentales. Las consultas son de solo lectura. No abren suscripciones, descargan datos ni ejecutan Python.

## Procedencia y reglas

- Los cierres e indicadores se calculan mediante `marketEvidence()` y `analyzeMarketBars()`, que usan las funciones de indicadores y ventanas continuas existentes. Solo se admiten velas completas de 15 minutos con calendario disponible. SMA 20/40/100/200, Bollinger 20/2, RVOL de 20 sesiones del mismo horario y retornos de 15/60 minutos muestran `N/D` ante historia insuficiente o huecos. El cierre del CSV es histórico, incluso si la API se consulta durante mercado abierto.
- El estado `STALE` del cierre usa un umbral informativo de 30 minutos respecto al reloj de la consulta. No implica que el mercado esté abierto; fuera de sesión el histórico seguirá obsoleto. La cotización IBKR preexistente se presenta en un campo separado, con `feedType`, marca de mercado y recepción. No transforma el análisis SIP en LIVE ni crea nuevas suscripciones.
- Tendencia observada `ALCISTA`: cierre > SMA20 > SMA40 y retornos de 15 y 60 minutos positivos. `BAJISTA`: desigualdades y retornos inversos. `LATERAL`: igualdad exacta de cierre y ambas medias, con ambos retornos nulos. Cualquier lectura mixta o ventana faltante es `INDETERMINADA`. Es una descripción verificable, no una señal ni un criterio optimizado.
- La comparación de fortaleza usa solo retornos porcentuales de barras completas en un timestamp UTC común y con igual fuente/tipo de datos. Si falta una ventana o la fuente difiere, no emite una clasificación relativa.
- Las noticias se leen de los ledgers verificados de Fase 36. Solo se cuentan clasificaciones cuyo artículo ya había sido recibido y cuyo análisis ya había terminado. El radar muestra sentimiento, relevancia, fecha y procedencia controlados; no atribuye causalidad. El contenido de titulares no se trata como instrucciones del asistente.
- NVDA puede mostrar únicamente probabilidades XGBoost IEX **ya registradas** por Fase 38F. Se verifica cadena SHA-256, modelo congelado configurado, clases, orden, suma de probabilidades, procedencia y tiempos. `CURRENT` exige desenlace pendiente y registro de hasta 15 minutos; `HISTORICAL` indica evaluación disponible; `STALE`, `UNAVAILABLE` e `INVALID_LEDGER` evitan tratar registros viejos o corruptos como vigentes. QQQ y SMH muestran `MODELO_NO_DISPONIBLE`. Las probabilidades son experimentales y no calibradas.
- Los hashes locales detectan alteraciones accidentales entre archivos y registros; por sí solos no autentican un dataset original frente a quien pueda reescribir los archivos y sus manifiestos.
- Las referencias Investep usan `selectAcademyReference()`. Rango óptimo y límites adicionales son importes ASK documentales; su unidad por acción es interpretación del operador. El estado `HISTORICAL_ONLY` no supone vigencia. El radar no selecciona un contrato ni solicita OPRA, por lo que el ASK actual figura `N/D`. El precio del subyacente y su probabilidad no representan rentabilidad de CALL o PUT.

## Asistente

Las preguntas inequívocas sobre panorama, fortaleza técnica o probabilidades registradas usan `get_market_radar` con validación Zod y respuesta calculada por el backend. Por ejemplo: «Dame el panorama de NVDA, QQQ y SMH» o «¿Qué probabilidad alcista tiene NVDA y de cuándo es?». La pregunta sobre discrepancia entre análisis técnico y predicción usa NVDA, el único activo con modelo IEX. Las consultas ambiguas conservan el selector Ollama local y sus límites. El modelo no recibe archivos privados ni calcula probabilidades.

## Prueba local en Windows

```powershell
npm.cmd run dev:mock
# Abra http://127.0.0.1:5173 y seleccione Radar de Mercado.
# El modo MOCK/DEMO solo ofrece barras sintéticas; no debe mostrar probabilidades fabricadas.
```

Para consultar registros IEX propios, configure en `.env.local` `TRADING_POC_IEX_FROZEN_DIR` y `TRADING_POC_IEX_OBSERVATION_LEDGER` con las rutas privadas de Fase 38F. El servidor solo lee esos archivos. Una prueba con DEMO no valida una cotización LIVE ni la actualidad del modelo. No se copiaron históricos, modelos, credenciales o documentos privados al repositorio.
