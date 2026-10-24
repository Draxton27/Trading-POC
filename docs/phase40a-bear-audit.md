# Fase 40A: auditoría retrospectiva BAJISTA

Esta fase lee el experimento privado de NVDA IEX de 38E. No entrena, recalibra ni cambia modelos, etiquetas o umbrales. El escenario **delayed** es principal; `ideal` se presenta aparte porque sus instantes de decisión y objetivos pueden diferir. Las predicciones son históricas fuera de muestra dentro de los folds de 38E, no capturas prospectivas.

## Reproducción en Windows

Desde la raíz del repositorio, con el entorno Python 3.12 ya instalado:

```powershell
.\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase40a.test_bear_audit
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase40a.bear_audit --run private\ml-iex\phase38e-20261023-v1 --out private\ml-iex\phase40a-bear-audit-v3
```

`--out` debe ser una carpeta nueva. El comando verifica `SHA256SUMS`, procedencia, formato temporal, etiquetas, probabilidades, variables, hashes de modelos y emparejamientos de predicción con observación. Nunca modifica el run 38E. Si el código actual difiere del snapshot consignado en el manifiesto histórico, registra los archivos divergentes y valida por separado el contrato de datos congelado; no atribuye el run al código actual. La integridad de hashes locales no demuestra la autenticidad del proveedor.

Genera `report.json`, `report.md` y `SHA256SUMS` privados. Los conteos se basan únicamente en las predicciones evaluables; los casos excluidos por cierre de mercado o barras futuras ausentes no se tratan como errores de clasificación. Las diez variables corresponden exactamente a Fase 23. Los precios de entrada, salida y ATR futuros se usan **solo** para auditar la etiqueta ya emitida. Se exige la regla original: ALCISTA si movimiento `> +0,5 × ATR`, BAJISTA si `< −0,5 × ATR`, LATERAL en los límites inclusivos.

La auditoría informa distribuciones por clase y fold, diferencias de medias estandarizadas, correlaciones, matrices de confusión, probabilidad BAJISTA segunda, márgenes BAJISTA frente a LATERAL, ejemplos erróneos con alta confianza, fronteras de etiqueta, hora local de Nueva York, segmento de sesión, mes, ATR y magnitud posterior. Esta última es diagnóstica y no una variable de decisión. Los intervalos remuestrean sesiones completas con semilla fija; no aseguran independencia entre días ni capturan necesariamente cambios de régimen prolongados. Un grupo con menos de 30 ejemplos BAJISTA o menos de 30 sesiones figura `INSUFFICIENT_EVIDENCE`.

## Resultado local del run 38E del 23-10-2026

Se verificaron 27.972 observaciones y 16.374 predicciones; 12.755 predicciones tenían etiqueta evaluable. En `delayed`, BAJISTA representó 1.705 de 6.219 casos (27,4 %), frente a 2.833 LATERAL (45,6 %) y 1.681 ALCISTA (27,0 %). De los 1.705 casos BAJISTA, el modelo acertó 61 (recall 3,58 %), clasificó 1.425 como LATERAL y 219 como ALCISTA. El intervalo descriptivo del 95 % para recall, remuestreando 333 sesiones, fue 2,67 % a 4,67 %. En `ideal`, el recall fue 111/1.855 (5,98 %); sus objetivos no son directamente pareables con `delayed`.

En los tres folds retrasados el recall BAJISTA fue 2,03 %, 3,27 % y 6,12 %. La probabilidad BAJISTA media de los casos realmente BAJISTA fue 0,2793 frente a 0,2730 en las otras clases, una separación pequeña. Los resultados de ROC-AUC/PR-AUC en Fase 38F apuntan a asociación débil, sin umbral validado. Varios contrastes de una sola variable fueron pequeños y variaron de posición entre folds; no se demuestra que falten variables concretas. En la mitad de ATR alto el recall fue 0,27 %, y en la mitad baja 6,08 %; es una asociación exploratoria. En la primera hora fue 7,91 % frente a 2,12 % en el segmento central. La última hora no tiene observaciones evaluables por el horizonte de cuatro velas, y aparece como evidencia insuficiente. Solo 216/1.705 BAJISTA (12,7 %) quedaron a 0,1 ATR o menos de la frontera −0,5 ATR; la cercanía de etiqueta no basta para explicar el bajo recall. Los modelos originales dan mayor `gain` a la hora desde apertura en los tres folds, pero eso no prueba causalidad.

El snapshot de código del run no coincide con dos archivos actuales: `phase38e-cli.ts` y `ml/phase38e/replay.py`. El informe conserva esta discrepancia explícita y vuelve a comprobar hashes de todos los artefactos, procedencia y reglas temporales del dataset congelado. No se modificó ni reescribió el experimento original.

ROC-AUC, PR-AUC, calibración y barridos de umbral ya se encuentran en [Fase 38F](phase38f-iex-probability.md); esta fase no elige umbrales retrospectivamente. La importancia `gain` de los modelos existentes es descriptiva y no causal. El histórico fue examinado previamente, por lo que ninguna asociación aquí constituye validación independiente o recomendación de CALL/PUT.

## Hipótesis y Fase 40B

El reporte responde nueve preguntas sobre prevalencia BAJISTA, separación de variables, confusión con LATERAL, información en probabilidades, horarios, fronteras, folds, información faltante y siguiente hipótesis. Distingue evidencia medida, explicaciones parciales y cuestiones no comprobadas. El [protocolo propuesto para Fase 40B](phase40b-xgboost-lightgbm-protocol.md) compara XGBoost y LightGBM con **las mismas filas IEX, folds cronológicos, etiquetas, disponibilidad simulada, purga por desenlace conocido y baselines**. Se debe fijar el protocolo antes de mirar los resultados, mantener los escenarios separados y comparar sobre observaciones idénticas con incertidumbre agrupada por sesión. Una eventual mejora retrospectiva tampoco sería evidencia prospectiva independiente. LightGBM no se instala ni ejecuta en este PR.
