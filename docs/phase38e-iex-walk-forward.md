# Fase 38E: primer Walk-Forward histórico con NVDA IEX

Este experimento utiliza exclusivamente barras NVDA IEX `1Min` con `adjustment=raw`, agregadas en intervalos **estrictos** de 15 minutos por Fase 38D. Las diez variables y el ATR se calculan con `calculatePhase23Features`, sobre velas cerradas y en el mismo orden de Fase 23. No se utiliza el modelo SIP congelado.

## Reproducción local en Windows

Desde la raíz, con las credenciales Alpaca locales en `.env.local` y Python 3.12 en `.venv\phase28-py312`:

```powershell
npm.cmd run iex:history -- --start 2024-06-10 --end 2026-10-23 --out private/iex-history/nvda-2024-2026-phase38e
npm.cmd run ml:iex:prepare -- --source private/iex-history/nvda-2024-2026-phase38e --out private/ml-iex/phase38e-20261023-v1
$env:PYTHON = (Resolve-Path .venv\phase28-py312\Scripts\python.exe).Path
npm.cmd run ml:iex:evaluate -- --run private/ml-iex/phase38e-20261023-v1
```

La carpeta de salida del dataset debe ser nueva en cada experimento. El preparador verifica los SHA-256 de todos los archivos declarados por Fase 38D, calendario, rango, proveedor, feed y ajuste. El resultado guarda `observations.json`, `manifest.json`, `predictions.csv`, modelos por fold, `report.json` y `SHA256SUMS`, todos privados. No se asigna una hora de recepción histórica a respuestas REST.

## Protocolo

Las decisiones simuladas ocurren al cierre de `t` o 20 minutos después. La apertura de referencia es la primera apertura programada estrictamente posterior a esa decisión; el desenlace exige cuatro velas completas de la misma sesión. Un hueco o cierre de mercado impide etiquetar esa observación. Las etiquetas solo se usan en entrenamiento una vez que su cierre es anterior al corte del fold. El bloque interno de early stopping también está en el pasado. Los hiperparámetros son los valores fijos del protocolo 38C; no se eligen con folds externos. Cada fold entrena un XGBoost experimental independiente y una regresión logística con escalado ajustado solo en su conjunto causal. Mayoritario, frecuencias y momentum usan las mismas observaciones evaluables; las métricas probabilísticas de los dos clasificadores deterministas se marcan como no comparables.

Política predefinida: mínimo 252 sesiones observadas antes de evaluar, bloques externos de 126 sesiones, semilla 7 y dos hilos de CPU. El programa informa insuficiencia cuando no puede formar folds o falta alguna clase. Las comparaciones entre escenarios IEX usan objetivos diferentes y no equivalen a una comparación pareada con el modelo SIP. El bootstrap remuestrea sesiones completas; se informa también sensibilidad por semanas y meses. Ninguno captura necesariamente dependencias de régimen más largas.

## Auditoría local del 23-10-2026

Para `[2024-06-10,2026-10-23)` UTC, Alpaca entregó 595 sesiones dentro del período, con 230.137 de 230.970 minutos esperados. Faltaron 833 minutos. Hubo 15.246 velas estrictas y 13.986 con variables disponibles. El dataset contiene 27.972 observaciones de dos escenarios; solo 11.106 ideales y 10.566 retrasadas tienen etiqueta completa. Se entrenaron tres folds en cada escenario, sobre 6.536 y 6.219 objetivos evaluables, respectivamente.

| Escenario | Macro F1 XGBoost | Macro F1 frecuencia | Balanced accuracy XGBoost | Log loss XGBoost | Recall BAJISTA XGBoost |
|---|---:|---:|---:|---:|---:|
| Cierre idealizado | 0,3072 | 0,2031 | 0,3692 | 1,0609 | 0,0598 |
| IEX con espera simulada de 20 minutos | 0,2877 | 0,2086 | 0,3565 | 1,0554 | 0,0358 |

La segunda fila utiliza **IEX** en ambas variables y desenlaces; los 20 minutos son una hipótesis de disponibilidad, no una recepción SIP medida. El recall BAJISTA fue bajo en ambos escenarios. El reporte privado contiene métricas por fold y clase, matrices de confusión, calibración descriptiva e intervalos por sesiones, semanas y meses. Estas cifras retrospectivas no establecen ventaja operativa.

El histórico comienza el día en que NVDA empezó a cotizar sobre la base ajustada por su split 10:1, según [NVIDIA Investor Relations](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2025/). La consulta autenticada a [Alpaca Corporate Actions](https://docs.alpaca.markets/us/v1.1/reference/corporateactions-1), para NVDA del 10-06-2024 al 22-10-2026 inclusive, respondió HTTP 200 sin página adicional: informó un `forward_split` con fecha de proceso 10-06-2024 y diez `cash_dividends`. El resumen, fecha real de consulta y hash SHA-256 de la respuesta están en `private/iex-history/nvda-2024-2026-phase38e/corporate-actions-audit.json` y en el directorio privado del experimento, registrado en su `SHA256SUMS`; no se publican. IEX permanece `raw`: no se concatenaron precios de antes del split ni se compararon precios con SIP `split`. Los dividendos no fueron convertidos en ajuste de precios. La mayor diferencia entre cierre de una sesión y apertura de la siguiente en el CSV estricto fue −14,21 % (05-08-2024); ese diagnóstico por precio no identifica por sí solo una acción corporativa. Un evento no informado por el proveedor o una revisión posterior sigue siendo una limitación de esta auditoría histórica.
