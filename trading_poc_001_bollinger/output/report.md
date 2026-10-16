# POC 001: Bollinger y movimientos posteriores

Archivo: `QQQ_FICTICIO_5min.csv`
**ATENCIÓN: DATOS FICTICIOS. Los resultados NO representan QQQ ni sirven para operar.**

Velas: 7800; rango 2026-06-01T13:30:00.000Z a 2026-10-16T19:55:00.000Z.
Parámetros: Bollinger 20 períodos, 2 desviaciones; referencia histórica 100 velas; percentil 20; expansión relativa mínima 5%; ruptura de banda; máximo una señal cada 12 velas.
Separación temporal: primeras 5460 velas para exploración y últimas 2340 velas para validación. Los parámetros se eligieron antes de conocer los resultados del ejemplo.

**Importante:** el porcentaje positivo aquí indica únicamente que el precio de QQQ se movió en la dirección observada después de X velas. **No indica ganancias de CALL/PUT** ni incorpora primas, spreads o comisiones.

## Exploración (primer 70%)

| Dirección observada | Horizonte | Señales válidas | % movimiento favorable | IC 95% (aproximado) | Cambio medio a favor (%) | Base de mercado favorable (%) |
|---|---:|---:|---:|---|---:|---:|
| Alcista (estudiar CALL) | 3 velas | 45 | 44.44% | 30.94% a 58.82% | 0.00 | 49.50% |
| Alcista (estudiar CALL) | 6 velas | 44 | 52.27% | 37.94% a 66.25% | 0.03 | 49.33% |
| Alcista (estudiar CALL) | 12 velas | 41 | 56.10% | 41.04% a 70.11% | 0.02 | 48.83% |
| Bajista (estudiar PUT) | 3 velas | 50 | 52.00% | 38.51% a 65.20% | 0.02 | 50.50% |
| Bajista (estudiar PUT) | 6 velas | 48 | 58.33% | 44.28% a 71.15% | 0.03 | 50.65% |
| Bajista (estudiar PUT) | 12 velas | 43 | 62.79% | 47.86% a 75.62% | 0.08 | 51.17% |

## Validación (último 30%)

| Dirección observada | Horizonte | Señales válidas | % movimiento favorable | IC 95% (aproximado) | Cambio medio a favor (%) | Base de mercado favorable (%) |
|---|---:|---:|---:|---|---:|---:|
| Alcista (estudiar CALL) | 3 velas | 21 | 57.14% | 36.55% a 75.53% | -0.02 | 48.67% |
| Alcista (estudiar CALL) | 6 velas | 21 | 47.62% | 28.34% a 67.63% | -0.01 | 47.96% |
| Alcista (estudiar CALL) | 12 velas | 19 | 47.37% | 27.33% a 68.29% | 0.02 | 48.08% |
| Bajista (estudiar PUT) | 3 velas | 31 | 51.61% | 34.84% a 68.03% | 0.02 | 51.33% |
| Bajista (estudiar PUT) | 6 velas | 30 | 50.00% | 33.15% a 66.85% | 0.03 | 52.04% |
| Bajista (estudiar PUT) | 12 velas | 28 | 39.29% | 23.57% a 57.59% | 0.04 | 51.87% |

**Lectura correcta:** las cifras dependen de los datos, del período y de las reglas seleccionadas. El intervalo de confianza supone observaciones independientes, que no siempre ocurre en series financieras. Una tasa histórica alta no demuestra una ventaja real.

**Próximo paso:** analizar velas reales de QQQ y después investigar si las diferencias persisten fuera de muestra y tras costos de ejecución.
