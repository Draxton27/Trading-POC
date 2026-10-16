# Decisión técnica provisional (Fase 1)

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
