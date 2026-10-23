# Automatización diaria local

En Windows, configure una vez `.env.local` con las credenciales privadas de Alpaca, `TRADING_POC_ML_RUN_DIR` y el Python 3.12 del experimento. Mantenga el equipo encendido y conectado. El orquestador usa el calendario oficial Alpaca para NVDA, consulta las velas SIP retrasadas y llama a los comandos existentes de recopilación y evaluación. Las noticias se recopilan de forma independiente; si Ollama no responde, su clasificación queda pendiente.

Desde PowerShell, en la raíz del repositorio:

```powershell
.\scripts\windows\daily-task.ps1 install
.\scripts\windows\daily-task.ps1 status
.\scripts\windows\daily-task.ps1 uninstall
```

La tarea se inicia cada día a las 06:00 **hora local del equipo** y permanece activa durante la sesión NYSE. Windows la inicia cuando vuelve a estar disponible tras un apagado o suspensión. El orquestador termina después de la última vela SIP retrasada y la evaluación disponible. `-MultipleInstances IgnoreNew` y el bloqueo existente de `ml:collect` impiden duplicados. El inicio del servidor web nunca instala una tarea.

Para una ejecución manual completa use `npm.cmd run daily:run -- --once`. El estado privado se escribe en `private/daily-automation/status.json`, o en `TRADING_POC_DAILY_STATUS`. La API GET `/api/v1/ml/daily-automation` publica únicamente códigos de error y recuentos, además del estado de instalación; no expone rutas, claves ni diagnósticos. El resumen muestra la última ejecución, la sesión, la siguiente sesión, velas, observaciones, evaluaciones y noticias.

La recopilación de noticias empieza antes de la primera consulta bursátil y se repite cada 15 minutos durante la sesión. Cada proveedor conserva su cooldown interno. La clasificación corre aparte, con una sola instancia a la vez; los artículos quedan almacenados si Ollama no responde y se vuelven a intentar en un ciclo posterior.

Tras una suspensión, se comparan las velas recibidas con las sesiones oficiales dentro de una ventana máxima de 30 días. Cada sesión incompleta se consulta por separado (máximo 26 velas regulares de 15 minutos frente al límite de 10.000 por respuesta). La ingesta histórica retrasada puede recuperar velas para evaluar observaciones ya registradas. Si la interrupción supera la ventana, el estado muestra `ML_CATCHUP_RANGE_EXCEEDED` y requiere una recuperación histórica revisada por el operador. El recolector conserva sus restricciones temporales y nunca convierte un backfill en una predicción adelantada al desenlace. No se modifican modelos ni registros anteriores.

La primera sesión almacenada también se compara desde su apertura oficial: una primera vela recibida después de las 09:30 no oculta las velas previas faltantes. Las consultas recuperadas conservan la hora efectiva de recepción del proveedor y no llaman al observador XGBoost.

## IEX Live y observaciones de Fase 38F (Fase 38G)

La misma tarea `Trading-POC Daily Research` coordina ahora el recolector IEX. Comprueba su bloqueo antes de abrir una conexión: si el recolector manual está activo, lee su ledger y no lo termina. Si no lo está, inicia un hijo Node directo desde 90 minutos antes de la apertura NYSE hasta el cierre oficial. El hijo cierra la conexión al terminar la tarea; si el orquestador desaparece, el cierre de su tubería de control también lo detiene. Los fallos IEX se registran por código y no detienen SIP ni noticias. El calendario Alpaca determina festivos, horario EDT/EST y cierres anticipados.

Configure en `.env.local` las credenciales Alpaca existentes, `TRADING_POC_IEX_FROZEN_DIR` con la carpeta privada del modelo congelado de Fase 38F, y `PYTHON` con el ejecutable de Python 3.12 que tiene XGBoost. El modelo debe conservar SHA-256 `b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684`. Si se usa el calentamiento REST previo, configure `TRADING_POC_IEX_WARMUP_REGISTRY`. Las rutas opcionales `TRADING_POC_IEX_LEDGER`, `TRADING_POC_IEX_CALENDAR`, `TRADING_POC_IEX_OBSERVATION_LEDGER` y `TRADING_POC_IEX_AUTOMATION_STATUS` deben apuntar a archivos privados. No coloque secretos ni ledgers en Git.

El orquestador consulta el ledger cada minuto. Solo llama al observador cuando existe una nueva primera versión completa de una vela de 15 minutos, recibida durante la ejecución actual y después de la última desconexión, y su recepción tiene como máximo 15 minutos. Una revisión posterior no vuelve a emitir la predicción. El CLI conserva sus controles de calendario, continuidad, modelo, horizonte e idempotencia, y repite la frescura antes de escribir. Una desconexión, suspensión o reinicio no convierte velas antiguas en predicciones nuevas: `PREEXISTING_LIVE_DATA` identifica una vela anterior al arranque o a la última desconexión. Las evaluaciones pendientes se procesan tras `t+4` más 30 minutos, aun fuera de sesión o cuando no hay una nueva predicción. `MISSING_ENTRY` y `MISSING_OUTCOME` permanecen distintos de `EVALUATED`.

Para actualizar la tarea ya instalada, desde PowerShell en la raíz del repositorio:

Guarde primero estos valores en `.env.local`, usando las rutas absolutas locales reales (una línea por variable):

```dotenv
PYTHON=C:\ruta\Trading-POC\.venv\phase28-py312\Scripts\python.exe
TRADING_POC_IEX_FROZEN_DIR=C:\ruta\privada\modelo-iex-congelado
```

```powershell
npm.cmd ci
.\scripts\windows\daily-task.ps1 install
.\scripts\windows\daily-task.ps1 status
Get-ScheduledTaskInfo -TaskName 'Trading-POC Daily Research' | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

`install` actualiza la tarea con el mismo nombre; no instala una segunda ni detiene un recolector IEX manual. La tarea carga `.env.local` tras reiniciar Windows. Para comprobar el estado sin iniciar servicios, consulte `GET /api/v1/ml/iex-automation` en la API local o la sección IEX de Predicciones. El archivo completo queda en `TRADING_POC_IEX_AUTOMATION_STATUS` o en la carpeta privada `ml-iex/daily-status.json`. `npm.cmd run daily:run -- --once` ejecuta el ciclo diario completo cuando corresponde; el argumento es el modo del lanzador de la tarea y no una prueba puntual. Para quitar la tarea, use `.\scripts\windows\daily-task.ps1 uninstall`.

## Teardown E2E en Windows

El bloqueo observado tras 14 pruebas aprobadas se reprodujo con API todavía escuchando: el proceso `tsx watch` usado por `dev:api` había dejado vivo al servidor después de terminar su proceso intermedio. Quitar el proceso `npm run dev` del comando de Playwright no resolvió el caso. El launcher E2E inicia API con `node --import tsx` como hijo directo, conserva el inicio normal de `npm run dev` para uso diario y expone un cierre local protegido por un token generado para esa ejecución. `globalTeardown` solicita el cierre, espera la terminación de API y Vite y verifica sus puertos. Solo actúa sobre los hijos de esta instancia DEMO.
