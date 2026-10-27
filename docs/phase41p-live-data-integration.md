# Fase 41P: continuidad IEX y Radar Live

Esta fase mantiene separados el histórico Alpaca SIP con ajuste *split*, el histórico IEX *raw* obtenido por REST y las primeras versiones IEX Live recibidas por WebSocket. Una descarga REST no acredita cuándo estuvieron disponibles sus barras en el pasado. Su registro local solo habilita contexto para decisiones posteriores a ese registro. No modifica el modelo XGBoost, el protocolo 41I ni los registros 41O_V1.

## Diagnóstico y hallazgos locales

`npm.cmd run iex:opportunities:doctor` lee los ledgers y calendarios locales, sin abrir una conexión de mercado. Informa primera y última vela Live, recepción, estado del feed, último REST registrado, compatibilidad del calendario, intervalos oficiales faltantes, solapamiento, tramo continuo, suficiencia de cada SMA por temporalidad, Bollinger, RVOL y candidatos registrados. Los códigos son estables; `INSUFFICIENT_DAILY_SMA_HISTORY` distingue una continuidad reciente válida de una SMA200 diaria insuficiente. El estado del feed y la edad de la última recepción se verifican por separado.

En la instalación examinada el 27/10/2026, antes de la recuperación, el último REST terminaba el 22/10 a las 19:45 UTC y Live comenzaba el 23/10 a las 14:00 UTC. El calendario oficial mostraba cuatro intervalos de 15 minutos sin observación en las sesiones del 23 y 26. La brecha era real en los artefactos entonces registrados; no bastaba cambiar el recorte del arreglo. Se recuperó explícitamente `[2026-10-23,2026-10-27)` en una carpeta privada nueva: dos sesiones completas, 780/780 minutos IEX, 52 barras estrictas de 15 minutos, sin minutos faltantes dentro de ese intervalo. La auditoría REST no compara sus precios *raw* contra SIP *split* sin un contrato de ajustes corporativos compatible.

El snapshot privado se registró a las `2026-10-27T14:58:58.364Z`. Ese instante impide atribuirlo a una decisión anterior. Una lectura posterior del doctor, a las `15:13:10Z`, verificó 121 velas continuas desde el `2026-10-20T17:15Z`, cero intervalos faltantes entre el último REST y Live y 48 timestamps solapados donde prevalece la primera versión Live. La última vela examinada cerró a las `15:00Z` y fue recibida a las `15:00:01.212Z`. Había SMA20/40/100 de 15m, SMA20 de 1h y Bollinger 15m; SMA200 de 15m, SMA40/100/200 de 1h y SMA20/40/100/200 de 1d seguían insuficientes. Había cuatro cierres diarios continuos válidos de los 200 requeridos para SMA200 diaria. RVOL era N/D. Había cero candidatos registrados en el ledger 41O en esa lectura. Estas cifras son una observación local puntual y cambiarán con nuevas barras y revisiones.

`iex:doctor` continúa auditando el warmup 38F original y puede seguir indicando `warmupBridge: DISCONNECTED`. El snapshot 41P es independiente y se ve con `iex:opportunities:doctor`; no se reescribe ni se reinterpreta el warmup congelado. En esta instalación `iex:doctor` también informó que la tarea Windows no estaba instalada, aunque una evidencia anterior del usuario la mostraba ejecutándose. No se instaló ni modificó ninguna tarea durante esta fase.

La discontinuidad anterior del histórico aún puede localizarse con `firstActualDiscontinuity`; no se presenta como un hueco del puente más reciente. Un día incompleto invalida su agregado diario y reinicia la suficiencia continua correspondiente. No se rellenan barras IEX ausentes ni se convierten minutos sin transacciones en volumen cero.

## Registro privado y versión experimental

El comando `iex:history` existente conserva paginación, ventanas acotadas, backoff, permisos, calendario oficial y hashes. `iex:opportunities:context` verifica `SHA256SUMS`, CSV, reporte, procedencia `NVDA/iex/raw`, calendario y ventana antes de publicar un `IEX_REST_CONTEXT_SNAPSHOT` privado nuevo. El registro es de escritura única y se publica completo. Contiene el instante real de **registro**; `retrievedAtUtc` queda nulo porque el run histórico anterior no certificaba de forma verificable un instante de adquisición por barra. Su contenido y calendario se verifican nuevamente en cada carga. Los archivos privados anteriores no se migran ni sobrescriben.

Cuando `TRADING_POC_IEX_OPPORTUNITY_CONTEXT_REGISTRY` señala ese registro, el observador existente utiliza una cohorte `41O_V2_REST_CONTEXT` con identidad separada. Sin esa variable conserva exactamente `41O_V1`. La versión nueva ensambla únicamente snapshots ya registrados y primeras versiones Live recibidas al corte. Las revisiones Live posteriores no cambian las entradas usadas. Se reutilizan Fase 23 para continuidad y las fórmulas existentes de Bollinger, volumen y contexto 41A/41K. La serie de 1h exige horas completas y la diaria exige sesiones completas del calendario. Un contexto registrado después de la recepción de la vela candidata da `WARMUP_REGISTERED_TOO_LATE`; se debe esperar una nueva vela Live. El observador conserva el bloqueo de backfill por inicio del proceso y evalúa desenlaces de candidatos anteriores antes de intentar uno nuevo.

## API, interfaz y cotizaciones

Tres GET locales leen la misma proyección IEX: `/api/v1/ml/iex/continuity`, `/api/v1/market/live-technical-context` y `/api/v1/radar/opportunities/diagnostics`. El Radar muestra cierre de la última vela IEX completa, inicio, cierre, recepción, disponibilidad y edad; cada SMA 15m/1h/1d indica valor o N/D, faltantes y hora de disponibilidad. El registro independiente de una vela Live no consta en el esquema del ledger y se devuelve como `null`, sin copiar artificialmente `receivedAtUtc`. El Radar SIP de NVDA/QQQ/SMH permanece identificado como histórico. No se comparan cortes IEX *raw* con SIP *split* como si fueran simultáneos. DEMO permanece sintético y aislado. Un GET no recupera historia, escribe un ledger ni abre suscripciones.

`/api/v1/broker/diagnostics` y `ibkr:paper:doctor` muestran solo estados acotados de puerto, handshake, `nextValidId`, `managedAccounts`, coincidencia Paper y conexión al backend. El doctor hace una prueba TCP de loopback y consulta el estado local; **no** inicia TWS ni solicita datos. El agente guarda un diagnóstico privado sin secreto ni número de cuenta. La falta de evidencia sobre autorización TWS se expresa como causa no confirmada. La comprobación de cuenta Paper sigue siendo obligatoria.

La consulta de un contrato NVDA concreto y suscripción limitada permanecen en Opciones y en la infraestructura existente de 41O/41L. El diagnóstico no consulta la cadena completa. BID/ASK, tamaños, feed y errores de permisos se conservan según el adaptador. TWS no proporciona un timestamp verificable del libro BID/ASK, por lo que esos precios quedan `LIVE_UNVERIFIED` aunque su recepción local sea reciente; no se reutiliza la hora de LAST, no se afirma OPRA y no se eleva el contrato a candidato de revisión sin cumplir la validación estricta. Las suscripciones existentes se liberan con su mecanismo actual. No se envían órdenes.

## Procedimiento Windows de aceptación

Desde la raíz del repositorio, con la configuración privada ya establecida:

```powershell
npm.cmd run iex:doctor
npm.cmd run iex:opportunities:doctor
npm.cmd run ml:iex:41i -- verify
```

Si el diagnóstico encuentra una brecha histórica recuperable, ejecute explícitamente en un directorio **nuevo** y privado, ajustando fechas a la brecha verificada:

```powershell
npm.cmd run iex:history -- --start 2026-10-23 --end 2026-10-27 --out private/iex-history/phase41p-bridge-20261027-v1
npm.cmd run iex:opportunities:context -- --source private/iex-history/phase41p-bridge-20261027-v1 --out private/iex/phase41p-context-20261027-v1.json
$env:TRADING_POC_IEX_OPPORTUNITY_CONTEXT_REGISTRY = (Resolve-Path 'private/iex/phase41p-context-20261027-v1.json').Path
npm.cmd run iex:opportunities:doctor
```

Para uso persistente, configure `TRADING_POC_IEX_OPPORTUNITY_CONTEXT_REGISTRY` en el `.env.local` privado después de revisar el snapshot. No cambie el warmup congelado de 38F. Una repetición debe usar otro directorio versionado; el registro publicado no se reemplaza. Al hacerlo, el contexto nuevo empieza a valer para velas Live **posteriores** a su registro, sin reconstruir candidatos del pasado.

Para Paper, verifique en TWS que está en cuenta Paper, API habilitada en loopback, puerto y client ID correctos y permiso de API aprobado. En la lectura local del 27/10 el puerto configurado **no respondía**; por ello no se verificó handshake, cuenta ni cotización auténtica. Revise sin imprimir la cuenta:

```powershell
npm.cmd run ibkr:paper:doctor
npm.cmd run dev:paper
```

En Radar confirme fuente IEX, horas UTC/NY, cierre, recepción, edad, indicadores disponibles o N/D y razones de abstención. En Opciones seleccione manualmente un contrato NVDA y revise feed, permisos, BID/ASK y calidad; la mera presencia de precios no acredita OPRA ni ejecución. La conexión auténtica a TWS y una sesión Live posterior al nuevo snapshot deben verificarse en la PC; el diagnóstico local aquí no las demuestra.

## Limitaciones estadísticas y operativas

`CURRENT` significa que la última vela completa fue recibida hace no más de 15 minutos y el feed mantiene estado de suscripción; no significa que haya un evento técnico ni oportunidad. `PARTIAL` indica indicadores todavía insuficientes. `STALE`, `FEED_DISCONNECTED`, `INVALID_SOURCE`, `HISTORICAL_ONLY`, `INSUFFICIENT_DATA` y `DEMO` mantienen significados separados. El histórico REST recuperado no tiene recepción por barra históricamente verificada. La versión V2 no altera los candidatos V1. Las observaciones de mercado no garantizan ejecución ni rentabilidad de opciones. El trabajo sigue siendo de investigación y revisión humana paper.

## Validación de la rama

En Windows local: `npm.cmd run typecheck` y `npm.cmd run build` aprobaron; `npm.cmd test` aprobó 520 pruebas Vitest y 197 históricas Node, incluidos fixtures 41P; `npm.cmd run test:e2e` aprobó 27 escenarios DEMO y terminó con código 0. El Python 3.12 del entorno `.venv\phase28-py312` aprobó 161 pruebas. `npm.cmd run ml:iex:41i -- verify` conservó los hashes del modelo y protocolo anteriores y verificó el ledger privado. `iex:doctor` y `iex:opportunities:doctor` leyeron los datos locales sin modificar el recolector. Estas pruebas no demuestran acceso actual a TWS ni OPRA; GitHub Actions debe verificarse por separado en el commit del PR.
