# Fase 41V: fundación del historial real de operaciones

## Alcance y arquitectura

La ingesta local de solo lectura acepta registros de la tabla **Ejecuciones IBKR** de la base `Diario de Trading | IBKR Real` o exportaciones CSV/JSON. Normaliza cada fila con el mismo contrato Zod, y la almacena en SQLite privada. No solicita operaciones a IBKR, no abre una conexión Live y no escribe en Airtable. La API solo ofrece `GET /api/v1/real-trades/diagnostics` con el token local habitual; no ofrece endpoint de importación ni filas financieras. El CLI `real-trades:import` es el único disparador.

Se inspeccionaron `schema.ts`, `db.ts`, las migraciones Drizzle, la tabla `broker_executions` y su consumidor en `server.ts`, los servicios 41N/41O, el adaptador IBKR Paper y las rutas/contratos existentes. `broker_executions` exige `conId` y recibe snapshots del agente Paper; modificarla para aceptar Real o contratos incompletos alteraría ese flujo. La migración `0004_real_trade_ingestion.sql` crea tablas separadas `real_trade_executions`, `real_trade_versions`, `real_trade_provenance`, `real_trade_rejections` y `real_trade_import_runs`. No cambia ni borra tablas anteriores. Las transacciones SQLite serializan la decisión y escritura de cada versión. Las bases existentes se migran al abrirlas; conviene respaldar el SQLite privado antes de la primera ejecución.

## Procedencia y contrato de campos

El esquema de Airtable se inspeccionó por la conexión de ChatGPT el 2 de noviembre de 2026: base `appRLKun7tUrD1eI2`, tabla `Ejecuciones IBKR` (`tblBNg4SGpUKuKQ6j`). La selección `Lado` admite `BUY`/`SELL` y `Instrumento` admite `OPT`/`STK`/`OTRO`. **Eso no autentica el servidor local ni verifica la cobertura del historial.** El PAT local necesita acceso a esa base y el permiso mínimo de lectura de registros (`data.records:read`); no se requieren permisos de escritura. Configure el nombre o ID real de tabla en `TRADING_POC_AIRTABLE_EXECUTIONS_TABLE`. Los nombres siguientes son los vistos en el esquema; un JSON de mapeo puede sustituirlos si cambian, sin modificar código.

| Campo interno | Campo Airtable | Regla |
| --- | --- | --- |
| `executionId` | `ID ejecucion` | Obligatorio; identidad externa junto con entorno y alias. |
| `executedAtUtc` | `Fecha y hora` | Obligatorio, ISO 8601 con zona; se normaliza a UTC y deriva hora de Nueva York con offset explícito EST/EDT. |
| `asset` | `Activo` | Obligatorio. |
| `side` | `Lado` | Obligatorio, `BUY` o `SELL`. |
| `quantity` | `Cantidad` | Decimal positivo obligatorio. |
| `unitPrice` | `Prima USD` | Decimal no negativo si existe; si falta queda `null` e identidad económica incompleta. |
| `contract`, `instrument` | `Contrato`, `Instrumento` | Opcionales, texto descriptivo; no establecen identidad contractual. |
| `grossAmount`, `commission`, `reportedRealizedPnl` | `Importe bruto USD`, `Comision USD`, `PnL realizado IBKR USD` | Opcionales; ausentes son `null`, nunca cero inventado. PnL reportado no es PnL neto recalculado. |
| `orderId`, `sourceOriginal` | `ID orden IBKR`, `Origen` | Opcionales. |
| `conId`, `multiplier`, `currency` | Sin campo propio en la tabla observada | `conId` y multiplicador quedan `null`; moneda predeterminada USD solo porque los campos monetarios de esta tabla se denominan USD. CSV/JSON puede mapear columnas explícitas. |
| ID de registro | ID `rec...` de la API; columna opcional `ID registro Airtable` en CSV | Se preserva en procedencia. El `createdTime` opcional de Airtable se valida, pero no reemplaza la hora de ejecución ni la de importación. |

El importe monetario se almacena como cadena decimal de hasta ocho decimales, sin multiplicaciones de punto flotante ni conversiones de divisas. Un `conId` ausente produce `INCOMPLETE_CONTRACT`; un precio ausente produce `INCOMPLETE_PRICE`; ambos faltantes, `INCOMPLETE_CONTRACT_AND_PRICE`. La descripción del contrato jamás se convierte en `conId`. No se inventan comisiones, lotes, fills ni identificadores de cuenta. La tabla fuente está dedicada a **Real Primary**; cualquier importación CSV/JSON debe ser una exportación de esa cuenta. La separación SQLite impide que sus IDs coincidentes alteren snapshots Paper. Este importador no verifica por sí solo que una exportación proporcionada manualmente pertenezca a la cuenta correcta: el operador debe confirmar su procedencia antes de importar. Una fila que declare explícitamente otro entorno o cuenta se rechaza.

## Identidad, versiones y conciliación

La identidad financiera es `REAL + Primary + executionId`. Una segunda fila idéntica no crea otra versión y puede añadir procedencia. Una modificación del mismo registro recibido **por la API Airtable, con ID `rec...` estable y sin cambio de `executionId`**, crea `REVISION`; la versión previa permanece. Dos registros de origen diferentes con la misma identidad y contenido distinto crean `CONFLICT` y **no** sustituyen la versión principal. Una exportación CSV/JSON sin identidad de origen verificable no acredita una revisión: si cambia el contenido del mismo ID de ejecución, se marca conflicto. Los rechazos conservan hashes de fuente y contenido, y un código acotado, sin guardar la fila cruda. Fills parciales con IDs de ejecución diferentes permanecen separados, aun si comparten orden o contrato.

Si el mismo ID explícito de registro Airtable aparece con un **nuevo `executionId`**, la importación registra `IDENTITY_CONFLICT` como versión de evidencia bajo la primera identidad financiera observada, mantiene su `latest_version_id` sin cambios y marca la ejecución para conciliación. **No crea una segunda ejecución** ni reasigna automáticamente la anterior. Reimportar el mismo contenido no duplica la evidencia. Un ID `rec...` declarado en CSV/JSON basta para bloquear una duplicación potencial, pero solo una respuesta autenticada por la API Airtable permite tratar una corrección ordinaria como revisión verificada. Los identificadores `execution:<id>` derivados cuando un CSV carece de ID de registro son sintéticos y no se usan para enlazar cambios de `executionId`. La resolución requiere revisar la fuente externa y efectuar una conciliación explícita fuera de este importador; no hay fusión ni eliminación automática. Si una base privada anterior ya contiene dos identidades creadas antes de esta corrección, ambas se preservan y se señalan como conflicto al volver a importar ese registro.

Cada lote guarda inicio, última actividad, PID local, fin, fuente, recibidos, insertados, sin cambios, revisados, conflictos, rechazados, código de error y fechas mínima/máxima observadas. La migración `0005` añade las columnas de actividad y PID sin alterar lotes anteriores. `SUCCESS_COVERAGE_UNVERIFIED` significa que el lote terminó, no que IBKR esté conciliado. `PARTIAL_COVERAGE_UNVERIFIED` y `FAILED` conservan lo insertado antes de un error capturado. Una terminación inesperada deja el estado persistido `RUNNING`, sin `finishedAtUtc`; **no se convierte en éxito ni se reescribe**. El diagnóstico deriva `activity: ACTIVE` solo con actividad en los últimos cinco minutos y proceso existente; `INTERRUPTED` indica ausencia del proceso, actividad vencida o falta de datos de actividad de un lote anterior. Cuenta esos lotes aunque una importación posterior termine. `UNKNOWN` indica reloj incoherente, estado persistido incoherente o imposibilidad de comprobar el PID. Es una observación operacional, no una garantía frente a reutilización inmediata de PID ni a una operación bloqueada. No existe recuperación automática; el operador revisa la fuente y repite la importación idempotente. `coverage=UNVERIFIED` permanece hasta obtener una fuente independiente de completitud. No se reconstruye patrimonio histórico con saldos actuales.

## Configuración y comandos Windows

En `.env.local` (ignorado por Git) configure `TRADING_POC_AIRTABLE_TOKEN`, `TRADING_POC_AIRTABLE_BASE_ID=appRLKun7tUrD1eI2`, y opcionalmente `TRADING_POC_AIRTABLE_EXECUTIONS_TABLE=Ejecuciones IBKR`, `TRADING_POC_AIRTABLE_TIMEOUT_MS=10000` y `TRADING_POC_AIRTABLE_FIELD_MAP_JSON={"executionId":"ID ejecucion"}`. El mapeo JSON solo acepta claves internas conocidas. API y CLI comparten `TRADING_POC_PRIVATE_DIR` o el directorio privado predeterminado de la aplicación. Puede fijar `TRADING_POC_DB_PATH` para probar una base privada aislada.

```powershell
npm.cmd run real-trades:import -- status
npm.cmd run real-trades:import -- airtable
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Trading-POC\real-trades\imports"
Copy-Item .\mi-exportacion.csv "$env:LOCALAPPDATA\Trading-POC\real-trades\imports\ejecuciones.csv"
npm.cmd run real-trades:import -- file "$env:LOCALAPPDATA\Trading-POC\real-trades\imports\ejecuciones.csv" --confirm-real-primary
```

Para JSON se acepta un arreglo de objetos planos con los nombres de campos o de objetos `{ "id": "rec...", "fields": { ... } }`. Un CSV utiliza encabezados equivalentes, pero puede no incluir el ID interno de Airtable ni todas las columnas opcionales. La opción obligatoria `--confirm-real-primary` registra una afirmación explícita del operador sobre la procedencia del archivo; **no** la verifica criptográficamente. El CLI solo admite archivos dentro de `<directorio privado>/real-trades/imports`, verifica la ruta física para bloquear enlaces o rutas externas y limita cada archivo a 5 MiB y 10 000 registros. La API de Airtable pagina de a 100 hasta 10 000 registros; ante 429 espera antes de reintentar, con tres intentos y timeout por solicitud limitado. Los errores públicos son códigos sin respuestas HTTP crudas ni tokens. Si una importación falla, examine `status`, corrija la causa y repita el mismo comando: la base conservará filas y versiones ya insertadas.

## Seguridad y límites

El token queda únicamente en `.env.local` o en variables del proceso; la conexión de Airtable de ChatGPT no se transfiere al servidor. `.env.*`, `private/`, `*.sqlite` y `*.sqlite-*` están ignorados por Git. No se añaden órdenes, conexiones IBKR Live, dashboard financiero, análisis Investep ni vínculos automáticos con señales/modelos. Los datos Real no entran en `broker_executions`, `trade_lots`, simulador 41M ni ledgers prospectivos.

Quedan pendientes pruebas con respuesta auténtica de la API local y reconciliación de completitud contra un extracto oficial de IBKR Real. La cuenta Paper nunca se usa para inferir faltantes Real. La exportación CSV puede omitir IDs y datos presentes en la API; su cobertura es indeterminada. La API de Airtable expone paginación por `offset` y hasta 100 filas por página; sus [límites oficiales](https://support.airtable.com/articles/6292134965-getting-started-with-airtable-s-web-api) y [política de 429](https://support.airtable.com/articles/7735693959-Managing-API-call-limits-in-Airtable) motivan el presupuesto y los reintentos. Las pruebas automatizadas son sintéticas; no acreditan haber importado operaciones reales.
