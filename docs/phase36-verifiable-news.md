# Fase 36: noticias verificables y Ollama local

## Fuentes y condiciones

La fuente predeterminada es el [RSS de política monetaria de la Reserva Federal](https://www.federalreserve.gov/feeds/feeds.htm), publicado para lectores RSS con enlaces, titulares y resúmenes. El feed usado es `https://www.federalreserve.gov/feeds/press_monetary.xml`. El adaptador acepta RSS 2.0 y Atom, pero solamente consulta URLs fijas con HTTPS y enlaces de artículo del dominio permitido.

El [RSS de comunicados de NVIDIA](https://nvidianews.nvidia.com/rss) está disponible como fuente optativa. [NVIDIA limita su servicio RSS a uso individual no comercial](https://www.nvidia.com/en-eu/about-nvidia/rss/). Solo habilítelo si ese límite aplica a su uso local, con `TRADING_POC_NEWS_NVIDIA_NONCOMMERCIAL=1` en `.env.local`. No se recopilan artículos completos mediante scraping; se conservan únicamente los campos entregados por el feed autorizado.

La arquitectura admite agregar proveedores fijos después de comprobar sus condiciones. No acepta URLs proporcionadas por consultas a la API o por textos de noticias. El feed monetario aporta contexto macroeconómico; la cobertura de NVIDIA, semiconductores, tecnología y QQQ depende de las fuentes autorizadas que se activen. No se presenta una cobertura exhaustiva del mercado.

## Configuración Windows

Desde la raíz del repositorio, configure `.env.local` (ignorado por Git). API y CLI resuelven exactamente el mismo directorio: `TRADING_POC_NEWS_DIR` tiene prioridad; si no se define, usan `TRADING_POC_PRIVATE_DIR/news`; y si tampoco existe, en Windows usan `%LOCALAPPDATA%\Trading-POC\news` (fuera de Windows, `private/news/` del repositorio). Ollama debe escuchar localmente en `127.0.0.1:11434`; el modelo es `llama3.2:3b` salvo que se configure `TRADING_POC_NEWS_OLLAMA_MODEL`. El timeout de clasificación predeterminado es 20 segundos y el `keep_alive` reutiliza `TRADING_POC_OLLAMA_KEEP_ALIVE`. Ninguna URL de Ollama se toma del contenido ni de la API.

La versión inicial del CLI pudo guardar en `private/news/` del repositorio mientras la API de Windows leía `%LOCALAPPDATA%\Trading-POC\news`. No se mueven ni borran registros: inspeccione ambas ubicaciones si ya usó esa versión. Para seguir leyendo una ubicación anterior, establezca `TRADING_POC_NEWS_DIR` en `.env.local` con esa carpeta antes de ejecutar CLI y API.

```powershell
npm.cmd run news:collect -- --once
npm.cmd run news:analyze -- --once
npm.cmd run dev:offline
```

La ingesta y el análisis son procesos separados de la API. Puede recopilar noticias aunque Ollama esté apagado. Cada fuente tiene un intervalo mínimo local de cinco minutos entre intentos; los errores quedan identificados sin guardar claves, cuerpos de respuesta ni conversaciones. Para consultar resultados: `GET /api/v1/news/status` y `GET /api/v1/news/items?offset=0&limit=25`, o la vista **Noticias**. La API no ofrece rutas de escritura para noticias y limita las páginas a 100 filas.

## Significado temporal e integridad

`publishedAtUtc` y `updatedAtUtc` son declaraciones del feed. `firstSeenAtUtc` es la primera vez que este proceso recibió y leyó la noticia; el sistema no infiere disponibilidad anterior aunque la publicación declarada sea antigua. Fechas ausentes, inválidas o posteriores a la recepción se marcan de forma explícita. Cada cambio de los campos conservados crea una revisión con su propia hora de recepción y SHA-256. Las revisiones anteriores permanecen en un JSONL privado con hashes encadenados; la clasificación apunta al hash de la revisión concreta que leyó.

Estos hashes permiten detectar cambios accidentales o modificaciones que no reconstruyan toda la cadena. El reloj y los archivos locales no constituyen un sello temporal independiente ni prueban que la fuente publicó exactamente a la hora declarada. Para investigaciones históricas se debe usar la primera recepción registrada, nunca solamente la publicación declarada.

Ollama recibe exclusivamente el titular y el resumen como datos no confiables, sin herramientas. Antes de clasificar, el proceso lee el digest del modelo instalado mediante [`/api/tags`](https://github.com/ollama/ollama/blob/main/docs/api.md); así distingue una actualización del modelo que conserva la etiqueta `llama3.2:3b`. La respuesta exige JSON validado por Zod, una cita textual presente en el contenido y una justificación idéntica a esa cita; se rechazan instrucciones incrustadas, activos sin mención textual y afirmaciones no respaldadas. Los nuevos registros guardan digest, versión del prompt, SHA-256 del esquema enviado, timeout, `keep_alive` y temperatura cero. Los registros piloto anteriores a estos campos siguen legibles sin modificar su hash. La clasificación no equivale a una predicción de precio. Si Ollama falla o no responde, la noticia queda disponible sin análisis. Una revisión y un digest de modelo ya clasificados no se procesan otra vez.

Los ledgers se ubican en `news.jsonl` y `analysis.jsonl`, con bloqueo exclusivo, lectura dentro del bloqueo e idempotencia entre procesos. El último estado de ingesta queda en `status.json`, el de Ollama en `status.json.analysis.json` y el control local de frecuencia en `status.json.poll.json`. Son estados de la última ejecución, no una prueba de conectividad actual. Una respuesta de feed se limita a 1 MiB, una respuesta de Ollama a 64 KiB, una página API a 100 filas y cada ledger a 64 MiB o 50.000 registros. Al alcanzar ese límite se detiene la lectura y escritura hasta planificar un archivo histórico verificable. Los archivos permanecen excluidos por `private/` o por el directorio privado configurado. No se conecta este contexto con las diez variables, las predicciones, IBKR, órdenes ni estrategias operativas.

## Verificación

Las pruebas automáticas usan feeds y respuestas Ollama simulados. Un intento de consulta fuera del sandbox falló por conectividad; una consulta HTTPS autorizada a la Reserva Federal el 21 de octubre de 2026 recibió 15 entradas y las guardó únicamente en `private/news-live-check/`. La primera ejecución real de Ollama rechazó 13 respuestas fuera de esquema; el esquema JSON explícito y las citas permitidas corrigieron esa incompatibilidad. La ejecución final clasificó las 15 entradas con el modelo local y validación Zod. Este resultado comprueba el flujo técnico en ese momento; no demuestra cobertura permanente, calidad semántica de las etiquetas ni capacidad predictiva. Los resultados se conservan fuera de Git.
