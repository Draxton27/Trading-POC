# Fase 41D · Objetivos de trayectoria y protocolo predictivo

Esta fase define objetivos experimentales para NVDA IEX raw de 15 minutos. Reconstruye los desenlaces desde las observaciones 38E, las velas estrictas de 38D y el calendario oficial; el reporte 41C v6 sirve únicamente como comprobación de paridad. No entrena ni promueve modelos. La imagen de Investep proporcionada por el operador se trata como material didáctico, sin atribuirle resultados empíricos.

## Fuentes, integridad y contrato temporal

`ml.phase41c.sources.load_sources` verifica SHA-256, procedencia NVDA/IEX/raw, calendario y las observaciones y predicciones originales. `ml.phase41c.target_audit.exact_original_parity` comprueba para cada observación la entrada, la cuarta vela, el ATR y la etiqueta 38E. `ml.phase41c.trajectory.future_bars` exige entrada estrictamente posterior a la decisión, cuatro velas programadas y continuas de una misma sesión, incluidos cierres abreviados. `trajectory` calcula los toques y cierres sin suponer un recorrido intravela. El reporte 41D vuelve a verificar todos los hashes del directorio 41C v6 y compara cada trayectoria disponible y excluida. No usa SIP split para desenlaces IEX raw.

En cada registro, `decision_at_utc` es el momento **simulado** en que la vela de observación ya estaría disponible; en `delayed` es cierre +20 minutos, y en `ideal` es el cierre. `reference_entry_at_utc` es la primera apertura programada estrictamente posterior. `target_horizon_end_utc` es el cierre programado de la cuarta vela desde esa entrada. Para una etiqueta reconstruible, `target_known_at_utc` coincide con ese cierre **teórico**, identificado por `availability_basis=THEORETICAL_BAR_CLOSE`; `historical_received_at_utc` permanece `null`. El histórico REST no acredita cuándo recibió realmente el sistema aquellas velas. Si falta la entrada, el cierre cabe fuera de sesión o falta una vela, `target_value` y `target_known_at_utc` son `null` y `availability_status` expresa la causa. Ningún registro histórico recibe `PROSPECTIVE_UNSEEN`.

Los registros conservan escenario, fold original, sesión de Nueva York, inicio de la observación, entrada, ATR(t), tiempos, clase o exclusión, SHA-256 de su definición y `source_hash` vinculado al snapshot 38D, la observación 38E y las cuatro velas utilizadas. La salida no incorpora columnas de características futuras. Los umbrales y el horizonte son definiciones anteriores a este informe; no se ajustan según los recuentos.

## Objetivos congelados

| ID | Tipo | Definición | Cuándo es evaluable |
|---|---|---|---|
| `NET_MOVE_4B_ATR05_V1` | Tres clases | `change = close(bar4) − entry_open`; ALCISTA si `change > 0,5 ATR14(t)`, BAJISTA si `change < −0,5 ATR14(t)` y LATERAL en los demás casos. | Cuatro velas completas; reproduce exactamente la etiqueta 38E. |
| `DOWN_TOUCH_4B_ATR05_V1` | Binario | `DOWN_TOUCH` si `min(low(bar1..bar4)) <= entry_open − 0,5 ATR14(t)`; si no, `NO_DOWN_TOUCH`. | Mismas cuatro velas; el toque es inclusivo. |
| `PERSISTENT_BEAR_4B_ATR05_V1` | Binario | `PERSISTENT_BEAR` si la etiqueta original es BAJISTA, hay al menos tres cierres bajo la entrada y una racha de al menos tres. | Mismas cuatro velas. Los dos contadores se conservan por paridad con 41C aunque la racha implica el total. |

Cada definición contiene fórmula, parámetros, clases, versión y un hash fijo en `ml/phase41d/registry.py`. El verificador rechaza alterar su contenido conservando el ID. Una fórmula nueva requerirá otro identificador y otra versión. El registro completo tiene hash `0a5849f704adc87420ff3ea276f60206720207378c25dcffe37fcbfa6ea06a91`. La clasificación original, folds, probabilidades y modelos 38E no se editan.

El diagnóstico auxiliar de primera barrera es independiente de esos tres objetivos: `DOWN_FIRST_OR_ONLY_DOWN`, `UP_FIRST_OR_ONLY_UP`, `BOTH_FIRST_SAME_BAR_AMBIGUOUS` o `NEITHER_TOUCHED`. `barrier_reach` distingue además `DOWN_ONLY`, `UP_ONLY`, `BOTH` y `NEITHER`; por ello una barrera única no se interpreta como secuencia completa. La ambigüedad aparece solo cuando el primer toque inferior y el primer toque superior corresponden a **la misma vela**. Una vela posterior que cruza ambos niveles no borra un orden ya conocido. No se infiere el orden de OHLC dentro de esa vela.

Un toque intrahorizonte no representa un fill al mínimo, una ganancia de opción ni una tendencia bajista confirmada. La definición de persistencia es descriptiva y no se atribuye como regla oficial de Investep.

## Resultado histórico local

La salida privada se generó en `private/ml-iex/phase41d-target-protocol-v1/` y sus siete hashes SHA-256 verifican. La paridad con las **16.374** observaciones de 41C v6 fue exacta. Los tres objetivos comparten la misma cobertura por escenario porque usan el mismo horizonte. Los resultados son `HISTORICAL_EXPLORED`: 38E, 40A, 40B, 40C, 41B y 41C ya examinaron este período.

| Escenario | Observaciones | Evaluables | NET ALCISTA / BAJISTA / LATERAL | DOWN_TOUCH / no toque | PERSISTENT_BEAR / no persistente |
|---|---:|---:|---:|---:|---:|
| delayed, principal | 8.187 | 6.219 en 333 sesiones | 1.681 / 1.705 / 2.833 | 3.552 / 2.667 | 1.409 / 4.810 |
| ideal, separado | 8.187 | 6.536 en 333 sesiones | 1.818 / 1.855 / 2.863 | 3.832 / 2.704 | 1.533 / 5.003 |

En delayed se excluyeron 943 sin entrada programada, 942 por cierre y 83 por velas futuras ausentes. En ideal se excluyeron 629, 942 y 80 respectivamente. Los folds delayed conservan 2.243, 2.432 y 1.544 observaciones evaluables. En delayed, 1.250 trayectorias tocaron ambas barreras, 477 tuvieron alguna vela bilateral y **229** tuvieron primeros toques simultáneos; esas 229 son las ambiguas sobre el orden inicial. El objetivo auxiliar no se usa para elegir una regla ganadora.

Las distribuciones no son métricas predictivas. El Macro F1 de tres clases y el de un objetivo binario miden problemas distintos; compararlos directamente sería engañoso. Cada objetivo requiere su propio baseline y evaluación sobre filas idénticas dentro de ese objetivo.

## Protocolo congelado para una fase futura

`comparison-protocol.json` registra el hash `29d3aae08bcb834cf1b86ee2ac905755da3bbca5aeeea8d261b0cd423b1ea4e3` y la hora UTC de generación en el manifiesto privado. El escenario primario será `delayed`; `ideal` se evaluará por separado. Los candidatos predefinidos son prevalencia histórica, regresión logística, XGBoost y LightGBM. No se entrenó ninguno aquí.

Se proponen tres conjuntos anidados, con orden de columnas fijado en el JSON:

- **F0:** exactamente las diez columnas y su orden de 38E: `return_1`, `return_4`, `distance_ema9`, `distance_sma20`, `bollinger_position`, `relative_volume_20`, `candle_range`, `candle_body`, `atr14_relative`, `minutes_from_open`.
- **F1:** F0 más ocho descriptores geométricos y de secuencia: razón cuerpo/rango, mechas superior e inferior/rango, ubicación del cierre en rango, rachas alcista y bajista de hasta cuatro velas, conteo de máximos crecientes y de mínimos decrecientes en cuatro velas. Las columnas de retorno de cuatro velas y volumen relativo ya existen en F0 y no se duplican.
- **F2:** F1 más el orden completo de SMA, alineación corta y larga, pendientes individuales de SMA20/40/100/200, posición del precio respecto a cada SMA, contexto candidato de techo y piso en 15m y concordancia con 1h/1d. Es una especificación para investigar: su codificación categórica y política de datos faltantes deben congelarse antes de entrenar.

Para una misma etiqueta se utilizarán los mismos instantes y filas para todos los modelos y baselines. El entrenamiento por sesiones será cronológico; una etiqueta participa solo si su cierre teórico ya precedía el corte de entrenamiento, con purga de ventanas solapadas. Escalado y early stopping usan exclusivamente desarrollo anterior al fold externo. Los umbrales de clasificación se decidirán en desarrollo interno. Los objetivos binarios informarán precision, recall, PR-AUC frente a su prevalencia, ROC-AUC, Brier, log loss, balanced accuracy, calibración y matriz de confusión. Para el objetivo original se conservarán Macro F1 y métricas por clase. La incertidumbre agrupará sesiones y examinará sensibilidad a agrupaciones semanales y mensuales; las ventanas solapadas no se tratarán como independientes.

### Catálogo causal de velas y estructura

Para una vela cerrada t con rango positivo `R=high−low`: cuerpo/rango `|close−open|/R`, mecha superior/rango `(high−max(open,close))/R`, mecha inferior/rango `(min(open,close)−low)/R`, ubicación del cierre `(close−low)/R`, dirección `sign(close−open)` y amplitud `(high−low)/ATR14(t)`. Si `R=0`, las razones son ausentes, no cero inventado. El volumen relativo usa `volume(t)` dividido por el promedio de las 20 velas completas anteriores; no incluye su propia vela en el denominador. Los retornos direccionales usan `close(t)/close(t−k)−1` para ventanas fijadas antes de entrenar.

Las secuencias propuestas observan solo las últimas 2, 3, 4 u 8 velas completas y continuas hasta t: rachas consecutivas de cuerpos alcistas/bajistas; conteos de pares adyacentes con máximos crecientes, mínimos decrecientes, mínimos crecientes o máximos decrecientes. Estas son hipótesis descriptivas medibles. No se identifican patrones subjetivos ni se mira una vela posterior para decir que un patrón ya existía.

La lámina de Investep ilustra, de arriba hacia abajo, `20>40>100>200`, `40>20>100>200`, `200>100>40>20` y `200>100>20>40`. El orden es una posibilidad de contexto, no prueba de techo, piso, soporte efectivo o continuación. Para un `candidate_ceiling_context` o `candidate_floor_context` se deben registrar separadamente: orden de las SMA, posición actual del precio, dirección de aproximación, interacción geométrica verificada, temporalidad y confirmación causal. Los toques (`low<=SMA<=high`), rechazos, velas completas al otro lado y retesteos reutilizarán las definiciones del motor 41A. Las medias y pendientes de 15m, 1h y 1d requieren cierres completos y continuidad; un agregado ausente queda no disponible. Los colores, iconos y flechas de la imagen no se traducen a resultados empíricos.

## Puerta prospectiva

`PROSPECTIVE_UNSEEN` se reserva a capturas posteriores a congelar **protocolo, modelo, características, objetivo y regla de decisión**, con hashes y timestamps de recepción verificables. La propuesta de reporte exige al menos **60 sesiones bursátiles evaluables**, con **20 positivos y 20 negativos** en cada objetivo binario antes de emitir conclusiones de desempeño. Es un mínimo administrativo de evidencia, no un cálculo de potencia ni garantía. Si falta cobertura, una sesión está incompleta o un desenlace no se recibió, se registra la exclusión y el estado `INSUFFICIENT_EVIDENCE`. La estadística principal binaria será PR-AUC frente a prevalencia y Brier frente al baseline; para el objetivo original, Macro F1 frente a su baseline. Los cortes y la política de manejo de ausencias deben fijarse antes de observar desenlaces nuevos. Los folds históricos conservan el estado `HISTORICAL_EXPLORED`; `TEMPORAL_VALIDATION` solo describe una separación temporal dentro del histórico ya examinado.

## Reproducción Windows

Desde la raíz del repositorio, con el entorno Python 3.12 existente:

~~~powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase41d.report --history private\iex-history\nvda-2024-2026-phase38e --run private\ml-iex\phase38e-20261023-v1 --reference private\ml-iex\phase41c-target-audit-v6 --out private\ml-iex\phase41d-target-protocol-v1
.\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase41d.test_targets
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
~~~

El destino debe ser **nuevo**; para repetir la generación se elige otro nombre de directorio privado, conservando v1. Se escriben `manifest.json`, `target-registry.json`, `target-labels.json`, `coverage.json`, `comparison-protocol.json`, `report.json`, `report.md` y `SHA256SUMS`. Los archivos originales y las salidas privadas no se suben a Git. CI Windows usa Node 22/24 y Python 3.12 con fixtures sintéticas.
