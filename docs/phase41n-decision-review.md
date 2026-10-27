# Fase 41N: revisión de decisiones

La vista **Revisión de decisiones** reúne decisiones humanas F17 y entradas hipotéticas 41M en dos secciones separadas: `DECISION_TIME_VIEW` y `POST_OUTCOME_REVIEW`. Es una proyección local de solo lectura. No ejecuta Python, inferencia, consultas al bróker ni operaciones.

## Arquitectura y procedencia

| Fuente | Lector reutilizado | Uso |
| --- | --- | --- |
| F17 | `verifyLedger()`, `humanFromLedger()`, `buildTradeCases()` | Decisiones originales; anotaciones posteriores separadas; fills solo con IDs explícitos y completos. |
| F16 | `verifyLedger()`, `compareHumanToSignals()` | Comparación humana original y sus estados; únicamente señales registradas y disponibles antes de la decisión. |
| 41M | `SimulatorStore.read()`, `replaySimulator()` | Entradas y resultado **hipotéticos**; hashes y secuencia verificados. Cada entrada conserva posición, simulación, contrato, plan, prima y origen del precio. |
| 41I | `readIexProspective()` | Proyección 41J validada del modelo y protocolo congelados, probabilidades originales y evaluación posterior. |
| 41K | `technicalContextFor()`, `analyzeMarketBars()`, `buildInvestepScenarios()` | Reconstrucción al corte con velas SIP split y calendario oficial; la falta de recepción original se etiqueta `HISTORICAL_ONLY`. |

El servicio vive en `apps/api/src/research/decision-review-service.ts`; el motor puro, en `trading_poc_001_bollinger/src/phase41n-decision-review.ts`. Los contratos estrictos de Zod están en `packages/contracts/src/decision-review.ts`. La interfaz no lee archivos privados: consulta únicamente la API. El caso conserva IDs y hashes de fuente. F17 y 41M solo se vinculan si 41M guarda un `humanDecisionId` existente y anterior; similitud de contrato, hora o dirección nunca crea un vínculo. Las anotaciones F17 no se convierten en nuevas decisiones.

## Corte temporal y estados

El corte es `decisionAtUtc`, que se muestra junto con `documentedAtUtc`. Para cada evidencia se conservan `eventAtUtc`, `availableAtUtc`, `recordedAtUtc`, fuente, hashes y `knownAtDecision`. La predicción 41I exige vela cerrada y predicción recibida y registrada antes del corte; modelo y protocolo deben pasar las verificaciones del lector 41J. Se elige la predicción con `registeredAtUtc` más reciente dentro de **los 15 minutos anteriores** y la **misma sesión NYSE oficial**; un empate usa el ID lexicográficamente menor. No se busca la predicción que acertó. Sin candidata: `predictionMatch: NONE`.

Una reconstrucción 41K usa solo velas cerradas antes del corte y, cuando existe `receivedAtUtc`, recibidas antes del corte. Se vuelve a calcular el estado de 41A/41K sobre ese prefijo: una confirmación de retesteo posterior no puede aparecer en el estado anterior. Los marcos 1h/1d que aún no cerraron se muestran como insuficientes. Cuando alguna hora original de recepción falta, el contexto se marca `HISTORICAL_ONLY` y **no** se atribuye al operador. Con procedencia y tiempos verificables, la marca es `CAUSALLY_RECONSTRUCTED`: indica que la reconstrucción es posible, no que el usuario la viera. El contexto declarado en F17 es `SELF_REPORTED_UNVERIFIED` salvo evidencia externa, que este módulo no inventa.

El hash mostrado para la ventana técnica identifica los datos usados por esta reconstrucción. No es una firma del proveedor ni autentica por sí solo el CSV histórico original. La procedencia y el estado de recepción se informan por separado.

Ejemplo sintético: una vela termina a las 10:00, pero la predicción se registra a las 10:12. Una decisión a las 10:05 no puede mostrar esa predicción, aunque la vela sea anterior; la revisión posterior sí puede mostrar datos posteriores en su propia sección. Un retesteo confirmado a las 10:30 tampoco aparece como confirmado a las 10:05.

Los estados de fuente son `NO_DECISIONS`, `PARTIAL_EVIDENCE`, `AVAILABLE`, `INVALID_SOURCE` y `UNAVAILABLE`. Un ledger corrupto queda identificado por fuente y no se confunde con una colección vacía. Los estados de evidencia son `VERIFIED_AVAILABLE`, `CAUSALLY_RECONSTRUCTED`, `SELF_REPORTED_UNVERIFIED`, `HISTORICAL_ONLY`, `UNAVAILABLE` e `INVALID_EVIDENCE`. DEMO muestra únicamente entradas sintéticas de su simulador de memoria; no abre fuentes privadas reales para llenar la tabla.

## Comparaciones y resultados

Se preserva la ventana **±15 minutos de F16** en `compareHumanToSignals()`. Esa ventana no se utiliza para asociar XGBoost. `no_trade` no equivale a rechazo F16 sin IDs y cobertura explícitos. Las coincidencias de dirección son solo descriptivas (`DIRECTIONALLY_COMPATIBLE`, `DIRECTIONALLY_CONFLICTING`, `INDETERMINATE`, `NOT_COMPARABLE`, `SOURCE_UNAVAILABLE`); no hay voto, puntaje de confianza ni recomendación.

41I predice el movimiento del subyacente y usa IEX `raw`. 41K usa SIP `split` para geometría SMA/Bollinger. Por eso no se comparan niveles de precio entre ambos feeds. Una clase ALCISTA tampoco equivale a una CALL rentable. El P&L de 41M corresponde a una **simulación interna**, con prima de entrada y salidas hipotéticas; comisiones desconocidas siguen siendo `null`. Los fills F17 solo aparecen si los enlaces existentes de `buildTradeCases()` son completos. Para cada entrada adicional de una posición 41M se muestra el resultado **agregado de la posición**, no una asignación inventada a ese lote.

La revisión posterior mantiene separadas `MODEL_DIRECTIONAL_OUTCOME`, `TECHNICAL_SCENARIO_OBSERVATION` y `OPTION_TRADE_ECONOMIC_OUTCOME`. La evolución técnica se describe a partir de eventos 41K posteriores dentro de la sesión de la decisión, si el histórico está disponible. No se calcula una tasa conjunta de éxito ni rentabilidad a partir de velas del subyacente. La evaluación de 41I conserva sus estados `PENDING`, `OVERDUE_UNEVALUATED`, `EVALUATED`, `MISSING_ENTRY` y `MISSING_OUTCOME` y el horizonte congelado de cuatro velas.

## API y uso

Todos los endpoints son `GET`, con la autenticación local existente:

```text
/api/v1/research/decision-review/summary
/api/v1/research/decision-review/cases?offset=0&limit=25
/api/v1/research/decision-review/cases/:id
```

Los filtros de lista son `from`, `to`, `source`, `classification`, `hasPrediction`, `hasTechnicalContext`, `outcomeStatus`, `offset` y `limit`. Zod valida parámetros, y el máximo por página es 100. La revisión limita el número de decisiones fuente a 1000 y los archivos de los ledgers F16/F17 a 5000 registros de 64 KiB cada uno; una fuente que supera el límite falla de forma explícita. Las rutas privadas se determinan por configuración del servidor y nunca por parámetros HTTP.

En Windows, iniciar la aplicación normalmente (`npm.cmd run dev:offline` o `npm.cmd run dev:paper`) y abrir **Revisión de decisiones** en el menú. Las fuentes privadas ya configuradas para F17, F16, 41I y 41M se reutilizan. La vista funciona aunque falten todas ellas.

## Validación y límites

Las pruebas sintéticas cubren disponibilidad temporal, selección IEX y empates, cambios EST/EDT, ausencia de sesión, anotaciones F17, F16 tardío, entradas y cierres 41M, DEMO aislado, paginación y errores de integridad. Ejecutar:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

La existencia de datos y de una asociación temporal no demuestra que el operador vio la fuente. Un resultado técnico reconstruido sobre un CSV histórico sin recepción original tampoco prueba disponibilidad en vivo. Puede que no haya decisiones F17, predicciones 41I asociables, fills vinculados o una muestra suficiente para comparar subgrupos. Los recuentos son descriptivos; no se ofrecen rankings entre humanos, Investep y ML ni se presenta la evaluación retrospectiva como independiente.
