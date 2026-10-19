# Fase 23: dataset retrospectivo NVDA para investigación

Esta fase construye datos para un posible clasificador futuro; no entrena un modelo, produce predicciones ni genera señales u órdenes. El histórico completo ya fue examinado en fases anteriores. Por tanto, 2025 y 2026 son **evaluación retrospectiva exploratoria**, no una muestra independiente del proyecto. Los límites de ±0,5 ATR son una hipótesis inicial fija, no parámetros optimizados ni una estrategia validada.

## Ejecutar localmente en Windows

Desde la raíz del repositorio, con Node 22.16 o posterior y dependencias instaladas:

```powershell
npm ci
npm run dataset:phase23 -w trading-poc-001-bollinger
```

Se necesitan el archivo `trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv` y sus archivos `.meta.json`, `.calendar.json` y `.provenance.json` en el mismo directorio. El comando solo lee archivos locales y no accede a Alpaca ni necesita credenciales. Rechaza datos sintéticos y procedencia declarada distinta de NVDA real, Alpaca SIP, split, 15 minutos y sesión regular.

Los resultados se guardan en `trading_poc_001_bollinger/output/real/phase23-ml-dataset/<versión>/`, ignorado por Git. Incluyen `dataset.csv`, `metadata.json` y `SHA256SUMS`. La versión identifica mediante SHA-256 los archivos fuente, las implementaciones usadas, la especificación y la versión de Node; el manifiesto identifica cada entrada, define las columnas y registra cobertura, exclusiones y distribución de etiquetas. Si ya existe esa versión, el comando se detiene sin sobrescribirla. Los hashes identifican archivos, pero no acreditan por sí solos la autenticidad de su origen.

## Contrato temporal y variables

`bar_start_utc` es el inicio de t; `observed_at_utc` y `available_at_utc` son el cierre de t y el límite teórico más temprano para disponer de sus datos completos. No se mide la latencia real del proveedor. Las únicas variables de entrada están identificadas con `role: feature` en `metadata.json`; etiquetas, precios posteriores, escala absoluta y marcas de auditoría tienen otros roles y no deben usarse como variables de un modelo.

- Retornos: `close[t]/close[t-k]-1`, con k=1 y 4.
- Distancias: `close[t]/EMA9[t]-1` y `close[t]/SMA20[t]-1`. EMA y Bollinger reutilizan las funciones existentes; SMA20 es la banda central.
- Posición Bollinger 20/2: `(close[t]-lower[t])/(upper[t]-lower[t])`. Si el ancho es cero, no se genera una fila.
- Volumen relativo: `volume[t] / promedio(volume[t-20..t-1])`; si el promedio es cero, no se genera una fila.
- Tamaño y cuerpo con signo: `(high-low)/open` y `(close-open)/open` de t. Las horas usan America/New_York y la sesión regular del calendario local.
- ATR14 de 15 minutos: media simple de los 14 últimos true ranges, incluido t, con `TR=max(high-low, |high-close anterior|, |low-close anterior|)`. Incluye el salto nocturno al existir continuidad de sesiones. La variable de entrada es `atr14_relative = ATR14/close[t]`; `label_atr14_price_units` conserva la escala de precio solo para auditar la etiqueta.

Las variables usan exclusivamente velas hasta t, sin normalización ajustada con estadísticas del futuro. El historial usa precios ajustados retrospectivamente por splits: las variables de precios y volumen son razones invariantes ante un factor uniforme de ajuste posterior, y se prueba esa propiedad con fixtures. Los precios absolutos ajustados de auditoría **no son variables de entrada**. Los archivos locales no garantizan que el proveedor no haya corregido históricamente los datos ni acreditan una captura point-in-time de cada vela.

La continuidad permite pasar de una sesión al inicio de la siguiente sesión programada si la primera termina en su cierre y la siguiente empieza en su apertura. Ante un hueco intradía, apertura o cierre ausente, o una sesión programada sin datos, se reinician los indicadores y requieren otra ventana completa. No se inventan velas. El calendario local es la referencia para festivos, cierres anticipados y DST; no permite demostrar que una fecha de sesión omitida del propio calendario fuese realmente festiva.

## Etiquetas, cortes y exclusiones

En el cierre de t se calcula ATR14(t). El resultado se conoce en el cierre de t+4: `cambio = close[t+4] - open[t+1]`, en la escala ajustada del archivo. Es `ALCISTA` si el cambio es estrictamente superior a `0,5 × ATR14(t)`, `BAJISTA` si es estrictamente inferior a `-0,5 × ATR14(t)` y `LATERAL` en los límites o entre ellos. La apertura de t+1 es una referencia de etiquetado, no una promesa de ejecución.

Las cuatro velas futuras deben ser consecutivas y pertenecer a la misma sesión programada; los cierres anticipados se respetan. Se rechazan fechas fuera de los períodos, ventanas incompletas, datos insuficientes y denominadores indefinidos. Para esta investigación se excluye retrospectivamente toda sesión con datos incompletos: esa selección usa información posterior para decidir la inclusión y puede causar sesgo; no es un filtro disponible en tiempo real. El manifiesto cuenta las exclusiones por un motivo principal, siguiendo el orden de comprobación del código.

El desarrollo contiene sesiones anteriores a 2025 y la evaluación exploratoria sesiones de 2025/2026. Cada sesión pertenece a una sola partición. Las etiquetas que cruzan la partición se purgan explícitamente; bajo la regla de ventanas dentro de la sesión no hay cruces posibles, así que el embargo de este corte es de cero sesiones. Cualquier validación cruzada posterior deberá diseñar su propia purga y embargo conforme a sus ventanas, y ajustar cualquier transformación solamente con datos de entrenamiento. El pipeline no entrena, selecciona variables ni calcula métricas del modelo.
