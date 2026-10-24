# Protocolo propuesto para Fase 40B

**Estado:** especificación previa; no se entrena LightGBM en Fase 40A.

## Pregunta

Con las mismas diez variables y objetivos IEX de Fase 38E, ¿un segundo algoritmo de árboles mejora la identificación de BAJISTA fuera de muestra frente al XGBoost experimental de cada fold? El contraste examina sesgo inductivo del clasificador; no demuestra que una fuente de datos adicional sea útil ni capacidad operativa.

## Diseño fijo antes de ejecutar

1. Leer el mismo experimento 38E inmutable, verificar todos los SHA-256 y conservar `ideal` y `delayed` por separado. `delayed` será el escenario principal.
2. Reutilizar exactamente los folds cronológicos, las sesiones de prueba, etiquetas, diez variables, orden de columnas, disponibilidad simulada, purga por `label_available_at_utc` y filas evaluables de 38E. No permitir que una etiqueta conocida después del corte participe en entrenamiento o early stopping.
3. Entrenar LightGBM únicamente en filas anteriores al fold externo. Seleccionar árboles y cualquier configuración únicamente en un bloque interno anterior; fijar una búsqueda pequeña antes de ver las métricas externas. Reentrenar con todas las filas de desarrollo causalmente disponibles usando el número de árboles elegido. No ajustar después de mirar los folds externos.
4. Conservar XGBoost 38E y sus probabilidades congeladas como comparador. Evaluar LightGBM, XGBoost y baseline de frecuencias sobre **exactamente las mismas filas y desenlaces** de cada fold. No mezclar modelos SIP ni cambiar umbrales `argmax` retrospectivamente.
5. Informar por fold y agregado: matriz de confusión, recall y precision BAJISTA, Macro F1, balanced accuracy, log loss, Brier, PR-AUC/ROC-AUC uno contra resto y calibración descriptiva. Registrar prevalencia BAJISTA. Los baselines deterministas solo aportan métricas de clasificación.
6. Cuantificar diferencias pareadas con remuestreo de sesiones completas usando índices comunes, y sensibilidad por agrupación semanal/mensual. Marcar muestras pequeñas y dependencia temporal residual. No elegir un vencedor por una mejora marginal del mismo histórico previamente examinado.
7. Guardar modelos, predicciones, metadatos, semillas, versiones, exclusiones y hashes en una carpeta privada nueva. No sobrescribir Fase 38E ni los ledgers prospectivos. CI usará solo fixtures sintéticas; el run real permanecerá fuera de Git.

**Regla de interpretación:** una mejora retrospectiva sería una hipótesis para captura y evaluación futura independiente. No cambia señales, órdenes ni recomendaciones de opciones.
