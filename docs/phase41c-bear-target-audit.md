# Fase 41C: objetivo BAJISTA y trayectoria IEX

Esta fase reconstruye el objetivo histórico de Fase 38E y mide qué ocurrió después de la entrada de referencia. Es investigación retrospectiva del precio de NVDA IEX raw; no entrena modelos ni redefine etiquetas. Los datos futuros aparecen solo en la auditoría de resultados. El histórico y los artefactos reales permanecen privados.

## Contrato original

Se reutilizan los validadores de Fases 38E, 40A y 40C1 para comprobar manifiestos, SHA-256, velas IEX raw de 15 minutos, calendario Alpaca y predicciones. La entrada es exactamente reference_entry_at_utc: la primera apertura programada estrictamente posterior a la decisión simulada. En delayed, esa decisión ocurre veinte minutos después del cierre observado. No representa recepción histórica comprobada. La etiqueta compara esa apertura con el cierre de la cuarta vela completa de la misma sesión: cambio mayor que +0,5 ATR14(t) es ALCISTA; menor que −0,5 ATR14(t) es BAJISTA; la igualdad es LATERAL.

El CLI verifica paridad exacta de todas las observaciones originales evaluables antes de escribir el informe: entrada, salida, ATR, etiqueta y hora de disponibilidad. Las ventanas alternativas parten de la misma entrada y tienen horas de desenlace propias. No se completan huecos.

La trayectoria registra mínimo, máximo, excursiones en unidades de precio y ATR, cambio neto, primeros toques de barreras, cuatro cierres respecto a la entrada, racha máxima debajo, cuerpos bajistas y recuperación desde el mínimo. Un toque es inclusivo; la etiqueta terminal exige una desigualdad estricta. Si ambas barreras se tocan en una misma vela de 15 minutos, el orden queda ambiguo.

Se distinguen dos medidas: any_same_bar_both_touched indica que alguna vela tocó las dos barreras, aunque una ya hubiera recibido su primer toque antes; first_touch_order_ambiguous indica que los primeros toques alcista y bajista ocurrieron en la misma vela. Solo esta segunda condición produce AMBIGUOUS_INTRABAR_ORDER. Si los primeros toques ocurrieron en velas distintas, la trayectoria es BOTH_DIRECTIONS_TOUCHED y conserva el orden inicial aunque una vela posterior toque ambas.

Las demás categorías terminales tienen precedencia después de ambas barreras: cierre bajista/alcista → BEARISH_TERMINAL_MOVE/BULLISH_TERMINAL_MOVE; toque unilateral sin cierre terminal → DOWNWARD_EXCURSION_RECOVERED/UPWARD_EXCURSION_RECOVERED; sin toque → NO_SIGNIFICANT_EXCURSION. Por esta precedencia, las frecuencias de categorías no equivalen a las etiquetas terminales.

La persistencia experimental requiere cierre BAJISTA, tres cierres bajo la entrada y una racha de tres. Una recuperación parcial significa que el cierre final supera el mínimo intrahorizonte en al menos 0,5 ATR. Estas propiedades pueden coexistir. Ninguna es regla oficial de Investep.

## Resultado local verificado

El resultado inicial está en `private/ml-iex/phase41c-target-audit-v2/`; las salidas privadas anteriores se conservaron. La corrección actual se regeneró en `private/ml-iex/phase41c-target-audit-v6/`. El manifiesto SHA-256 de v6 se verificó. Los SHA-256 del histórico 38D y del experimento 38E se contrastaron con los manifiestos. Persiste la deriva de dos hashes de capturas de código originales ya documentada en 41B; los archivos de observaciones, predicciones y modelos se verificaron. La paridad contra las velas IEX aprobó.

En delayed, las 6.219 predicciones evaluables abarcan 333 sesiones: 1.705 BAJISTA, 2.833 LATERAL y 1.681 ALCISTA. La confusión BAJISTA conserva 61 aciertos, 1.425 predicciones LATERAL y 219 ALCISTA.

| Grupo delayed, 60 min | Casos | Toque bajista ≥0,5 ATR | Mediana cambio final | Mediana cierres bajo entrada | Mediana probabilidad BAJISTA |
|---|---:|---:|---:|---:|---:|
| LATERAL real, todos | 2.833 | 1.467 (51,8 %) | Ver JSON | Ver JSON | Ver JSON |
| LATERAL → LATERAL | 2.605 | 1.311 (50,3 %) | −0,01 ATR | 2 | 0,259 |
| BAJISTA → LATERAL | 1.425 | 1.425 | −0,94 ATR | 4 | 0,266 |
| BAJISTA → BAJISTA | 61 | 61 | −1,31 ATR | 4 | 0,364 |
| BAJISTA → ALCISTA | 219 | 219 | −1,26 ATR | 4 | 0,297 |

Las 1.467 etiquetas LATERAL con toque bajista muestran que el cierre de la cuarta vela oculta caídas transitorias. Entre los 1.705 BAJISTA terminales, 1.409 cumplen la definición descriptiva de persistencia y 510 recuperan al menos 0,5 ATR desde el mínimo antes del cierre; los grupos se solapan. Los BAJISTA confundidos con LATERAL tuvieron una caída terminal mediana menor que los 61 aciertos (−0,94 frente a −1,31 ATR) y menor probabilidad BAJISTA mediana original (0,266 frente a 0,364). Estas cifras no identifican una causa única.

En delayed, 1.250 trayectorias tocaron ambas barreras. En 477 hubo alguna vela que tocó las dos; 229 tuvieron sus primeros toques dentro de esa misma vela y se clasifican AMBIGUOUS_INTRABAR_ORDER. En las otras 248, el primer toque previo de una barrera ya establecía el orden; una vela posterior con ambos extremos no invalida esa información. Entre los 219 BAJISTA predichos ALCISTA, 89 tocaron ambas barreras y 41 tocaron primero la alcista en una vela anterior a la bajista.

### Umbral contrafactual con horizonte original

| Umbral ATR | ALCISTA | BAJISTA | LATERAL | Etiquetas diferentes |
|---:|---:|---:|---:|---:|
| 0,25 | 2.300 | 2.355 | 1.564 | 1.269 |
| 0,50 original | 1.681 | 1.705 | 2.833 | 0 |
| 0,75 | 1.183 | 1.189 | 3.847 | 1.014 |
| 1,00 | 785 | 832 | 4.602 | 1.769 |

Las transiciones, casos próximos a cada frontera (≤0,1 ATR), folds y meses figuran en target-sensitivity.json. El clasificador no fue entrenado para las etiquetas alternativas; su recall original no valida esos objetivos.

### Horizonte contrafactual con umbral fijo de 0,5 ATR

| Horizonte desde la misma entrada | Cobertura propia delayed | Población común 2/4/6 | BAJISTA en población común |
|---|---:|---:|---:|
| 2 velas / 30 min | 6.888 | 5.556 | 1.160 |
| 4 velas / 60 min original | 6.219 | 5.556 | 1.482 |
| 6 velas / 90 min | 5.556 | 5.556 | 1.660 |

De las 8.187 predicciones delayed, el horizonte de 60 minutos excluye 943 sin entrada programada, 942 por cierre y 83 por huecos. A 90 minutos, 1.570 quedan fuera por cierre y 118 por huecos. En las 5.556 observaciones comunes, 2.377 tocan la barrera bajista en los primeros 30 minutos; 1.111 terminan BAJISTA a 60 y 90 minutos, mientras 371 dejan de ser BAJISTA a 90. El cambio de cobertura cerca del cierre impide atribuir diferencias de los totales propios solo al precio.

El escenario ideal se informa por separado: 6.536 evaluables a 60 minutos y 5.873 comunes. El JSON privado incluye folds, semanas y meses. Los tres folds delayed tienen 2.243, 2.432 y 1.544 observaciones; las fracciones de toque bajista total son 57,3 %, 57,9 % y 55,6 %. Esta similitud no establece estabilidad de todas las asociaciones. El bootstrap remuestrea sesiones completas y conserva el solapamiento dentro de cada sesión, pero no captura necesariamente dependencia entre jornadas o cambios de régimen prolongados. El histórico ya fue examinado repetidamente.

## Relación con Investep y siguiente hipótesis

La etiqueta 38E representa un cambio neto del subyacente normalizado por ATR. No implica por sí sola tendencia bajista, ruptura técnica confirmada, continuación, oportunidad PUT ni beneficio. No hay primas, bid/ask, costos, liquidez o fills históricos de opciones en este estudio.

Una hipótesis para predefinir antes de observar datos nuevos sería distinguir un objetivo de caída transitoria durante cuatro velas de otro que además termine bajo −0,5 ATR y conserve tres cierres bajo la entrada. Requeriría un modelo entrenado causalmente para el objetivo nuevo, datos temporalmente independientes, recepción verificable y validación de utilidad para Investep. Esta fase no selecciona umbrales u horizontes ganadores.

## Reproducción Windows

Desde la raíz, con Python 3.12 y el entorno existente:

~~~powershell
.\.venv\phase28-py312\Scripts\python.exe -m ml.phase41c.report --history private\iex-history\nvda-2024-2026-phase38e --run private\ml-iex\phase38e-20261023-v1 --out private\ml-iex\phase41c-target-audit-v6
~~~

El destino debe ser nuevo. Emite manifest.json, coverage.json, trajectory-audit.json, target-sensitivity.json, bear-confusion-audit.json, report.json, report.md y SHA256SUMS. Las pruebas sintéticas se ejecutan con:

~~~powershell
.\.venv\phase28-py312\Scripts\python.exe -m unittest ml.phase41c.test_target_audit
~~~

CI Windows ejecuta esa suite en Python 3.12 y verifica Node 22/24.
