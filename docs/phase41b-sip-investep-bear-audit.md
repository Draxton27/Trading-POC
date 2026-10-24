# Fase 41B: auditoría retrospectiva BAJISTA con contexto técnico SIP

Esta investigación asocia las predicciones y etiquetas originales de NVDA IEX de Fase 38E con el contexto técnico SIP de Fase 41A en el instante de decisión de cada predicción. **No entrena modelos ni cambia predicciones, etiquetas o reglas técnicas.** La asociación describe condiciones históricas; no demuestra valor predictivo ni constituye una señal.

## Fuentes y causalidad

- IEX `raw`: se validan los manifiestos y SHA-256 del histórico 38D y de las predicciones 38E. Se conservan escenarios `ideal` y `delayed`, folds, probabilidades, etiquetas e instantes de inferencia originales.
- SIP `split`: se exige NVDA, Alpaca Market Data API, feed SIP, velas regulares de 15 minutos, calendario oficial y archivos de metadatos y procedencia. Sus medias, niveles y distancias utilizan **solo precios SIP**. No hay restas ni cocientes de precio IEX con niveles SIP.
- La disponibilidad SIP histórica se **simula** a cierre de vela más 15, 20 o 30 minutos. El CSV no contiene la recepción original. Cada agregado horario y diario se incorpora únicamente cuando todas sus velas están completas y terminó el retraso supuesto. El cierre diario de la sesión actual no participa antes de ese momento.
- El ajuste por splits del archivo histórico puede reflejar revisiones retrospectivas. El estudio no acredita que la misma serie ajustada estuviera disponible durante cada sesión pasada.

El índice usa los agregadores, SMA y funciones de geometría, pendientes, alineación y eventos de Fase 41A. Recorre series cronológicas verificadas, reinicia ventanas al detectar huecos y consulta únicamente puntos disponibles al instante IEX. Los retesteos pendientes no se convierten en confirmados usando velas futuras. La paridad matemática frente al motor 41A se prueba con fixtures, incluso alrededor de DST, fines de semana y cierres anticipados.

## Poblaciones y métricas

Cada consulta IEX se conserva para los tres retrasos, incluso si falta la etiqueta original o el contexto SIP. La cobertura distingue `SOURCE_OUT_OF_RANGE`, `INSUFFICIENT_SIP_HISTORY`, `INCOMPLETE_SESSION`, `SIMULATED_DELAY_NOT_MET` y `TECHNICAL_CONTEXT_AVAILABLE`; el JSON muestra recuentos por escenario, fold y clase real. También informa SMA por temporalidad, niveles previos y las tres temporalidades simultáneas.

Los estratos técnicos se fijan en el código antes de inspeccionar resultados: orden corto y largo de SMA, pendientes, posición de precio SIP, alineación de 15m/1h/1d, eventos de 41A y ruptura de mínimos anteriores. Se estudian confusiones BAJISTA→BAJISTA, BAJISTA→LATERAL y BAJISTA→ALCISTA, precisión y recall BAJISTA, probabilidad BAJISTA media y Macro F1. Cada grupo informa observaciones, sesiones y clases reales. Se marca `INSUFFICIENT_EVIDENCE` con menos de 30 BAJISTA reales o menos de 30 sesiones.

El bootstrap remuestrea sesiones completas con semilla fija. Sus intervalos no necesariamente cubren dependencia entre jornadas ni cambios prolongados de régimen. Las muchas comparaciones descriptivas pueden producir asociaciones accidentales. No se selecciona retrospectivamente un umbral o combinación ganadora.

## Ejecución local en Windows

Desde la raíz del repositorio, con el histórico privado y el entorno Python 3.12 ya instalado:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase41b.bear_audit `
  --sip-csv trading_poc_001_bollinger\data\NVDA_ALPACA_SIP_15min_20211017_20261017.csv `
  --history private\iex-history\nvda-2024-2026-phase38e `
  --run private\ml-iex\phase38e-20261023-v1 `
  --out private\ml-iex\phase41b-sip-investep-v1
```

`--out` debe ser un directorio privado **nuevo**; el comando no sobrescribe los artefactos originales. Produce `manifest.json`, `coverage-audit.json`, `bear-regime-audit.json`, `report.json`, `report.md` y `SHA256SUMS`, además de `queries.json` y `contexts.json` para auditoría reproducible. Todos quedan excluidos de Git. Los hashes del manifiesto registran entradas, código y salidas. Un hash correcto verifica integridad de archivos locales, no la autenticidad independiente del proveedor.

Para repetir solo el análisis de grupos sin reconstruir el índice se puede usar `--contexts-from <ruta privada a contexts.json>`. El comando comprueba SHA-256 tanto de los cuatro archivos SIP como del código TypeScript que generó ese índice; si cambia alguno, exige reconstruirlo.

Pruebas sintéticas sin credenciales ni descargas: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` y `.\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase41b.test_bear_audit`. La CI Windows ejecuta Vitest y Python 3.12 con ruedas precompiladas.

## Alcance de las conclusiones

El reporte privado distingue verificaciones de integridad (`VERIFIED`), asociaciones descriptivas (`EXPLORATORY_ASSOCIATION`), grupos pequeños (`INSUFFICIENT_EVIDENCE`) y cobertura ausente (`UNAVAILABLE`). El período compartido y sus recuentos se obtienen del reporte local; no se publican datos históricos privados. Un patrón presente en un fold y ausente en otros se considera inestable. La siguiente hipótesis solo podría evaluarse con un protocolo posterior congelado y datos no utilizados para escogerla.

## Auditoría local verificada (24 de octubre de 2026)

Se ejecutó el pipeline con los archivos locales indicados y el resultado final quedó en `private/ml-iex/phase41b-sip-investep-v9/`. Sus `SHA256SUMS` originales se verificaron; se detectó deriva de hash en dos capturas de código de 38E, que queda registrada en el manifiesto y no altera las predicciones verificadas. El período compartido de predicciones y contexto SIP va de **2025-06-25 13:30 UTC a 2026-10-16 19:30 UTC** para `delayed`. El histórico IEX continúa después del cierre del archivo SIP, por lo que esas filas quedan fuera de cobertura.

| Escenario | Retraso SIP | IEX evaluables originales | Contexto SIP completo y evaluable | BAJISTA utilizables | BAJISTA→LATERAL utilizables |
|---|---:|---:|---:|---:|---:|
| delayed | 15 min | 6.219 | 6.158 | 1.687 | 1.410 |
| delayed | 20 min | 6.219 | 6.158 | 1.687 | 1.410 |
| delayed | 30 min | 6.219 | 6.158 | 1.687 | 1.410 |
| ideal | 15/20/30 min | 6.536 | 6.472 | 1.834 | 1.481 |

En `delayed`, la confusión original conserva sus **1.705 BAJISTA reales, 61 aciertos BAJISTA, 1.425 BAJISTA→LATERAL y 219 BAJISTA→ALCISTA**. De las 61 observaciones evaluables sin contexto completo, 18 son BAJISTA; el resto son 31 LATERAL y 12 ALCISTA. Esta exclusión es pequeña, pero su distribución debe considerarse al comparar grupos. La cobertura completa de las tres temporalidades equivale a 6.158/6.219 observaciones evaluables; 84 de las 8.187 consultas `delayed` quedan fuera del rango SIP, incluidas consultas sin etiqueta evaluable. Los tres retrasos conservan el mismo total comparable, aunque algunas estructuras locales cambian entre 15 y 30 minutos.

En `delayed` con SIP +15 minutos, el orden bajista corto de 15m aparece en 2.903 observaciones, con 802 BAJISTA reales y 689 confusiones con LATERAL. Dentro de ese mismo orden, una SMA20 descendente aparece en 2.171 observaciones (590 BAJISTA; 527 confundidos con LATERAL) y una SMA20 ascendente en 732 (212 BAJISTA; 162 confundidos). **Pendiente y orden no son la misma propiedad**, pero estas diferencias no prueban una mejora ni permiten escoger una regla: el recall cambia considerablemente entre folds.

El patrón amplio de **diario alcista y 15m bajista, con 1h alcista o mixto** aparece en 717 observaciones, 192 BAJISTA reales y 163 BAJISTA→LATERAL, repartidas en 60 sesiones. El estado más estricto `SHORT_TERM_PULLBACK` de Fase 41A cubre solo 89 observaciones y nueve sesiones; es insuficiente para concluir. No apareció el estado de continuación bajista estricta simultánea en las tres temporalidades. El caso diario alcista/1h bajista/15m bajista cubre 168 observaciones y 15 sesiones; también es insuficiente.

Una ruptura por debajo del mínimo de las 20 sesiones previas aparece en 142 observaciones, 35 BAJISTA reales y 32 errores BAJISTA→LATERAL, pero solo en 16 sesiones. La distancia SIP al mínimo de la sesión anterior tiene mediana de **1,50 %** entre los 1.410 BAJISTA→LATERAL analizables, frente a **2,38 %** entre los 61 BAJISTA acertados. Es una asociación exploratoria con grupos desiguales, múltiples comparaciones y ninguna garantía predictiva. Los eventos de ruptura y retesteo de SMA se detallan por tipo y estado en el JSON; una ausencia de eventos en un subgrupo tampoco acredita ausencia de estructura bajista.

| Fold `delayed`, +15 min | Observaciones comparables | BAJISTA reales | BAJISTA→LATERAL | Recall BAJISTA |
|---|---:|---:|---:|---:|
| 1 | 2.243 | 591 | 460 | 2,03 % |
| 2 | 2.432 | 673 | 611 | 3,27 % |
| 3 | 1.483 | 423 | 339 | 6,38 % |

En el grupo amplio de retroceso bajista dentro de diario alcista, el recall por fold fue **0 %, 3,23 % y 10,42 %**. Esta variación impide tratar la asociación como estable. Los intervalos de bootstrap están en `bear-regime-audit.json`, agrupados por sesión; no corrigen selección múltiple ni dependencia entre sesiones. La hipótesis razonable para un trabajo posterior sería **congelar un contraste entre orden corto y pendiente SMA20 dentro de la misma población causal**, y evaluarlo con datos temporalmente nuevos. Esta fase no incorpora esas variables al modelo ni afirma que mejoren su rendimiento.
