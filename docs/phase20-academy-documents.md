# Fase 20: documentos de academia y rangos de prima ASK

## Propósito y límites

Esta fase incorpora evidencia documental privada para **describir** rangos orientativos de prima ASK por acción de contratos de opciones. No crea una señal, una recomendación, un filtro histórico, una orden ni una estimación de rentabilidad. Un contrato estándar puede tener multiplicador 100, pero el rango documental y su evaluación permanecen en prima unitaria, expresada en centavos enteros.

Los detectores de Fases 11–12 y los estudios de Fases 9–18 no se modifican. La referencia tampoco se usa para recalcular resultados históricos: faltan cotizaciones de opciones y versiones documentales con vigencia suficiente para hacerlo sin sesgo temporal.

## Inventario privado inspeccionado

Se inspeccionaron localmente, sin copiar sus contenidos al repositorio, una tabla XLSX de rangos, dos exportaciones HTML fechadas y hojas complementarias de planificación, una plantilla de cálculo y listas de verificación. La tabla XLSX y cada exportación HTML contenían 53 registros de activos. Las columnas relevantes fueron `TICKER`, `RANGO ÓPTIMO` y `FECHA DE ANÁLISIS`; también existían columnas de sector, índice y nombre que no forman parte del rango de la opción.

La lista de verificación separa el rango de precio de los campos de contrato (CALL/PUT, vencimiento, strike, ASK y BID). La instrucción del operador fija la interpretación de los rangos importados: son primas ASK por acción. Las fuentes inspeccionadas no aportan de forma consistente vencimiento, lado de opción, strike, delta, IV, liquidez, vigencia ni fórmula de cálculo.

La comparación local de las tres fuentes encontró registros repetidos y fechas de análisis por fila. Esa evidencia no permite inferir una fórmula: hay pocas versiones y faltan dimensiones contractuales. La hoja de cálculo complementaria contiene ejemplos de porcentajes y celdas no calculables, pero no vincula sus variables con los rangos de la tabla. Su interpretación permanece `UNVERIFIED`.

## Política temporal y conflictos

1. Un intervalo de vigencia explícito tiene prioridad (`ACTIVE`).
2. Sin intervalo, un registro solo es aplicable en su misma fecha de referencia (`REFERENCE_DATE`).
3. Una referencia anterior se conserva para investigación como `HISTORICAL_ONLY`; no se evalúa contra un ASK actual.
4. Dos referencias aplicables para la misma fecha, o dos candidatas de la última fecha anterior, producen `CONFLICT`.
5. Si una fuente futura omite un activo, no elimina su historial ni lo convierte en recomendación vigente.

Las fechas ISO y seriales de Excel se normalizan de forma reproducible. Una fecha numérica con día y mes ambos menores o iguales que 12 no se adivina: se conserva sin fecha de referencia con la nota `Fecha ambigua`. La fecha incluida en un nombre de archivo se guarda solo como metadato secundario, nunca como vigencia.

## Arquitectura y privacidad

- `apps/api/src/academy/xlsx.ts` lee XLSX ordinarios con límites de 200 entradas, 5 MiB por entrada y 12 MiB descomprimidos. Rechaza cifrado, rutas relativas, entradas corruptas y expansiones excesivas.
- El importador acepta XLSX, CSV con comillas y HTML de una tabla. Exige `TICKER`/`SYMBOL` y `RANGO ÓPTIMO`/`ASK RANGE`, normaliza dinero a centavos y no rellena campos ausentes.
- `academy_documents` conserva hash SHA-256, archivo base, formato, fecha secundaria de nombre, momento de importación y conteo. `academy_ask_ranges` conserva rango, fecha, ubicación, versión, método y estado. Los originales no se guardan.
- El evaluador compara solo un ASK reciente de IBKR. No usa `last`; cero, ausencia de ASK, permiso denegado, timestamp inválido u obsoleto, moneda distinta de USD o multiplicador distinto de 100 dejan el resultado no evaluable.
- `GET /api/v1/academy/summary` y `GET /api/v1/academy/ranges?symbol=NVDA&asOf=YYYY-MM-DD` exponen metadatos y registros normalizados, nunca archivos fuente. La importación es una CLI local, no una API pública.

```powershell
npm run academy:import -- C:\ruta\privada\rangos.xlsx
```

La importación es idempotente por SHA-256. En Windows usa la misma base privada que la aplicación, bajo `%LOCALAPPDATA%\Trading-POC`, salvo que `TRADING_POC_DB_PATH` indique otra. `private/`, `academy-private/` y SQLite están excluidos de Git. Para HTML se debe indicar el archivo de la hoja exportada, no el marco HTML externo.

## Conclusión y datos necesarios

| Estado | Hallazgo |
| --- | --- |
| `DOCUMENTED` | Existen rangos por activo y fecha de análisis, interpretados como prima ASK por instrucción del operador. |
| `UNVERIFIED` | La plantilla complementaria no demuestra una fórmula que produzca los rangos. |
| `HYPOTHESIS` | Strike, vencimiento, lado, IV, delta, liquidez y subyacente podrían influir, pero las fuentes no permiten comprobarlo. |
| Datos faltantes | Vigencia explícita, contrato objetivo, fecha de publicación verificable y cotizaciones OPRA históricas. |

Un ASK dentro de un rango documentado no evalúa tendencia, liquidez, vencimiento, rentabilidad ni conveniencia. La integración no incorpora órdenes y no afirma acceso OPRA real.
