# Fase 14: protocolo previo de adquisición e integración de contexto de NVDA

Este protocolo se registra **antes de adquirir QQQ/SMH y antes de procesar los calendarios reales**. La Fase 14 solo crea y audita una base de observaciones; no evalúa ventajas, optimiza filtros ni cambia las señales, indicadores o resultados de las Fases 9–13. Todo el período 2021-10-17 a 2026-10-17 ya fue examinado parcialmente y no constituye validación prospectiva.

## Fuentes, identidad y permisos

- NVDA: archivo local `NVDA_ALPACA_SIP_15min_20211017_20261017.csv`, SHA-256 `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`, y sus metadatos, calendario y procedencia. No se vuelve a descargar si conserva su identidad y validez.
- QQQ y SMH: Alpaca Market Data API `/v2/stocks/bars`, `15Min`, `feed=sip`, `adjustment=split`, sesión regular, misma ventana UTC inclusiva de inicio de vela que NVDA. Solo se usan credenciales inyectadas por el entorno; jamás se registran en archivos, logs ni Git. El calendario bursátil es el archivo Alpaca contiguo al NVDA original, no una inferencia por día de semana. Se guardan los cuatro archivos CSV/metadatos/calendario/procedencia por símbolo, además de fragmentos mensuales reanudables; ningún archivo final válido se sobrescribe.
- Calendario económico: páginas y anuncios originales de Bureau of Labor Statistics para **CPI** y **Employment Situation**, y de Federal Reserve para comunicado, conferencia y actas **FOMC**. Se registran URL original, fecha de consulta, fecha real de publicación, zona horaria y hora solo si la fuente la verifica. La fecha del período económico nunca reemplaza la fecha de publicación.
- Resultados de NVIDIA: página de relaciones con inversores y comunicados originales de NVIDIA. Se distingue hora del comunicado de hora de conferencia. Otros anuncios corporativos se etiquetan por tipo; no se presumen resultados.
- Consenso y cifras originales son opcionales: solo fuentes con publicación anterior verificable, timestamp y condiciones de uso documentadas. No se sustituyen por revisiones actuales. Sin ambos valores y disponibilidad previa, sorpresa = `null` y se registra cobertura faltante.
- Antes de publicar contenido SIP o datos de terceros se verifican condiciones de redistribución. Si no hay permiso verificable, el archivo completo queda local/privado y la entrega pública se limita a derivados que no reproduzcan datos licenciados, con un método privado de reproducción y una limitación explícita. La existencia de un repositorio público no concede derecho a redistribuir.

## Tiempo, calendario, calidad y sincronización

- Cada timestamp ISO UTC señala el **inicio** de una vela de 15 minutos; los datos de esa vela están disponibles al cierre `inicio + 15 min`. La zona de presentación es `America/New_York`, respetando EST/EDT. Se genera exactamente una fila por intervalo programado desde apertura regular hasta cierre del calendario, incluidos cierres anticipados. No se crean filas premarket ni se desplaza una vela de un símbolo a otro.
- Cada símbolo se valida por OHLCV finito y coherente, volumen entero no negativo, timestamp alineado, orden estrictamente ascendente, calendario, rango y precisión numérica conservada. Una respuesta idéntica repetida en paginación se elimina y contabiliza; duplicados con contenido diferente, tokens repetidos o barras fuera del rango abortan el fragmento. Se consulta cada página, se limita la tasa y se reintentan 429/5xx; 401/403 detienen con error sin mostrar secretos. Fragmentos completos se validan por hash y parámetros antes de reanudar; los incompletos se vuelven a pedir.
- Ausencias de barras o sesiones se conservan como `null` y banderas de cobertura; jamás se rellenan con precios repetidos. La cobertura por símbolo se mide como barras válidas / barras programadas y por sesiones completas, parciales y ausentes. La cobertura sincronizada exige los tres OHLCV en el mismo intervalo. **Meta de calidad:** al menos 99 % de intervalos sincronizados; bajo ese valor, el paquete se publica como cobertura insuficiente y no se tratan los cálculos incompletos como completos. No se altera el umbral tras observar datos.
- `adjustment=split` se conserva exactamente; no se mezclan series sin ajuste ni se corrigen dividendos. Se registran splits conocidos y sus fuentes para auditoría; la comparación de cierres intersesión se interpreta sobre serie ajustada por split. Se conservan hashes de las cuatro entradas por símbolo y del código que produjo derivados.

## Variables observables, sin filtros de entrada

Para una fila `t` de un símbolo, todas las variables se conocen al **cierre** de esa vela y usan únicamente velas completas hasta `t`:

1. Retorno de vela = `100 × (close_t/open_t − 1)`.
2. Retorno de cuatro velas = `100 × (close_t/open_(t−3) − 1)` si las cuatro velas son consecutivas de la misma sesión.
3. Retorno desde apertura regular = `100 × (close_t/open_primera − 1)` si la primera vela de la sesión y todas las intermedias existen.
4. Volumen relativo por horario = `volume_t / mean(volume_mismo_horario_de_20_sesiones_programadas_previas_completas) − 1`; exige las 20 referencias válidas y promedio positivo. No se sustituyen horarios faltantes por sesiones más antiguas.
5. Distancia al cierre previo = `100 × (close_t/close_última_vela_de_sesión_programada_anterior_completa − 1)`. Si falta esa sesión completa, `null`.

Se calculan diferencias NVDA–QQQ y NVDA–SMH del retorno de vela y de cuatro velas **solo cuando ambas variables existen**. Concordancia de dirección se registra para los tres retornos de vela: `todos_alcistas`, `todos_bajistas`, `dos_alcistas`, `dos_bajistas`, `mixto_con_cero`, `todos_planos` o `insuficiente`; cero no se fuerza a alcista ni bajista. QQQ y SMH contienen exposición a NVDA; una correlación o diferencia simple no demuestra fuerza independiente ni causalidad.

## Disponibilidad temporal de eventos y señales

- Los eventos guardan identificador estable, categoría/subtipo, fecha/hora declarada, zona, UTC si es verificable, URL, estado (`verificado`, `fecha_sin_hora`, `no_verificado`), tiempo de disponibilidad y notas de cambio horario. Una noticia sin hora verificada sigue en el calendario, pero **no** entra en un emparejamiento causal por vela ni se le asignan minutos transcurridos.
- En una evaluación al cierre de `t`, un evento se considera conocido solo si su timestamp UTC es **estrictamente anterior** al cierre de la vela; igualdad exacta queda para la vela siguiente por ambigüedad de publicación. Para una evaluación al inicio de `t`, se exige publicación estrictamente anterior al inicio. Se informa tiempo transcurrido en minutos y se retienen todas las colisiones de eventos, no solo uno.
- Para cada sesión se distinguen eventos verificados anteriores a la apertura, intradía y resultados corporativos posteriores al cierre previo. Una publicación fuera de horario se asocia a la **siguiente sesión programada** con marca de origen; no se infiere reacción premarket a partir de velas regulares. Fecha sola no activa estas marcas.
- Se unen las señales originales de Fases 11 y 12 por su timestamp de inicio y la disponibilidad de cierre, y las etiquetas de régimen ya publicadas de Fase 13 por identificador/índice. Índices, direcciones, timestamps, exclusiones y resultados antiguos se comparan con los artefactos publicados y jamás se recalculan o reemplazan.

## Auditoría descriptiva predefinida

- Se cuentan intervalos programados, presentes por símbolo y sincronizados; sesiones completas/parciales/ausentes; huecos por símbolo, año y horario; duplicados exactos eliminados; eventos por categoría/año, horas verificadas, consensos verificables y días con colisiones.
- Retornos y rango `100 × (high−low)/open` se resumen mediante recuento, media, desviación estándar y percentiles 10/50/90 para sesiones con y sin eventos verificados. Las comparaciones se estratifican por año y bloque horario de 60 minutos desde 09:30, con bloque final abreviado; grupos de menos de 30 intervalos o 10 sesiones se marcan pequeños. No se usan pruebas de ventaja ni umbrales optimizados. Una diferencia descriptiva no se atribuye causalmente a noticias.
- El manifiesto consigna para cada fuente URL, institución, fecha de consulta, hash si se descargó, tipo de licencia/condición revisada y límites de verificación. Los reportes indican cobertura conseguida y faltante. No se cambian estas convenciones tras examinar retornos de mercado.
