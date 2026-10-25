# Fase 41H: rechazo geométrico y continuación posterior en SMA

Este estudio histórico exploratorio usa las visitas, los regímenes y los desenlaces
congelados de Fase 41G v2. La fuente es NVDA Alpaca SIP de 15 minutos en sesión
regular, ajustada por splits. La disponibilidad histórica se **simula** como
cierre de vela +20 minutos; no representa una recepción original verificada.
El protocolo independiente se congeló en
[`ml/phase41h/protocol.json`](../ml/phase41h/protocol.json), SHA-256
`6c6324f9f29b66a231b6796c27d094fd1a5813c49ed023e54a57fa94a301969b`.
No se cambiaron las reglas de visitas ni las etiquetas de 41G.

## Qué se mide

Una visita 41G bajista se detecta con `high >= SMA`; una alcista con
`low <= SMA`. Ambas pueden incluir velas donde la SMA queda fuera del rango.
41H registra **contacto geométrico** solo si
`low <= SMA <= high`, usando la SMA final disponible al cierre de esa vela.

Un rechazo bajista confirmado requiere contacto, cierre estrictamente debajo de
la SMA e interacción causal `REJECTED_BELOW` de 41A. El alcista exige cierre
estrictamente encima e interacción `REJECTED_ABOVE`. Se cuentan por separado
el cierre del lado contrario, exactamente sobre la SMA, la visita sin
intersección, la discrepancia con 41A y los datos no disponibles.
La geometría OHLC no revela el orden intravela de los precios.

**Rechazo geométrico** describe la vela de visita. **Continuación posterior**
describe el resultado desde la primera apertura programada posterior al
instante simulado de disponibilidad, durante cuatro velas completas. Se
reutilizan exactamente los desenlaces favorable, adverso, neutral y no
disponible de 41G, su umbral de 0,5 ATR14 y sus horizontes secundarios de dos y
seis velas. Una apertura observada es una referencia, no un fill garantizado.

El cierre físico del desenlace está en `outcomeBarEndUtc`; el momento
simulado en que se conocería está en `outcomeKnownAtUtc`. En ningún caso se
puede decidir sobre el rechazo antes de `assumedAvailableAtUtc`.

## Poblaciones y comparaciones

La prioridad predefinida es **15m bajista, SMA20 y SMA40 por separado**. Se
informan también SMA100/200, tendencia alcista, y 1h/1d como estudios
secundarios separados. Las primeras visitas observadas, posteriores y
censuradas a izquierda mantienen sus categorías originales. Los contactos
consecutivos siguen formando un único episodio de 41G.

Las comparaciones A–E distinguen primera visita con/sin rechazo, visitas
posteriores con/sin rechazo, primeras frente a posteriores con rechazo,
rechazo frente a contacto real sin rechazo y rechazo frente a todas las visitas
41G de la misma SMA, marco y dirección. La referencia E se solapa con el grupo
de rechazo y no recibe un intervalo de diferencia. Las visitas censuradas a
izquierda se conservan en cobertura, pero no entran en A–E. Los desenlaces
censurados no se imputan. Las comparaciones A–D excluyen geometría no
disponible; la referencia general E conserva la población de visitas 41G y
explicita su solapamiento.

Se muestran diferencias descriptivas e intervalos agrupados por sesión y
régimen como **sensibilidades** cuando cada lado cuenta con al menos 30
desenlaces y 30 sesiones. Se remuestrea el mismo clúster completo para ambos
grupos. Sesiones y regímenes se cruzan, y varios eventos de SMA pueden
compartir vela; ningún agrupamiento individual captura toda esa dependencia.
El histórico ya fue examinado en fases anteriores y los subgrupos múltiples no
constituyen hipótesis independientes confirmadas.

## Integridad y cobertura

La ejecución verifica `SHA256SUMS`, el CSV SIP y sus tres archivos de
procedencia, el calendario exportado, los hashes de código 41A/41B/41G y el
protocolo 41G. Recalcula visitas, regímenes y desenlaces con los módulos 41G y
exige igualdad exacta con los artefactos privados antes de clasificar rechazo.
En la fuente local verificada hay **5.681 visitas**, **1.103 regímenes** y
**5.681 registros de desenlace** con paridad exacta. La clasificación inicial
de todas las visitas dio **2.825 rechazos confirmados**, **335 visitas sin
intersección**, **2.518 contactos con cierre del lado contrario** y **3 cierres
exactamente sobre la SMA**. Los denominadores específicos por SMA y tipo de
visita están en el reporte privado.

## Reproducción local en Windows

Con Python 3.12, desde la raíz del repositorio:

```powershell
& .\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase41g.test_events ml.phase41h.test_rejections
& .\.venv\phase28-py312\Scripts\python.exe -m ml.phase41h.report --sip-csv trading_poc_001_bollinger/data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv --phase41g private/ml-iex/phase41g-investep-trend-events-v2-final --out private/ml-iex/phase41h-rejection-continuation-v1
```

La salida debe apuntar a un directorio nuevo. El comando rechaza la
sobrescritura y guarda `manifest.json`, `report.json`, `report.md`,
clasificaciones por evento, cobertura, transiciones, comparaciones,
incertidumbre y `SHA256SUMS` dentro de `private/`, excluido de Git.

## Alcance de las conclusiones

La frecuencia de un rechazo es un hecho geométrico observado. La frecuencia
favorable posterior es una asociación histórica bajo reglas y horizontes
concretos. **No demuestra capacidad predictiva, rentabilidad, ejecución al
toque ni validez general de Investep.** El ajuste retrospectivo por splits
tampoco reproduce necesariamente el precio conocido originalmente en cada
fecha. No se entrenó ni promovió ningún modelo y no se generan señales CALL o
PUT.
