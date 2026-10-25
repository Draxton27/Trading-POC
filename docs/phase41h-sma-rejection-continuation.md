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
exactamente sobre la SMA**. No hubo discrepancias con la interacción 41A en
esta fuente. Hubo 844 clústeres de visita que contienen más de una SMA.

## Hallazgos prioritarios: 15 minutos, tendencia bajista

Los denominadores de contacto y rechazo son todas las visitas observadas,
excluyendo censura izquierda. Los porcentajes de continuación usan únicamente
desenlaces evaluables de cuatro velas.

| SMA | Visitas | Contacto real | Rechazo confirmado | Rechazo / visitas | Rechazo / contactos | Rechazos evaluables | Favorable / adverso tras rechazo | Contactos sin rechazo evaluables | Favorable / adverso sin rechazo |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 930 | 892 | 474 | 51,0 % | 53,1 % | 348 | 29,0 % / 30,2 % | 296 | 31,8 % / 26,4 % |
| 40 | 690 | 638 | 342 | 49,6 % | 53,6 % | 258 | 27,1 % / 31,8 % | 240 | 28,3 % / 32,5 % |

Para SMA20, **157/339** primeras visitas tuvieron rechazo confirmado
(157/328 entre contactos); entre las posteriores fueron **317/591**
(317/564 entre contactos). La continuación favorable después de esos
rechazos fue **26,7 %** de 120 primeras evaluables y **30,3 %** de 228
posteriores evaluables. Para SMA40, los rechazos fueron **174/351** primeras
(174/327 contactos) y **168/339** posteriores (168/311 contactos); la
continuación favorable fue **23,5 %** de 136 y **31,1 %** de 122,
respectivamente. La primera visita no mostró una frecuencia de rechazo
uniformemente superior.

La comparación predefinida D (rechazo frente a contacto real sin rechazo)
dio una diferencia favorable de **−2,7 puntos porcentuales** para SMA20
y **−1,2 puntos** para SMA40. Sus intervalos por sesión, etiquetados solo
como sensibilidad, fueron aproximadamente **−9,8 a +3,7 puntos** y
**−8,9 a +6,0 puntos**. Ambos incluyen cero. La comparación A (primera
visita con rechazo frente a primera sin rechazo) dio **−4,9** y **−4,1
puntos**, también con sensibilidades que incluyen cero. Los resultados
alcistas de SMA20/40 tampoco muestran una mejora uniforme tras rechazo:
28,1 % frente a 31,1 % y 27,6 % frente a 29,0 % de continuación favorable
entre contactos evaluables.

El desglose anual cambia de dirección. Por ejemplo, en bajista SMA20 la
tasa favorable tras rechazo fue 38,9 % en 2022, 21,1 % en 2024, 20,7 %
en 2025 y 35,9 % en 2026. En 2021 hubo solo nueve desenlaces de rechazo
evaluables, por lo que ese año se marca como evidencia insuficiente.
Los bins de edad del régimen de 41G también presentan resultados
heterogéneos. El período coincidente con 38E/41F se presenta aparte del
historial anterior; ninguno es una muestra independiente del proyecto.

En SMA20 bajista quedaron **248** desenlaces de cuatro velas no
evaluables, y en SMA40 **140**. Los motivos originales distinguen
`SESSION_END` (129 y 59) de `RIGHT_CENSORED` (119 y 81).
No se atribuye todo `RIGHT_CENSORED` automáticamente a un cierre normal:
también puede reflejar el borde de la fuente. El reporte conserva cada
motivo 41G, además de las categorías resumidas de exclusión.

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
