# Trading-POC · aplicación de análisis (Fase 19)

Aplicación privada en español para observar NVDA, QQQ y SMH, consultar estudios históricos, contratos de opciones y operaciones importadas, y registrar decisiones humanas. **No contiene funciones de envío, modificación o cancelación de órdenes.** Los detectores históricos y los resultados de Fases 9–18 permanecen en `trading_poc_001_bollinger/`.

## Inicio rápido en Windows 10/11

### Comparador de opciones

En Opciones se pueden seleccionar hasta cuatro contratos por `conId`, incluso de diferentes vencimientos o tipos. DTE cuenta días calendario desde la fecha de Nueva York. El spread porcentual usa `(ASK − BID) / ((ASK + BID) / 2)`; si falta un precio, la cotización está cruzada o el punto medio es cero, se muestra `N/D`. El costo nominal es ASK por multiplicador y el equilibrio al vencimiento es strike más ASK para CALL largo o strike menos ASK para PUT largo, sin comisiones. Son cálculos descriptivos basados en la cotización recibida y no garantizan ejecución. El feed, estado y evaluación documental conservan sus restricciones; DEMO es sintético. Las suscripciones Paper seleccionadas se comparten con la cadena y se liberan al quitar el contrato o salir de la vista.

Instale Node.js 22 o posterior y ejecute en PowerShell desde este repositorio:

```powershell
npm ci
npm.cmd run dev:mock
```

Abra `http://127.0.0.1:5173/` **en el mismo equipo**. `dev:mock` inicia API, frontend y agente simulado; `dev:offline` inicia API y frontend con los históricos locales; `dev:paper` inicia API, frontend y agente TWS de solo lectura. Los comandos existentes (`npm run dev`, `npm run dev:web`, `npm run dev:api` y `npm run dev:agent`) se conservan para diagnóstico y pruebas. `npm run test:e2e` usa Chromium de Playwright.

### Configuración local y arranque con Paper

Copie `.env.example` como `.env.local` una sola vez y complete únicamente la cuenta **Paper** (`DU...`) y los datos locales de TWS. `.env.local` se carga desde la raíz del repositorio aunque npm se ejecute desde un workspace, está excluido de Git y no se imprime en los logs. Si falta `TRADING_POC_AGENT_SECRET`, el lanzador crea y guarda una clave aleatoria de 32 bytes; las ejecuciones posteriores reutilizan la misma clave.

```powershell
Copy-Item .env.example .env.local
# Edite .env.local: IBKR_EXPECTED_PAPER_ACCOUNT=DU... y los puertos de TWS si difieren.
npm.cmd run dev:paper
```

El lanzador valida puertos locales antes de iniciar, espera la API y su WebSocket privado antes de conectar el agente, y detiene su propio árbol de procesos con `Ctrl+C`. No mata procesos ajenos: si un puerto está ocupado, muestra el puerto y termina. Paper exige una cuenta `DU...`, limita API y agente a loopback y no guarda contraseñas de IBKR. El resumen inicial redacta el identificador de cuenta y nunca muestra secretos. TWS real no se probó desde este entorno.

Para OFFLINE, conserve los tres CSV SIP autorizados, sus metadatos y calendarios bajo `trading_poc_001_bollinger/data/`; inicie con `npm.cmd run dev:offline`. El CSV fuente nunca se sirve directamente. La API entrega páginas acotadas; las temporalidades horaria y diaria usan las funciones existentes de agregación y respetan velas completas.

La [ingesta Alpaca SIP retrasada](docs/phase33-alpaca-delayed-sip.md) obtiene únicamente velas NVDA de 15 minutos ya cerradas al menos 20 minutos antes de la consulta. En Windows se ejecuta con `npm.cmd run alpaca:ingest -- --once --delay-minutes 20`; conserva el ledger privado append-only y permanece separada de inferencia prospectiva, IBKR y órdenes.

La [observación XGBoost retrasada](docs/phase34-delayed-forward-inference.md) lee exclusivamente ese ledger y un modelo congelado configurado mediante `TRADING_POC_ML_RUN_DIR`. Tras una ingesta válida, `npm.cmd run ml:observe -- --once` solo registra una observación si ocurre estrictamente antes del cierre de `t+4`. No completa observaciones antiguas, no usa CSV manuales y no constituye una señal operativa.

La [evaluación de observaciones adelantadas](docs/phase35-forward-evaluation.md) usa `npm.cmd run ml:evaluate -- --once` una vez recibidas las cuatro velas SIP posteriores. `ml:collect` la ejecuta tras la ingesta sin detener la captura si el evaluador falla. El panel muestra estados y métricas solo cuando existen observaciones auténticas; no convierte aciertos de clase en ganancias.

La [Fase 36](docs/phase36-verifiable-news.md) recopila titulares y resúmenes RSS oficiales con `npm.cmd run news:collect -- --once` y los clasifica localmente con `npm.cmd run news:analyze -- --once`. La nueva vista **Noticias** muestra la fecha declarada, la primera recepción local y el análisis de Ollama por separado. Los registros privados permanecen fuera de Git y no alimentan XGBoost ni generan señales.

La [Fase 37](docs/phase37-news-context.md) construye un dataset privado que cruza observaciones XGBoost registradas antes del desenlace, evaluaciones originales verificadas y noticias recibidas y clasificadas antes de cada predicción. Ejecutar `npm.cmd run ml:news-context -- --once` para actualizarlo; **Predicciones** muestra su resumen experimental. Las diferencias por noticias son asociaciones descriptivas, no una mejora demostrada ni recomendaciones operativas.

El [recolector coordinado de Fase 34.1](docs/phase34-1-automated-collection.md) permite `npm.cmd run ml:collect -- --once` o `npm.cmd run ml:collect -- --continuous`. Consulta el calendario oficial, ingiere velas SIP retrasadas y ejecuta el observador únicamente para una vela nueva y elegible. Su estado privado se muestra en Predicciones.

Para Paper con dos computadoras, lea [la guía Windows](shared-artifacts/phase19-ibkr-ui/phase19-windows-setup.md) y [el modelo de red](shared-artifacts/phase19-ibkr-ui/phase19-network-security.md). La API HTTP escucha solo en `127.0.0.1`. El agente se ejecuta junto a TWS en A y sale hacia un puerto privado de B. Necesita un secreto de aplicación propio y una cuenta Paper esperada para comprobar la sesión. La conexión auténtica con TWS y la prueba física entre equipos **no se han verificado en Codex**.

Los datos privados se guardan fuera de Vite y se excluyen de Git. El diario de la interfaz escribe en el ledger original de Fase 17; las entradas F19 anteriores siguen legibles y de solo lectura. El formulario breve no prueba contexto prospectivo; el CSV oficial F17 conserva capturas, contratos y revisiones. El almacén FIFO F17 conserva los archivos originales de operaciones. Las capturas publicadas en [artefactos](shared-artifacts/phase19-ibkr-ui/README.md) son de DEMO, con datos sintéticos.

En PAPER, la última cotización IBKR se presenta por separado del histórico SIP local, con tipo de feed, hora de recepción y estado obsoleto. Los ticks no se convierten en velas. Las SMA 20/40/100/200 y Bollinger 20/2 visibles proceden de `/market/indicators`; los niveles de la sesión previa requieren un `asOfUtc` explícito. [Correcciones y pruebas del PR #25](shared-artifacts/phase19-ibkr-ui/phase19-pr25-review-fixes.md).

En Opciones PAPER, el vencimiento y los strikes se pueden consultar por rango y página. Si NVDA no tiene una última cotización reciente, seleccione un strike o un rango explícito: la aplicación no supone que el centro de toda la cadena sea el precio de NVDA. Cada contrato puede mostrar por separado definición válida, cotización pendiente, permisos insuficientes o error de IBKR. Los precios OPRA no se presumen disponibles. [Diagnóstico e instrucciones de repetición](shared-artifacts/phase19-ibkr-ui/phase19-option-contracts-fix.md).

## Referencias documentales de primas ASK (Fase 20)

La sección **Referencia de la academia** compara, cuando la fecha documental lo permite, el **ASK por acción** de un contrato con un rango extraído de un documento privado. Un resultado `WITHIN_RANGE` solo describe esa comparación; no es una señal, una recomendación ni una orden. El precio del subyacente, el strike y el costo total del contrato no sustituyen esa prima ASK.

Los originales permanecen locales y se excluyen de Git. Importe una copia autorizada de manera explícita desde la raíz:

```powershell
npm run academy:import -- C:\ruta\privada\rangos.xlsx
```

Se admiten hojas XLSX ordinarias, CSV y HTML de una hoja exportada. La base local guarda solo metadatos de procedencia, el hash SHA-256 y los valores normalizados en centavos; no guarda ni sirve el archivo original. La importación es idempotente. Las reglas de fechas, los límites del lector y la interpretación de los hallazgos están en [Fase 20](docs/phase20-academy-documents.md).

## Estructura

- `apps/web`: React, KLineCharts 10 y formularios de decisión.
- `apps/api`: Fastify, SQLite/Drizzle, adaptadores de investigación y canal privado.
- `apps/ibkr-agent`: interfaz de consulta IBKR y transporte saliente autenticado.
- `packages/contracts`: esquemas Zod compartidos y versionados.
- `packages/research-adapter`: carga de datos y resultados anteriores sin copiar detectores.
- `docs/phase19-architecture-decision.md`: decisión registrada antes del código.
- `docs/phase26-assistant-analysis.md`: fórmulas, interpretación conversacional, sincronización temporal y revisión de proyectos externos.

La documentación detalla los límites pendientes. Ningún resultado de investigación histórico se convierte aquí en recomendación de trading.

## IEX Live experimental (Fase 38A)

El canal IEX se prueba con `npm.cmd run iex:probe -- --once` y se inicia por separado con `npm.cmd run iex:collect -- --continuous`. Su ledger es privado y no alimenta el XGBoost SIP congelado ni la tarea diaria. Consulte [la guía IEX](docs/phase38a-iex-live.md) para procedencia, límites y comparación con SIP.

## Replay histórico XGBoost (Fase 38B)

`npm.cmd run ml:replay:prepare` prepara observaciones causales con el histórico privado NVDA SIP y `npm.cmd run ml:replay:evaluate` entrena modelos experimentales por fold. Los dos relojes comparados son el cierre ideal y un retraso SIP **simulado** de 20 minutos; no se atribuyen horas de recepción reales. Las instrucciones completas y las limitaciones están en [la guía del replay](docs/phase38b-historical-replay.md).

## Replay con objetivos posteriores a la decisión (Fase 38C)

`npm.cmd run ml:replay:post:prepare` y `npm.cmd run ml:replay:post:evaluate` crean etiquetas y modelos independientes para cada disponibilidad simulada. La apertura de referencia se programa estrictamente después de la decisión y el horizonte comprende cuatro velas completas; los registros sin desenlace se conservan. Véanse los comandos, las métricas y los límites de interpretación en [la guía de Fase 38C](docs/phase38c-post-decision-replay.md).

## Histórico IEX y auditoría (Fase 38D)

`npm.cmd run iex:history` descarga NVDA IEX `1Min` con ajuste `raw` a un directorio privado, permite reanudar ventanas y audita cobertura por sesión. La [guía de Fase 38D](docs/phase38d-iex-history.md) explica el comando Windows, las velas estrictas de 15 minutos y la comparación de cobertura con SIP.

## Experimento Walk-Forward IEX (Fase 38E)

`npm.cmd run ml:iex:prepare` construye observaciones históricas causales desde un histórico IEX verificado de Fase 38D. `npm.cmd run ml:iex:evaluate` entrena modelos experimentales separados por fold. Comandos, resultados locales y límites metodológicos: [guía de Fase 38E](docs/phase38e-iex-walk-forward.md).
