# Fase 41L: análisis de contratos largos de opciones NVDA

## Alcance y arquitectura

La pantalla **Opciones** conserva la cadena IBKR Paper, strikes paginados, vencimientos, comparador de hasta cuatro `conId`, el `consumerId` de cada suscripción y su liberación. El análisis usa las respuestas existentes de `/api/v1/options/comparison`; los cálculos locales no envían solicitudes al agente ni consultan cuentas. No se añadió un endpoint ni una capacidad de órdenes.

`packages/contracts/src/options-analysis.ts` define los esquemas Zod de entrada, calidad, prima, spread, vencimiento, capital, payoff, contexto documental y resultado. `packages/market-domain/src/option-analysis.ts` implementa cálculos puros. `apps/web/src/features/options/analysis.ts` adapta los campos del comparador sin normalizar un dato ausente a cero. `OptionAnalysisPanel.tsx` muestra las entradas hipotéticas y resultados. El comparador original sigue seleccionando por `conId`, aun al refrescar cotizaciones o cambiar de lado.

El parser OCC existente comprueba raíz, CALL/PUT, strike, vencimiento y multiplicador frente a los campos resueltos. Si el OCC está ausente, no se inventa. Se rechazan contratos con `conId` no positivo, símbolo diferente de NVDA, strike o multiplicador no positivo, vencimiento imposible, moneda distinta de USD o discordancia OCC. El estado `INVALID_CONTRACT` deja las cifras económicas en `N/D`. La cantidad admitida va de 1 a 10 000 contratos; capital y costos se limitan para evitar aritmética no finita o fuera de la precisión segura.

## Cálculos y convenciones

| Concepto | Fórmula para `q` contratos largos con multiplicador `m` |
| --- | --- |
| Prima bruta y pérdida máxima bruta de prima | `ASK × m × q` |
| Spread unitario | `ASK − BID` |
| Spread porcentual | `100 × (ASK − BID) / ((ASK + BID) / 2)` |
| Diferencia bruta de salida inmediata | `(BID − ASK) × m × q` |
| Equilibrio bruto CALL / PUT al vencimiento | `strike + ASK` / `strike − ASK` |
| Valor intrínseco unitario CALL / PUT | `max(S − strike, 0)` / `max(strike − S, 0)` |
| P&L bruto de vencimiento | `valor intrínseco × m × q − prima bruta` |
| Porcentaje sobre prima bruta | `100 × P&L bruto / prima bruta`, solo con prima positiva |

`S` es exclusivamente el precio hipotético de NVDA al vencimiento que introduce el operador. No proviene de XGBoost ni representa una cotización futura. Los importes totales se muestran en USD con dos decimales; precios unitarios y equilibrios pueden requerir cuatro. La aritmética conserva el valor sin redondear hasta calcular totales o P&L. Una prima fraccionaria puede hacer que el total interno tenga fracciones de centavo; la visualización redondea, por lo que se debe consultar la cotización real antes de cualquier decisión.

La calculadora distingue **comisión de entrada** de **otro costo que el operador considera aplicable a ese escenario de vencimiento**, ambos manuales y opcionales. `0` declara explícitamente ausencia de ese costo; el campo vacío significa desconocido. La pérdida máxima con comisión de entrada se calcula solo si se conoce esa comisión. El equilibrio ajustado suma únicamente los costos introducidos y se marca **parcial** hasta conocer ambos. El P&L neto de vencimiento requiere ambos costos, incluso si valen cero; el programa no decide si se cobrará ejercicio, salida o expiración. El capital comprometido y la cantidad máxima entera incluyen la comisión de entrada cuando se conoce; de lo contrario, indican que la excluyen. Un presupuesto menor al desembolso genera `BUDGET_EXCEEDED`, sin bloquear contratos ni aplicar un porcentaje de riesgo arbitrario. Nunca se lee el saldo de IBKR ni se almacena el capital hipotético en el servidor.

Ejemplo **sintético** de prueba: CALL NVDA strike 150, ASK 2, BID 1,90, multiplicador 100, cantidad 1 y capital hipotético USD 5 000. La prima bruta y máxima pérdida de prima son USD 200; spread USD 0,10 por acción; diferencia bruta ASK/BID −USD 10; capital comprometido 4 %; equilibrio bruto USD 152. Es una identidad aritmética, no una rentabilidad observada.

## Calidad de datos y tiempo

El feed (`LIVE`, `DELAYED`, `FROZEN`, `DELAYED_FROZEN`, `UNKNOWN`) y el proveedor se conservan. Para `LIVE_RECENT` se exigen **ambos** timestamps, recepción y mercado, no futuros y con antigüedad máxima de 30 segundos. `LIVE_UNVERIFIED` cubre un feed declarado LIVE sin hora verificable; el adaptador TWS actual puede enviar `marketTimestampUtc: null`. `LIVE_STALE` cubre cualquiera de las dos horas antigua. DEMO y agente simulado permanecen `SIMULATED`; falta de permisos, libro parcial y datos ausentes tienen estados separados. Un mercado cerrado puede dejar la última cotización obsoleta, sin convertirla por ello en una cotización corrupta.

Se comprueban por separado BID, ASK, tamaños, libro cruzado y timestamps futuros. BID cero es válido aritméticamente pero no indica un comprador positivo; BID ausente no equivale a cero. ASK cero, precio negativo o ASK menor que BID no permiten calcular la prima. Un feed retrasado puede aportar aritmética ilustrativa, **nunca** un precio LIVE actual o ejecutable. Una recepción reciente tampoco garantiza sincronía entre los dos lados del libro, profundidad suficiente o fill. No se impone un spread máximo inventado.

El DTE son días calendario entre la fecha actual de `America/New_York` y la fecha de vencimiento, con validación exacta del calendario gregoriano. DTE 0 es válido, un vencimiento pasado se advierte y una fecha imposible invalida el contrato. No se inventan horas específicas de ejercicio, liquidación o negociación por serie. El equilibrio es de **vencimiento**, no un objetivo intradía; comparar contratos con vencimientos diferentes no convierte sus equilibrios en probabilidades comparables.

## Academia Investep

La API conserva `selectAcademyReference()` y `evaluateAcademyAskRange()` sin alterar sus reglas. La vista muestra por separado el rango óptimo ASK por acción, los límites documentales externos y el estado `ACTIVE`, `REFERENCE_DATE`, `HISTORICAL_ONLY`, `CONFLICT` o `NONE`. Los límites externos son información, no un filtro de compra. `HISTORICAL_ONLY` no se transforma en recomendación actual; `CONFLICT` se mantiene. La interpretación ASK por acción la aportó el operador y no está verificada explícitamente en la fuente. Un ASK dentro de un rango no demuestra liquidez, rentabilidad ni conveniencia.

## DEMO, PAPER y límites

DEMO conserva contratos sintéticos marcados como tales. PAPER usa contratos y cotizaciones disponibles del agente IBKR de solo lectura; la definición de un contrato no demuestra acceso a OPRA. Los campos delta, gamma, theta, vega e IV se conservan en la cadena y no participan en el análisis ni en ninguna puntuación. El panel no crea señales CALL/PUT, órdenes, estrategias predictivas, nuevos canales de IBKR ni escrituras en ledgers. No presume fills en ASK/BID ni ganancias de opciones a partir de movimientos del ETF.

La calidad de datos depende de lo que TWS entregue: los tamaños pueden faltar, `marketTimestampUtc` puede ser `null` y un feed `UNKNOWN` no puede ascenderse a LIVE. Las tarifas reales, impuestos, reglas específicas de ejercicio y el deslizamiento permanecen desconocidos. Por ello, incluso con ambas comisiones manuales, el P&L neto es un escenario matemático limitado a los costos introducidos.

## Validación y trabajo futuro

Las pruebas sintéticas cubren identidad OCC, fecha de Nueva York, calidad de feed y timestamps, BID/ASK faltantes o inválidos, fórmulas CALL/PUT, comisiones, capital, referencias históricas y adaptación de la respuesta existente. La prueba E2E DEMO comprueba el panel y la ausencia de solicitudes de cuentas u órdenes. Los comandos son:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Una fase posterior podría investigar costos de ejercicio específicos por contrato, disponibilidad real de mercado por horario, o ejecución verificable, con permisos y protocolo propios. Nada de ello se infiere en Fase 41L.
