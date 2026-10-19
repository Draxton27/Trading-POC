# Ticks IBKR: normalización y límites

Fuente: documentación oficial TWS API [Tick Types](https://interactivebrokers.github.io/tws-api/tick_types.html), [Market Data Types](https://interactivebrokers.github.io/tws-api/market_data_type.html) y [Option Computations](https://interactivebrokers.github.io/tws-api/option_computations.html).

| Campo | Live y frozen | Delayed y delayed-frozen |
| --- | ---: | ---: |
| Bid / ask / last | 1 / 2 / 4 | 66 / 67 / 68 |
| Tamaño bid / ask | 0 / 3 | 69 / 70 |
| Griegas de modelo, delta/gamma/theta/vega/IV | 13 | 83 |

`marketDataType` 1, 2, 3 y 4 se normaliza respectivamente a LIVE, FROZEN, DELAYED y DELAYED_FROZEN; otro valor es UNKNOWN. Tras el handshake Paper se solicita el tipo 3 para permitir datos retrasados cuando no existe permiso live; el tipo efectivamente recibido se toma de la respuesta por *request ID*. Cada suscripción mantiene un libro de ticks y lo vacía al cambiar tipo. No se combinan bid live y ask delayed. Valores no finitos o negativos se dejan nulos.

`receivedAtUtc` se toma del reloj local al recibir el callback. Los callbacks usados no traen una hora de mercado verificable, por lo que `marketTimestampUtc` sigue nulo. La UI presenta feed, recepción, caducidad y permisos no verificados. La prueba MOCK no demuestra suscripción OPRA, profundidad, ejecutabilidad ni derechos de mercado; esto exige TWS Paper auténtico.
