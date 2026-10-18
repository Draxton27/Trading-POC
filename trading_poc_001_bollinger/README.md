# Trading POC 001: ¿qué pasa después de una compresión de Bollinger?

Este es **el primer experimento técnico** de nuestro proyecto. No es un robot de trading ni recomienda comprar CALL o PUT.

## ¿Qué hace?

1. Lee un archivo de velas (precio inicial, máximo, mínimo, final y volumen) de 5 minutos.
2. Calcula las bandas de Bollinger y la separación entre ellas.
3. Busca momentos en que las bandas estaban muy juntas y empiezan a separarse mientras el precio sale por arriba o abajo de ellas.
4. Mide si el precio continuó en esa dirección **15, 30 o 60 minutos después**.
5. Muestra qué ocurrió en una parte inicial y otra posterior de los datos.

**No calcula ganancias de opciones**. Que QQQ suba no significa que un CALL específico gane dinero.

## Cómo ejecutarlo

Requisito: **Node.js 22.16+**. La demostración no necesita paquetes de terceros ni claves de API; las pruebas de comparación sí requieren `npm ci`.

En una terminal, dentro de la carpeta del proyecto:

```bash
npm run demo
```

Esto crea un archivo con **7,800 velas de demostración inventadas** y ejecuta el análisis. Sus resultados son **100% ficticios y NO deben utilizarse para operar**.

El CSV de demostración lleva un archivo contiguo `data/QQQ_FICTICIO_5min.csv.meta.json` con su procedencia. El programa identifica los datos ficticios por ese metadato, nunca por el nombre del archivo.

Se generan estos archivos:

- `output/report.md`: resumen legible y estadísticas.
- `output/report.json`: resultados para una futura interfaz.
- `output/signals.csv`: inicio y fin de cada vela con señal, y momento en que la señal estuvo disponible.

Para utilizar tus propios datos:

```bash
npm run analyze -- data/QQQ_REAL_5min.csv
```

Los análisis con metadatos `data_class: "real"` guardan `report.md`, `report.json` y `signals.csv` en `output/real/`, excluida de Git. La elección se hace por los metadatos validados, no por el nombre del CSV. Los datos `synthetic` y `npm run demo` siguen usando los archivos versionados de `output/`. Así, analizar QQQ real no reemplaza los resultados ficticios de la demostración.

Tu archivo debe tener exactamente las columnas `timestamp,open,high,low,close,volume` (se permite otro orden de columnas). `timestamp` identifica **el inicio de la vela**, exige fecha y zona horaria explícita en ISO 8601 (`Z` u offset) y se normaliza a UTC. Cada inicio debe coincidir con un límite UTC de cinco minutos. Ejemplo:

```csv
timestamp,open,high,low,close,volume
2026-06-01T13:30:00.000Z,600.00,600.25,599.80,600.15,12000
2026-06-01T13:35:00.000Z,600.15,600.30,599.99,600.23,14000
```

Junto al CSV crea `data/QQQ_REAL_5min.csv.meta.json`:

```json
{
  "asset": "QQQ",
  "provider": "nombre del proveedor de los datos",
  "bar_minutes": 5,
  "data_class": "real",
  "session": "regular",
  "exchange_timezone": "America/New_York"
}
```

`data_class` es `synthetic` o `real`, según la declaración del usuario; el programa no verifica que los datos declarados reales provengan del mercado. `session` es `regular` o `extended`. La temporalidad admitida en esta fase es de cinco minutos para acciones estadounidenses cotizadas en horario de Nueva York.

`analyze` y los estudios históricos de QQQ rechazan metadatos de 15 minutos: sus señales y horizontes están definidos para velas de 5 minutos.

Se requieren al menos 300 velas y muchas más para intentar estimaciones de utilidad práctica. Para datos reales, revisa ajustes por splits, procedencia, cobertura, calidad y derechos de uso.

## Tiempo de las velas y disponibilidad de señales

Una vela iniciada a las `13:30:00Z` cubre el intervalo **13:30–13:35 UTC**. Su cierre, y cualquier señal que dependa de él, solo se conocen **a partir de las 13:35:00Z**. En `signals.csv`, `bar_start_utc` es el timestamp original normalizado, `bar_end_utc` es el final de la vela y `available_at_utc` es el primer instante en que puede conocerse la señal. En este POC los últimos dos coinciden. Estos campos no representan hora ni precio de una operación. El rendimiento histórico sigue usando el cierre de la vela de señal como referencia estadística, sin afirmar que se pudiera ejecutar una operación a ese precio.

## Sesiones y huecos de datos

- Horario regular: inicio de barras desde **09:30 hasta 15:55**, hora `America/New_York` (la última termina a las 16:00).
- Horario extendido: inicio de barras desde **04:00 hasta 19:55**, hora `America/New_York` (la última termina a las 20:00). Declarar `extended` permite ese horario, pero no garantiza que el archivo contenga todas sus barras.
- La conversión de UTC a `America/New_York` tiene en cuenta el horario de verano. No debe suponerse una hora UTC fija para la apertura durante todo el año.
- Se rechazan timestamps repetidos o desordenados y huecos de más de cinco minutos **entre barras del mismo día local**. Se admiten intervalos entre días, incluidos cierres normales, fines de semana, festivos y días de cierre temprano. El archivo puede cubrir solo parte de una sesión. El lector CSV general no incorpora un calendario bursátil oficial y no detecta días completos ausentes ni certifica cierres tempranos; la importación ampliada de Alpaca sí aplica el calendario del proveedor, como se explica más abajo.
- Las bandas y el historial de compresión utilizan las últimas barras presentes aunque crucen sesiones; no se reinician cada mañana. La evaluación de movimientos futuros sigue exigiendo barras consecutivas. No se modificaron las reglas de señales ni los cálculos de rendimiento en esta fase.

El CSV se rechaza si faltan campos, hay fechas imposibles o sin zona, precios no positivos, OHLC incoherente, volumen negativo o fuera del rango de enteros seguros de JavaScript, o valores no finitos. Se admite volumen cero. Si existe una suspensión o un intervalo intradía sin barras, hay que resolverlo en los datos antes de analizarlos; no se rellenan precios automáticamente.

Pruebas automáticas (tras `npm ci`, comprueban tipos y comparan con `trading-signals@8.3.0`):

```bash
npm test
```

## Importar QQQ histórico de Alpaca (fase 3)

El importador solicita aproximadamente **90 días** de velas de QQQ a la API de datos de Alpaca. Usa `timeframe=5Min`, `feed=sip`, `adjustment=split` y solo conserva los inicios de vela del horario regular de Nueva York. El extremo final solicitado es el inicio de una vela que **terminó al menos 20 minutos antes** de ejecutar la importación. Ese margen supera los 15 minutos de retraso exigidos para SIP histórico en el plan Basic. Nunca solicita el precio actual ni hace operaciones.

Puede guardar las credenciales en un archivo `.env` dentro de `trading_poc_001_bollinger`, junto a `package.json` (está excluido de Git):

```dotenv
APCA_API_KEY_ID=su-clave
APCA_API_SECRET_KEY=su-secreto
```

Desde esa carpeta, ejecute `npm run import:alpaca`. El comando carga `.env` si existe; las variables ya definidas en la terminal tienen prioridad. También puede configurar las credenciales solo en la terminal, sin archivo. En PowerShell:

```powershell
$env:APCA_API_KEY_ID = 'su-clave'
$env:APCA_API_SECRET_KEY = 'su-secreto'
npm run import:alpaca
```

En Bash:

```bash
export APCA_API_KEY_ID='su-clave'
export APCA_API_SECRET_KEY='su-secreto'
npm run import:alpaca
```

El resultado se guarda en `data/QQQ_ALPACA_SIP_5min.csv` y su archivo contiguo `.meta.json`; ambos se excluyen de Git. Los metadatos declaran `asset=QQQ`, `provider=Alpaca Market Data API`, `data_class=real`, `bar_minutes=5`, `session=regular`, `exchange_timezone=America/New_York`, `feed=sip` y `adjustment=split`. Son declaraciones de procedencia de la importación, no una auditoría independiente del proveedor. Para analizarlo:

```bash
npm run analyze -- data/QQQ_ALPACA_SIP_5min.csv
```

Este comando genera los informes reales en `output/real/`; el CSV importado y los informes reales permanecen locales y excluidos de Git.

Alpaca pagina sus respuestas; el importador recorre todas las páginas, limita las solicitudes a un máximo nominal de 120 por minuto, reintenta temporalmente `429` y errores de servidor, y detiene la importación ante `401` o `403` (credenciales o permiso de datos). No cambia automáticamente a IEX. Si el plan de la cuenta no permite la consulta SIP histórica solicitada, se informa el error de acceso. Según la [documentación de Alpaca sobre planes de datos](https://docs.alpaca.markets/us/docs/about-market-data-api) y su [FAQ de datos de mercado](https://docs.alpaca.markets/us/docs/market-data-faq), Basic tiene límite de 200 solicitudes por minuto y acceso SIP histórico con retraso de al menos 15 minutos; la disponibilidad efectiva depende de la cuenta y sus permisos.

Cada `timestamp` del CSV es el **inicio UTC** de la vela. La selección de 09:30 a 15:55 se calcula en `America/New_York`, por lo que cambia automáticamente entre EST y EDT. La API puede no devolver barras en días festivos, cierres anticipados o intervalos sin operaciones. El importador no crea barras para suplirlas; acepta saltos entre fechas locales, pero el contrato actual **rechaza huecos entre barras del mismo día** y deja sin archivo nuevo esa descarga. No hay un calendario bursátil oficial en el POC: no certifica días completos ausentes ni que un cierre temprano sea legítimo. Tampoco verifica revisiones tardías de datos del proveedor. El ajuste por split altera precios y volumen de acuerdo con el proveedor, por lo que no debe mezclarse esta serie con otra sin el mismo ajuste.

Las pruebas de Alpaca usan solo respuestas simuladas y no requieren credenciales. En este repositorio no se publica un conjunto real de QQQ; ejecute la importación con su propia cuenta y respete las condiciones de uso de datos del proveedor. Las reglas de señales, los umbrales de Bollinger y las estadísticas del POC siguen iguales.

## Validación estadística histórica de la estrategia (fase 4)

El importador mantiene **90 días por defecto**. Para pedir 12 meses de calendario y conservar el CSV anterior:

```bash
npm run import:alpaca -- --months 12
npm run validate:strategy -- data/QQQ_ALPACA_SIP_5min_12m.csv
```

También se puede validar el archivo de 90 días con `npm run validate:strategy -- data/QQQ_ALPACA_SIP_5min.csv`. Los resultados se guardan en `output/real/strategy-validation.md` y `.json`, excluidos de Git. El comando exige metadatos de QQQ real, Alpaca, SIP, ajuste por split y sesión regular; no clasifica un CSV ficticio como real por el nombre del archivo.

Para la descarga ampliada, el importador consulta además el [calendario bursátil de Alpaca](https://docs.alpaca.markets/us/reference/legacycalendar) y conserva solo barras dentro de la apertura y el cierre de cada fecha, incluidos cierres anticipados. La descarga de 12 meses encontró barras posteriores al cierre de las 13:00 ET del 24 de diciembre de 2025; el calendario las excluyó, de acuerdo con el [calendario de NYSE](https://www.nyse.com/trade/hours-calendars). No se rellenan intervalos ni se descartan huecos intradía válidos en silencio: la validación de CSV sigue rechazándolos. Este filtro de calendario no cambia la importación predeterminada de 90 días. El plan Basic permite datos históricos desde 2016, con SIP retrasado al menos 15 minutos y 200 solicitudes por minuto según [Alpaca](https://docs.alpaca.markets/us/docs/about-market-data-api); la disponibilidad depende de la cuenta.

El reporte nuevo reutiliza **sin cambios** las reglas de detección Bollinger. Cada señal se conoce al final de su vela y la entrada hipotética usa la **apertura de la siguiente vela contigua**. La salida usa el cierre de las velas 3, 6 y 12 posteriores: 15, 30 y 60 minutos desde que la señal estuvo disponible. No se presume que esa apertura pueda ejecutarse. Se excluyen señales sin siguiente vela válida u horizonte continuo. Para señales bajistas se invierte el signo del movimiento de QQQ; no se calcula rendimiento de contratos PUT.

La referencia son velas **sin señal**, del mismo intervalo local de cinco minutos en Nueva York y del mismo segmento temporal. Se compara cada señal con el promedio de esas observaciones; las referencias pueden reutilizarse. Se informan frecuencia favorable, ganancia media de los movimientos favorables, pérdida media de los desfavorables, magnitud absoluta media y diferencia de movimiento medio frente a la referencia. Los datos se dividen aproximadamente 70/30 en orden cronológico, comenzando la evaluación en una nueva sesión. No se optimizan los parámetros con el período posterior.

Las comparaciones con menos de 30 señales o menos de 10 días distintos se marcan como muestras pequeñas. Para las demás, el intervalo aproximado remuestrea días de señales 2.000 veces y usa 99,17% por comparación para seis combinaciones. El intervalo condiciona la referencia observada y no elimina la dependencia entre sesiones o señales. Tampoco incluye spreads, comisiones, deslizamiento, liquidez ni precios de opciones. Las frecuencias históricas **no son probabilidades garantizadas**.

## Investigación del filtro EMA 9 (fase 5)

Con el CSV real de 12 meses ya importado:

```bash
npm run validate:ema9 -- data/QQQ_ALPACA_SIP_5min_12m.csv
```

El informe en español se crea en `output/real/ema9-filter-validation.md` y `.json`, ambos excluidos de Git. El comando solo acepta metadatos de QQQ real de Alpaca SIP, con ajuste por split y sesión regular; no ejecuta operaciones.

La EMA 9 usa los cierres de velas de cinco minutos. Los primeros ocho valores no están disponibles; el noveno es la media simple de los primeros nueve cierres. Después se calcula `EMA_actual = EMA_anterior + 0,2 × (cierre_actual − EMA_anterior)`. Continúa entre sesiones, como las bandas de Bollinger de este POC. El único filtro estudiado conserva una señal Bollinger alcista si `EMA_actual > EMA_anterior` y una bajista si `EMA_actual < EMA_anterior`. Una igualdad descarta la señal. Ambas EMA se conocen al cierre de la vela que genera la señal; no se consulta una vela futura para decidir.

Se muestran **Bollinger original**, **Bollinger con EMA 9** y las **señales descartadas**. Todos conservan la regla original y el descanso de 12 velas entre señales; el filtro se aplica después de detectarlas. La comparación usa la misma división cronológica, apertura de la siguiente vela como entrada hipotética, horizontes de 15/30/60 minutos y referencias de velas sin señal Bollinger en el mismo horario local de Nueva York. También se informa el cambio del grupo filtrado frente al original con intervalos aproximados por remuestreo de días cuando hay al menos 30 señales retenidas y 10 días distintos.

En la ejecución local con las 19.506 velas QQQ de octubre de 2025 a octubre de 2026, el filtro conservó **293 de 293 señales**. Por tanto, los grupos original y filtrado tuvieron idénticos resultados: **EMA 9 no mejoró este historial**. El grupo descartado quedó vacío. No debe interpretarse un intervalo de diferencia 0 a 0 como prueba estadística; es una identidad entre muestras. La investigación de EMA se realizó después de examinar la Fase 4 sobre los mismos datos, de modo que los intervalos ajustados para seis direcciones y horizontes no corrigen por completo la selección secuencial de hipótesis. Se necesitan datos posteriores nuevos. Los movimientos de QQQ no son ganancias de opciones ni precios de ejecución garantizados.

## Investigación del filtro de volumen (fase 6)

Con el CSV real local de 12 meses:

```bash
npm run validate:volume -- data/QQQ_ALPACA_SIP_5min_12m.csv
```

El comando exige metadatos de QQQ real, Alpaca SIP, ajuste por split y sesión regular. Escribe `output/real/volume-filter-validation.md` y `.json`, excluidos de Git junto al CSV y las credenciales. No modifica el análisis EMA 9 ni las reglas de Bollinger.

Se prueba **una sola regla**, sin ajustar su umbral: el volumen de la vela que genera la señal debe ser **al menos 1,5 veces** el promedio del volumen de las velas del **mismo horario local de Nueva York** en las **20 sesiones observadas inmediatamente anteriores**. Todas esas sesiones deben tener una vela en ese horario. Si falta una, la señal se clasifica por separado como **sin historial suficiente**; no se busca una sesión más antigua ni se crea una vela. La sesión actual no entra en el promedio. La decisión solo queda disponible al cierre de la vela de señal, cuando se conoce su volumen. Los horarios se agrupan en `America/New_York`, incluidos los cambios de horario de verano. El POC no puede detectar una sesión completa ausente en el CSV.

El estudio muestra Bollinger original, **Bollinger con historial suficiente de volumen** (señales conservadas y descartadas por umbral), señales conservadas, descartadas y, para transparencia, señales sin historial suficiente. La comparación con historial enfrenta grupos con la misma cobertura de datos; también se conserva la comparación con todas las señales originales para observar el efecto conjunto de cobertura y filtro. Reutiliza el corte cronológico 70/30, controles sin señal Bollinger del mismo horario, apertura hipotética de la siguiente vela contigua y horizontes de 15, 30 y 60 minutos. Informa conteos, frecuencia favorable, movimientos medios, ganancias y pérdidas medias de QQQ, magnitudes y los intervalos exploratorios de Fase 4. Para ambos cambios del grupo filtrado se remuestrean días completos; con menos de 30 señales retenidas o 10 días distintos no se calcula intervalo. El 99,17% corresponde a seis comparaciones dentro de cada conjunto; los dos conjuntos no tienen corrección conjunta. Los casos sin siguiente vela u horizonte continuo se excluyen de las métricas, pero siguen en el conteo de señales.

En la ejecución local con **19.506 velas** de octubre de 2025 a octubre de 2026, Bollinger generó **293 señales**: **241** tenían historial suficiente, el filtro conservó **56 (19,1%)**, descartó **185 (63,1%)** y dejó **52 (17,7%)** sin historial suficiente. Las 52 señales sin historial están en el primer 70%; la comparación adicional entre las 241 señales clasificables y las 56 conservadas separa esa falta de cobertura. El resultado del grupo Bollinger original coincide exactamente con el de Fase 4. En el último 30% hubo solo **8 señales alcistas y 9 bajistas conservadas**; todas las comparaciones de 15, 30 y 60 minutos de ese tramo se marcan como muestras pequeñas. En ese tramo, el movimiento medio del grupo filtrado fue mayor que el de Bollinger con historial suficiente en **cuatro de las seis** combinaciones de dirección y horizonte, y menor en las otras dos. La comparación anterior con todo Bollinger original también da **cuatro de seis**, ya que allí no hubo señales sin historial. **No hay base para afirmar una mejora estadística.** Ese último tramo ya se examinó en fases anteriores, así que esta fase completa es exploratoria y requeriría datos posteriores nuevos para evaluar la hipótesis independientemente. Los movimientos de QQQ no equivalen a rentabilidad de contratos CALL o PUT ni garantizan precios de ejecución.

## NVDA: regreso a Bollinger desde la apertura (fase 7)

Esta investigación es **independiente del flujo QQQ de 5 minutos**. Descarga 12 meses de velas NVDA de **15 minutos** desde [Alpaca Historical Bars](https://docs.alpaca.markets/us/reference/stockbars), con `feed=sip` y `adjustment=split`, y consulta el [calendario de mercado](https://docs.alpaca.markets/us/v1.1/reference/getcalendar-1) para festivos y cierres anticipados. La consulta termina después de dejar cerrar la última vela y un margen adicional de 20 minutos para acceso SIP histórico sin tiempo real. Requiere `APCA_API_KEY_ID` y `APCA_API_SECRET_KEY` en `.env` local o el entorno:

```bash
npm run import:nvda
npm run validate:nvda
```

La importación deja `data/NVDA_ALPACA_SIP_15min_12m.csv`, sus metadatos y un calendario local junto al CSV. Los tres se ignoran en Git. El análisis crea `output/real/nvda-opening-reversion.md` y `.json`, también ignorados. El CSV usa inicio UTC de cada vela; el horario bursátil se interpreta en `America/New_York`, incluidos los cambios entre EST y EDT. No se fabrican velas. Si falta una vela necesaria para un horizonte, ese caso no entra en su denominador; una sesión incompleta no se etiqueta como «nunca regresó».

Al validar el estudio, cada vela de 15 minutos debe quedar íntegramente dentro del horario de su fecha en el calendario local, incluidos los cierres anticipados. Un CSV y un calendario incompatibles producen un error antes de calcular las bandas o RVOL; el lector CSV por sí solo no conoce esos cierres.

La banda de apertura usa la **SMA de los últimos 20 cierres antes de las 09:30** más o menos **dos desviaciones estándar poblacionales**, igual que el cálculo Bollinger local. Se congela antes de leer la primera vela de la sesión. Si `open > banda superior`, la apertura es «encima»; si `open < banda inferior`, es «debajo». Una igualdad no cuenta. Desde la **primera** vela de 15 minutos, el regreso por rango exige que el rango intersecte el interior congelado: `low < upper && high > lower`. La confirmación por cierre exige estrictamente `lower < close && close < upper`. Una vela que atraviesa ambas bandas y cierra fuera del lado contrario cuenta por rango, pero no por cierre. Tocar exactamente una banda sin entrar no cuenta, y volver a entrar no implica llegar a la SMA 20. Se observan 15, 30, 60, 120 minutos y la sesión completa. El tiempo del primer regreso se registra como el final de la primera vela en que ocurrió: es un límite superior del instante real, con hasta **15 minutos de imprecisión**, no el minuto exacto del cruce.

El subgrupo fijo de **volatilidad elevada** exige que el ancho de las bandas ya calculadas antes de abrir sea **al menos 4% de la SMA 20**. Se eligió antes de examinar el resultado y no se ajustó. Se informa por separado para aperturas encima y debajo. La división 70/30 sigue el orden de sesiones del calendario, sin usar el último tramo para escoger parámetros. Cada tasa tiene un intervalo Wilson 95% orientativo; los horizontes y subgrupos se solapan, y las sesiones pueden depender entre sí. Menos de 30 aperturas evaluables se marca como muestra pequeña.

En la ejecución local con **6.497 velas** hubo **251 sesiones de calendario**, **250 días evaluados** y **139 aperturas fuera de banda** (81 encima, 58 debajo). La primera fecha de la ventana se solicitó después de las 09:30 y no se evaluó como apertura; no es una sesión perdida del proveedor. En sesiones completas, el regreso por rango ocurrió en **52/81 (64,2%)** aperturas encima y **35/58 (60,3%)** debajo; por cierre se confirmó en **39/81 (48,1%)** y **29/58 (50,0%)**, respectivamente. Frente al criterio anterior de cierre por una sola banda, hubo **una confirmación menos por encima y una menos por debajo**; las tasas por rango no cambiaron. **29** aperturas encima y **23** debajo nunca regresaron durante su sesión. El tiempo medio hasta la primera vela que mostró regreso fue de **61,7** y **57,9 minutos**; la distancia inicial media a la banda fue **0,86%** y **0,96%**. Solo **2 aperturas** cumplieron el criterio de volatilidad elevada, por lo que ese subgrupo no permite concluir nada. Las tasas describen este historial, no probabilidades garantizadas, operaciones ejecutables ni ganancias de opciones.

## NVDA: volumen de 09:30–09:45 y regreso en la primera vela (fase 8)

Esta investigación conserva el importador, los cálculos de Bollinger y los resultados de Fase 7. Utiliza el **mismo CSV real NVDA de 15 minutos** y su calendario local. No requiere otra consulta a Alpaca:

```bash
npm run validate:nvda-volume
```

El comando genera localmente `output/real/nvda-opening-volume.md` y `output/real/nvda-opening-volume.json`, ambos ignorados por Git. El JSON incluye por día el volumen absoluto de la vela 09:30–09:45, el promedio de referencia, RVOL, el grupo descriptivo y los resultados de regreso por rango y por cierre. El Markdown muestra esos datos para las aperturas fuera de banda, además de tablas de frecuencia y tamaños de muestra.

La referencia usa la vela de **09:30–09:45 de las 20 sesiones observadas inmediatamente anteriores**, en horario `America/New_York`. No incluye la sesión actual; si alguna de las 20 carece de apertura, el RVOL queda sin dato y no se busca una sesión más antigua. RVOL es el volumen absoluto dividido entre ese promedio. Un promedio cero también deja RVOL sin dato. La clasificación de apertura fuera de las bandas congeladas es conocida a las **09:30**; el volumen final de la primera vela y su regreso por rango o cierre se conocen como máximo a las **09:45**. Por ello, el estudio de volumen es **retrospectivo** y no presenta RVOL como condición para actuar a las 09:30.

Para describir diferencias sin escoger un volumen mínimo, el reporte divide el RVOL en tres grupos según terciles calculados con su distribución en el primer 70% de sesiones con referencia; aplica las mismas fronteras al último 30%. Los terciles **no son filtros ni umbrales de entrada**. Se informan aperturas fuera de banda entre todos los días de cada grupo y, por separado, regreso durante los primeros 15 minutos para aperturas encima y debajo. Se mantienen los casos sin RVOL en el total, con sus causas de falta de referencia.

En la ejecución local con **6.497 velas**, hubo **250 aperturas evaluadas** y **230 con RVOL**. Las fronteras retrospectivas, calculadas con **154 días** del primer 70%, fueron **0,811** y **0,990**. En el historial completo, el tercil bajo tuvo **38/85 (44,7%)** aperturas fuera y el alto **51/79 (64,6%)**. Entre aperturas por encima, el regreso por rango en la primera vela ocurrió en **15/20** casos del tercil bajo y **12/33** del alto; entre aperturas por debajo, **9/18** y **4/18**. El último 30% tiene subgrupos de regreso pequeños; además, el resultado ocurre durante la misma vela cuyo volumen se mide. **Estas asociaciones no prueban causalidad, una ventaja estadística ni una oportunidad operable a las 09:30.** Los datos reales, credenciales y reportes permanecen fuera de Git.

## NVDA: señales de toda la sesión con Bollinger, EMA 9 y RVOL (fase 9)

Este estudio es independiente de los experimentos de **apertura** de las fases 7 y 8. Reutiliza las velas NVDA de 15 minutos, sus metadatos y el calendario local. No descarga datos ni consulta credenciales:

```bash
npm ci
npm run validate:nvda-indicators
```

El comando exige NVDA real, Alpaca SIP, ajuste por split y sesión regular. Produce `output/real/nvda-indicators-study.md`, `.json` y `output/real/nvda-indicators-signals.csv`, todos excluidos de Git. El CSV registra hora local y UTC, bandas, EMA, RVOL, estado de los filtros, disponibilidad de la señal y resultados o causas de exclusión a 15, 30 y 60 minutos. Si faltan los tres archivos locales `data/NVDA_ALPACA_SIP_15min_12m.csv` y sus archivos contiguos `.meta.json` y `.calendar.json`, no se pueden reproducir resultados reales; `npm test` sigue usando datos sintéticos.

Se conserva la regla original de compresión de Bollinger: SMA 20, dos desviaciones poblacionales, 100 velas de historial, cuantil inferior 20%, expansión superior a 5%, cierre estrictamente fuera de banda y separación de 12 velas. En NVDA 15m esas 12 velas equivalen a **tres horas** de negociación. Las bandas se recalculan al cierre de cada vela. La señal y los filtros solo están disponibles cuando termina esa vela. EMA 9 arranca con la SMA de nueve cierres y se actualiza con factor 0,2 entre sesiones; el filtro principal compara su pendiente actual con la anterior. La posición del cierre frente a EMA se conserva como dato descriptivo. RVOL divide el volumen de la vela de señal entre la media del **mismo intervalo de Nueva York** de las 20 sesiones observadas anteriores y exige `>= 1,5`. Sin las 20 observaciones, o con promedio cero, la señal queda sin historial de volumen.

Las cuatro configuraciones son A Bollinger, B Bollinger + EMA, C Bollinger + RVOL y D ambos filtros. Todas parten de las mismas señales; C y D se comparan con A restringido a señales con RVOL calculable. La entrada hipotética es la apertura de la siguiente vela consecutiva y la salida el cierre de la primera, segunda o cuarta vela posterior. Cada horizonte permanece dentro de la sesión del calendario, incluidos cierres anticipados; las faltas de velas se notifican. Las observaciones sin señal del mismo intervalo local y tramo temporal sirven como control descriptivo. El corte aproximado 70/30 usa sesiones completas. El último 30% de este archivo ya se examinó en fases previas y **no** constituye validación independiente.

La ejecución local con los archivos recibidos de octubre de 2025 a octubre de 2026 encontró **6.497 velas y 161 señales** (78 alcistas y 83 bajistas). EMA conservó las 161. RVOL clasificó 143 (18 sin historial suficiente), conservó 23 y descartó 120. La combinación EMA + RVOL conservó las mismas 23. En los 15 minutos posteriores hubo 12 alcistas y 6 bajistas con horizonte evaluable entre las conservadas por volumen; las comparaciones de ese filtro son muestras pequeñas. Los resultados completos de ambas direcciones, tres horizontes y cada tramo están en el informe generado. Esta asociación no demuestra ventaja estadística ni rentabilidad. Los movimientos firmados son del precio de NVDA, no de contratos de opciones.

El calendario adjunto declara una **reconstrucción XNYS**, verificada frente al CSV observado, y no un calendario original certificado por Alpaca. El estudio informa sesiones enteras faltantes o parciales y rechaza velas fuera del horario programado. Las 251 sesiones del intervalo están presentes; la primera es parcial (21 de 26 velas). El volumen final y la señal no pueden utilizarse antes de terminar la vela.

## NVDA: contexto SMA de una hora y un día (fase 10)

Este estudio conserva exactamente las señales Bollinger de Fase 9 y añade contexto descriptivo de SMA 20, 40, 100 y 200 en una hora y un día:

```bash
npm run validate:nvda-sma-context
```

Genera `output/real/nvda-sma-context.md`, `.json` y `nvda-sma-context-signals.csv`, excluidos de Git. El CSV conserva Bollinger, EMA 9 y RVOL de 15 minutos, además de los valores, valores anteriores, pendientes y posiciones de las ocho SMA, las marcas de disponibilidad y los resultados posteriores de 15, 30 y 60 minutos.

Las velas de una hora se anclan a las 09:30 de Nueva York. En una sesión normal se forman seis velas de 60 minutos y una vela final de 30 minutos, 15:30–16:00. La vela abreviada entra en las SMA si contiene sus dos velas de 15 minutos; los cierres anticipados siguen el mismo criterio según el calendario. Una vela abreviada programada se distingue de un intervalo incompleto por datos ausentes. Las velas diarias solo entran en las SMA cuando la sesión contiene todos sus intervalos esperados. No se presupone que esta agregación coincida con TC2000 sin contrastar la configuración de sus gráficos.

Para evitar información futura, una señal usa la última vela superior que terminó antes o exactamente al comenzar su vela de 15 minutos. Por ello, no usa la hora parcial ni el cierre diario de su propia sesión. Cada SMA es simple y requiere 20, 40, 100 o 200 cierres superiores completos; no se rellenan valores faltantes.

Con el archivo local actual se reconstruyeron **1.751 intervalos horarios**, 1.749 completos, y **251 sesiones diarias**, 250 completas. Se preservaron las **161 señales** de Fase 9 (78 alcistas y 83 bajistas). La SMA 200 diaria aparece por primera vez el 6 de agosto de 2026: solo 35 señales tienen disponibles las ocho SMA, todas en el último 30%. Por tanto, este archivo no permite una evaluación independiente de las condiciones que requieren SMA 200 diaria. El informe compara posición, pendiente, orden de medias y concordancia entre temporalidades con Bollinger sobre la misma cobertura. Son asociaciones exploratorias del precio de NVDA, no reglas de entrada ni rendimientos de opciones.

## Historial NVDA ampliado de Alpaca

El importador independiente `import:nvda-history` consulta velas de 15 minutos con `feed=sip`, `adjustment=split` y sesión regular. Acepta tres, cuatro o cinco años, o un rango explícito de fechas inclusivas:

```bash
npm run import:nvda-history -- --years 3
npm run import:nvda-history -- --start 2023-10-01 --end 2026-10-16
```

Requiere `APCA_API_KEY_ID` y `APCA_API_SECRET_KEY` configuradas como secretos del entorno de ejecución. Este comando no lee `.env` ni imprime credenciales. Verificar primero acceso a Alpaca y ejecutar `npm test` con respuestas simuladas antes de solicitar datos reales. El intervalo por años termina en el último día UTC completo; las fechas explícitas no pueden alcanzar velas demasiado recientes para SIP histórico.

El archivo nuevo se llama `data/NVDA_ALPACA_SIP_15min_<inicio>_<fin>.csv`. Sus archivos contiguos `.meta.json`, `.calendar.json` y `.provenance.json` declaran procedencia y cobertura, sin secretos. El CSV original de 12 meses queda intacto. Los fragmentos mensuales validados se guardan en un directorio `.csv.parts/`; repetir el mismo comando tras una interrupción reutiliza los fragmentos íntegros. Una consulta con archivo final existente se rechaza para evitar sobrescribir resultados. La paginación, el límite de peticiones, los reintentos y errores de autenticación siguen el importador Alpaca compartido. Una vela interior faltante, un duplicado o una vela fuera de calendario impide publicar el CSV final. Las sesiones enteras ausentes y las sesiones parciales se registran en la cobertura; no se inventan velas. El calendario nuevo procede del endpoint de calendario de Alpaca cuando esta importación se ejecuta, a diferencia del calendario reconstruido XNYS del archivo original de 12 meses.

Con ambos historiales locales presentes, el informe retrospectivo de cobertura SMA 200 diaria y señales Bollinger se genera así:

```bash
npm run compare:nvda-history -- data/NVDA_ALPACA_SIP_15min_<inicio>_<fin>.csv
```

Los informes quedan en `output/real/`. El informe separa señales previas, coincidentes y posteriores a la ventana de 12 meses. Esas fechas coincidentes ya se estudiaron y no constituyen validación independiente. El corte 70/30 del historial ampliado tampoco convierte en prospectivos resultados de fechas examinadas previamente. Para el informe completo de todas las SMA, `validate:nvda-sma-context` acepta el CSV ampliado como argumento.

## Fase 11: retrocesos y rupturas de NVDA

El protocolo previo al análisis está en [docs/phase11-research-protocol.md](../docs/phase11-research-protocol.md). Compara dos eventos distintos, siempre dentro del contexto de tendencia definido con el último cierre diario completo frente a SMA 20 y el último cierre horario completo frente a SMA 100. La estrategia A exige tocar y recuperar en una sola vela la SMA 20 horaria; la B exige cerrar fuera de Bollinger 20/2 tras un cierre anterior dentro de bandas. EMA 9, RVOL y compresión histórica se registran sin filtrar ninguno de los eventos.

Con el historial ampliado local, sus metadatos, calendario y procedencia en `data/`:

```bash
npm ci
npm run validate:nvda-pullback-breakout -- data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv
```

El comando no consulta Alpaca. Genera `output/real/nvda-pullback-breakout-study.md`, `.json` y `nvda-pullback-breakout-signals.csv`, ignorados por Git. La señal se conoce al cierre de la vela; los resultados usan una apertura hipotética de la siguiente vela y el cierre de la segunda vela posterior como horizonte principal. Se excluyen horizontes que crucen sesión o tengan barras ausentes. Las cuatro comparaciones principales son las dos estrategias por sentido alcista y bajista, con controles del mismo año y horario local y una corrección de Holm. Los horizontes de 15 y 60 minutos son secundarios.

Todos los resultados hasta octubre de 2026 son exploratorios. Una división 70/30 dentro de este archivo no constituye una validación prospectiva ni permite estimar rentabilidad de opciones.

## ¿Qué significan los resultados?

- **Señales válidas:** cuántas veces ocurrió la condición definida.
- **Movimiento favorable:** porcentaje de veces en que el precio terminó en la dirección observada después del tiempo indicado. Si el precio queda igual, no cuenta.
- **Cambio medio:** variación media del precio en esa dirección, no rendimiento de opciones.
- **IC 95%:** intervalo orientativo de incertidumbre. Puede subestimar el riesgo por la dependencia entre movimientos del mercado.
- **Base de mercado:** frecuencia de subidas o bajadas de todos los momentos válidos del mismo período, sin aplicar el filtro. Es una comparación exploratoria imperfecta.

Los parámetros de señales son hipótesis iniciales arbitrarias, no configuraciones optimizadas ni verificadas. Se evita usar precios futuros al detectar una señal, se restringen resultados a barras consecutivas dentro de sesión y se utiliza un descanso de 12 velas tras cada señal para reducir duplicaciones.

El generador de prueba omite fines de semana, pero no festivos bursátiles. Sus 100 días ficticios permanecen en horario de verano de Nueva York y usan una hora UTC fija para simplificar. **No es un calendario de mercado real**.

## Relación con la investigación de GitHub

La [validación documentada en RESEARCH.md](RESEARCH.md) compara nuestro cálculo con `trading-signals@8.3.0` vela por vela. En las 7.800 velas ficticias hubo igualdad numérica exacta de bandas y ancho donde ambos producen resultados. `trading-signals` está fijada como dependencia de **pruebas**; el análisis sigue usando el cálculo local. La biblioteca tiene un método propio de señales con otra regla, que no se utiliza aquí.

## Próximos pasos

1. Importar datos históricos auténticos de QQQ con una cuenta Alpaca autorizada y comparar su cobertura con los gráficos de TC2000.
2. Evaluar una eventual sustitución del cálculo local solo si aparece una necesidad concreta; la paridad de indicadores no valida por sí misma la estrategia.
3. Estudiar si la señal supera una referencia razonable en datos nuevos, con costos, falsos positivos y otras condiciones del mercado.
4. Solo más adelante estudiar el precio real de contratos CALL y PUT.

**Aviso:** uso educativo e investigación. No constituye asesoramiento financiero.
