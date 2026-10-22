# Fase 37: protocolo de valor predictivo incremental

La unidad de separación y de remuestreo es la sesión NYSE completa. Se ordenan las sesiones y se reservan las últimas 30 % para evaluación exploratoria posterior. Como el proyecto ya observó parte del histórico y el modelo se congeló antes de esta fase, ese tramo **no es una validación independiente**.

## Información que puede usar un comparador futuro

`availableNewsContext(row)` expone solo ID, hora de registro, probabilidades XGBoost originales, noticias cuya revisión y clasificación estaban disponibles en ese instante, cobertura y conteos por ventana. No expone clase real, evaluación ni conteos retrospectivos `auditLateReceived` y `auditLateClassified`. Un comparador futuro debe fijar su fórmula y cualquier calibración con sesiones de desarrollo, purgar horizontes solapados y evaluar los mismos IDs fuera de muestra. Esta fase no implementa ni entrena tal comparador.

`TRADING_POC_ML_NEWS_WINDOWS_MINUTES` permite tres ventanas enteras, ascendentes y no mayores de 1440 minutos; por defecto son `30,60,240`. Cambiar ventanas tras inspeccionar resultados constituye otra hipótesis y debe documentarse. La antigüedad se calcula desde la recepción de la revisión. Las noticias recibidas o clasificadas exactamente en el instante de registro son admisibles; las posteriores no. La clasificación puede estar pendiente, el proveedor puede haber fallado o no puede haber noticias. Ninguno de esos estados se convierte en sentimiento neutral.

## Estadística descriptiva

Para el baseline congelado se calculan accuracy, balanced accuracy, Macro F1, precision, recall y F1 por clase, log loss, Brier y calibración de cinco intervalos por clase. Se publican por sesiones y por grupos de sentimiento, relevancia, categoría, concordancia con la clase dominante y ventanas. Los grupos pueden superponerse. Los residuos medios por clase son frecuencia observada menos probabilidad original: una asociación con noticias puede sugerir una hipótesis, pero no demuestra información incremental.

El intervalo de diferencia descriptiva entre observaciones con y sin noticia remuestrea sesiones completas 500 veces, con semilla fija. Solo se calcula si hay al menos 30 observaciones evaluadas, 10 sesiones y 10 filas por grupo; si algún remuestreo pierde un grupo, se exige al menos 475 remuestreos válidos. `INSUFFICIENT_EVIDENCE` se muestra mientras la muestra posterior no permita ese cálculo. Incluso `DESCRIPTIVE_ONLY` no significa superioridad: faltaría comparar pronósticos alternativos sobre idénticas observaciones, con hipótesis predefinida y evaluación prospectiva independiente.

Los conteos `auditLateReceived` y `auditLateClassified` se calculan retrospectivamente para auditar exclusiones temporales; jamás son variables del comparador. El estado de proveedor procede del último estado local anterior al corte, que no es un historial completo de fallos: un estado ausente no prueba que el proveedor funcionó. Los hashes locales detectan alteraciones de archivos, pero no certifican por sí solos autenticidad externa. Ollama puede clasificar incorrectamente y la cobertura de fuentes es incompleta.
