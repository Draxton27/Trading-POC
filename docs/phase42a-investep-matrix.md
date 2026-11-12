# Fase 42A: matriz de investigación Investep

Esta fase es investigación descriptiva. No genera órdenes, recomendaciones operativas ni ganancias de opciones. El catálogo `42A-catalogo-1` resume el cuaderno PDF aportado por el usuario, que reúne fotografías y transcripciones reconstruidas; las referencias de páginas y figuras están en el catálogo. El PDF se mantiene local y no se publica en Git. Las afirmaciones atribuidas al material se separan de las aproximaciones de ingeniería de fases anteriores.

E1 y E2 requieren una directriz trazada sobre extremos, ruptura, SMA20 y cierre horario direccional, y tendencia plenamente alineada en 15 minutos. El cuaderno no especifica una regla matemática inequívoca para elegir extremos, trazar la línea, definir la ruptura o la tendencia completa. Por ello el piloto devuelve `NO_VERIFICABLE`: no sustituye la directriz por un cruce de SMA ni declara confirmación. E7 y E8 conservan el requisito visual de Worden Stochastics y volumen; no se sustituyen por RSI, otro estocástico ni RVOL. Los valores de lateralidad, salto y distancia de E5/E6 tampoco se inventan.

## Investigaciones anteriores

ABB y E5/E6 quedan **congeladas** por instrucción del usuario. No se seleccionan umbrales con las 262 sesiones ya examinadas. El comando registra hashes de los artefactos ABB que encuentre, sin sobrescribirlos ni copiarlos; el informe ABB v19 también identifica su conjunto y parámetros congelados. No se localizaron aquí los artefactos originales de resultados y parámetros de E5/E6: permanecen pendientes de localización, no se reconstruyen ni se presentan cifras inventadas. Los informes privados previos E2 y E3/E4 son aproximaciones, no reglas originales. El catálogo identifica este límite.

## Protocolo fijado

`PROTOCOL` en `phase42a-matrix.ts` define antes de la evaluación los horizontes de 15/30/60 minutos, controles por activo y horario, retornos del subyacente, MFE/MAE y remuestreo por sesiones. La separación 70/30 respeta sesiones completas; ambos tramos históricos son exploratorios porque el proyecto ya ha examinado estos períodos. Una evaluación prospectiva necesitará protocolo publicado de antemano, datos realmente recibidos antes de cada observación y ajustes disponibles en ese instante. La purga y el embargo se aplicarán a horizontes solapados cuando exista una regla verificable. No hay selección de parámetros por resultados de evaluación.

Un intervalo agrupado por sesión no garantiza independencia entre días o regímenes prolongados; se propone sensibilidad semanal o por régimen cuando haya datos suficientes. Se declaran muestras pequeñas por debajo de 30 observaciones o diez sesiones y se reconocen comparaciones múltiples entre activos, estrategias y horizontes. No hay intervalos ni métricas inventadas sin señales verificables. El desplazamiento del subyacente no es PnL CALL/PUT; profit factor, drawdown y PnL neto de opciones quedan no calculables sin contratos, cotizaciones negociables, spreads y costos históricos.

## Datos, calendario y disponibilidad

El auditor reutiliza el parser y contrato CSV, el calendario Alpaca, `auditNvdaCalendar` y los agregadores 15m→1h/1d. Comprueba OHLCV, fechas, duplicados, sesiones, barras parciales y continuidad entre sesiones, incluidos cambios de horario y cierres anticipados representados en el calendario. Cuenta ventanas matemáticamente suficientes para SMA20/40/100/200 y Bollinger20; los agregados horarios abreviados programados se contabilizan por separado. Una sesión ausente o incompleta rompe la continuidad. La auditoría cubre desde la primera hasta la última sesión observada, sin afirmar completitud fuera de esa ventana.

Los datos reales exigen metadatos `real`, NVDA/AMD/AMZN explícito, 15m, sesión regular, Alpaca SIP, `split`, calendario y procedencia coherentes. No se convierte IEX en SIP. La licencia aplicable a la cuenta y la redistribución **no se acreditan con el CSV** y quedan pendientes de verificar. Alpaca documenta los feeds y ajustes en su [API histórica](https://docs.alpaca.markets/us/reference/stockbars); la disponibilidad y los permisos dependen de la cuenta. El ajuste retrospectivo por splits no demuestra qué serie ajustada estaba disponible en cada decisión. Tampoco existe marca de recepción histórica verificada: el cierre físico de la vela no se presenta como recepción real.

Si falta AMD o AMZN, el informe indica los archivos faltantes: CSV 15m, metadatos, calendario y procedencia. Una posible fuente es Alpaca Market Data con SIP autorizado, `15Min`, ajuste y calendario explícitos; no se descarga automáticamente ni se presupone que el plan conceda los permisos. El CSV de NVDA existente es SIP split, con calendario y procedencia; su auditoría se ejecuta localmente y no implica licencia de publicación ni evaluación independiente.

## Ejecución y artefactos

```powershell
npm.cmd run research:42a -- --run-id auditoria-001
npm.cmd run research:42a -- --run-id auditoria-002 --amd ruta\AMD.csv --amzn ruta\AMZN.csv
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Cada ejecución crea una carpeta nueva `private/phase42a/<run-id>` y rechaza sobrescrituras. `protocol.json`, `catalog.json`, `report.json`, `report.md`, `pilot.jsonl` y `manifest.json` incluyen hashes del protocolo, código, entradas y salidas. `pilot.jsonl` enumera velas examinadas con motivos `NO_EVALUABLE`: **no son oportunidades detectadas ni señales**. Sus horas de cierre son límites físicos; `availableAtUtc=null` conserva la recepción desconocida. No hay datos ficticios interpretados como reales. Un error puede dejar una carpeta temporal privada para inspección; nunca modifica investigaciones anteriores.

La matriz de 24 combinaciones usa `SIN_DATOS`, `NO_VERIFICABLE`, `PENDIENTE` y `CONGELADA`; `EVALUADA` queda reservada para cuando exista un protocolo ejecutable y evidencia suficiente. El estado de E5/E6 congeladas en NVDA documenta la instrucción del usuario, no acredita que se hayan localizado todos sus resultados.
