# Validación de indicadores (Fase 2, 17 de octubre de 2026)

## Dependencia y alcance

Se instaló `trading-signals@8.3.0` como **dependencia de desarrollo fija**, con `package-lock.json`. Esta versión es la [última publicación señalada por el proyecto](https://github.com/bennycode/trading-signals/releases/tag/trading-signals%408.3.0), tiene licencia MIT y se ejecutó aquí con Node.js 24.20.0. El paquete no declara un campo `engines`; no hemos verificado por separado Node 22.16.0, que sigue siendo el mínimo del POC. El análisis de producción continúa utilizando `src/bollinger.ts`; la dependencia solo participa en las pruebas.

La comparación alimenta a ambos motores, en el mismo orden, con los mismos precios de cierre. Instanciamos por separado [`BollingerBands`](https://github.com/bennycode/trading-signals/blob/trading-signals%408.3.0/packages/trading-signals/src/volatility/BBANDS/BollingerBands.ts) y [`BollingerBandsWidth`](https://github.com/bennycode/trading-signals/blob/trading-signals%408.3.0/packages/trading-signals/src/volatility/BBW/BollingerBandsWidth.ts), porque este último actualiza internamente su propia instancia de bandas. Se comprueban también los valores `null` antes de completar la ventana; la primera lectura válida de 20 períodos aparece en la vela 20 (índice 19). Bandwidth se compara como **proporción**, sin multiplicar por 100.

## Resultados reproducibles

- Fixture `QQQ_FICTICIO_5min.csv`: 7.800 velas ficticias, período 20, multiplicador 2. Las 7.781 velas con resultado válido dieron una **diferencia absoluta máxima de 0** en media, banda superior, banda inferior y Bandwidth; tampoco hubo diferencias de calentamiento.
- Series controladas de precio constante, tendencia y oscilación: paridad vela por vela con configuraciones `(2, 1)`, `(5, 2.5)` y `(20, 2)`.
- Las pruebas admiten diferencias de redondeo de hasta `1e-12 × max(1, |referencia|)` para mantener una comparación numérica estable. La igualdad exacta anterior corresponde al fixture ficticio y a la versión fijada, no es una garantía universal para otras versiones o todos los precios posibles.
- Diferencia fuera del contrato de datos: para cinco cierres de cero, el POC devuelve `bandwidth: null` al no haber media positiva; la biblioteca calcula `0/0` y devuelve `NaN`. Nuestro lector CSV rechaza precios no positivos, así que ese caso no aparece en los datos admitidos por el análisis.

Ambos cálculos usan media simple y desviación estándar **poblacional** de la misma ventana. La biblioteca devuelve `(upper - lower) / middle` como ancho relativo. Su método `getSignal()` compara el precio actual con **bandas anteriores**, mientras nuestra regla compara con las **bandas actuales** y añade condiciones de compresión, expansión y descanso. Por eso `getSignal()` no es un sustituto equivalente de `detectSignals`.

## Recomendación

Mantener `calculateBollinger` como cálculo operativo en este POC y conservar `trading-signals@8.3.0` como referencia independiente en pruebas. La paridad observada no justifica cambiar el motor ahora, y así evitamos alterar inadvertidamente las señales. Si más adelante se decide usar la biblioteca en ejecución, debe revisarse por separado la compatibilidad de entradas, el rendimiento y la regla de señales; esa sustitución **no forma parte de esta fase**.

## Antecedente: decisión provisional de Fase 1

La sección siguiente conserva el estado de investigación anterior a esta validación; sus referencias a una instalación pendiente ya quedaron resueltas arriba.

Revisión estática de repositorios realizada el 16 de octubre de 2026. Aún no hemos ejecutado ni validado las dependencias externas.

## Candidato principal: trading-signals

- Código: https://github.com/bennycode/trading-signals
- Paquetes revisados: `packages/trading-signals` (MIT, paquete 8.3.0), `packages/trading-strategies` (MIT, paquete 0.4.5).
- Contiene `BollingerBands` y `BollingerBandsWidth` y pruebas de cálculo con precios históricos de ejemplo.
- Ya existe `BacktestExecutor`, pero antes de reutilizarlo debemos probar casos de entrada/salida y comprobar cómo calcula operaciones netas de comisiones.
- La implementación de `BollingerBandsWidth` devuelve proporción, no porcentaje. Multiplicar por 100 para mostrar el resultado como `%`.

## Alternativas

- `kernc/backtesting.py` (https://github.com/kernc/backtesting.py): Python y licencia AGPL-3.0. Posible alternativa, con cautela por licencia.
- `QuantConnect/Lean` (https://github.com/QuantConnect/Lean): motor más completo en C#, licencia Apache 2.0. Más trabajo de despliegue para un primer experimento.
- `lambdaclass/options_portfolio_backtester` (https://github.com/lambdaclass/options_portfolio_backtester): Python/Rust, MIT. Los datos incluidos de SPY y QQQ son EOD (cierre diario), no útiles para validar entradas de 5 minutos sin agregar datos intradía de opciones.

## Por qué este POC no depende todavía de `trading-signals`

Primero construimos un cálculo independiente, pequeño y verificable. En el entorno de esta primera prueba no se podía consultar el registro de paquetes npm (error de DNS). Conectaremos la dependencia cuando esté disponible y compararemos resultados vela por vela para verificar que ambos motores calculen los mismos indicadores. Así evitamos convertir una dependencia externa en un impedimento para empezar.

**No hemos demostrado todavía que las reglas de Bollinger funcionen para QQQ real.**
