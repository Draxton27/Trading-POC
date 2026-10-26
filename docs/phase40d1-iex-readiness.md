# Fase 40D1: diagnóstico IEX prospectivo

## Arquitectura comprobada

La tarea Windows `Trading-POC Daily Research` ejecuta `scripts/daily-orchestrator.ts --once`. Este mismo orquestador conserva la coordinación de SIP, evaluación y noticias. `scripts/iex-daily.ts` inicia el recolector IEX como hijo propio durante la ventana oficial y reutiliza un recolector manual si su bloqueo ya está activo. Lee primeras versiones completas de velas Live de 15 minutos; llama al observador de Fase 38F solo para una vela nueva, recibida en esta ejecución, posterior a la última desconexión y con recepción no mayor a 15 minutos. El observador vuelve a validar datos, calendario, modelo, continuidad, horizonte y frescura antes de anexar una predicción. Las evaluaciones vencidas se procesan aun cuando no haya nueva vela apta. El diagnóstico nuevo **no ejecuta** ninguno de estos procesos.

`npm.cmd run iex:doctor` lee la configuración local, la tarea, el calendario oficial guardado, las cadenas SHA-256 de ambos ledgers, el manifiesto del modelo y, si se configuró, el registro REST de calentamiento. Comprueba las primeras versiones de cada vela de 15 minutos contra sus 15 minutos IEX ya recibidos, revisiones posteriores, horas y continuidad mediante las funciones de Fase 23. Los registros REST solo sirven para indicadores; nunca se convierten en predicciones Live. Un modelo íntegro no demuestra que la vela actual sea elegible.

El comando no hace consultas Alpaca, no inicia Ollama, Python de inferencia, el recolector o la tarea, ni escribe archivos por defecto. Para verificar la instalación de Python invoca una comprobación local de versión e importación de XGBoost, sin cargar el modelo ni entrenarlo. Los códigos públicos y el reporte omiten rutas privadas, cuentas, credenciales y filas de los ledgers. Las ausencias de `daily-status.json` y `observations.jsonl` se muestran como `ABSENT`; no se llaman errores comprobados. La API existente añade `stateFile: ABSENT | VALID | INVALID | READ_ERROR` y muestra `STATE_ABSENT` cuando aún no existe el estado.

## Resultado local de solo lectura, 24 de octubre de 2026

| Componente | Resultado comprobado |
|---|---|
| Node / tsx | Node 24.20.0 y tsx disponibles. |
| `.env.local` / Alpaca | Archivo presente; ambas variables de credenciales presentes. No se probaron permisos de red en esta auditoría. |
| Python | 3.12.4 y XGBoost 2.1.4 disponibles en el intérprete configurado. |
| Modelo Fase 38F | `freeze.json` y `model.json` concordantes; SHA-256 `b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684`; IEX/raw, diez variables originales, clases ALCISTA/BAJISTA/LATERAL y fechas válidas. No se usaron modelos de Fase 40. |
| Tarea Windows | `Get-ScheduledTask` no encontró `Trading-POC Daily Research`. `daily-task.ps1 status` tampoco mostró tarea. No hay siguiente ni última ejecución verificable. La directiva PowerShell local bloquea invocar directamente el `.ps1` sin firma; el mismo `status` de solo lectura funcionó con `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`. No se instaló ni inició tarea. |
| Zona horaria Windows | `Central America Standard Time` (UTC−6). En esta zona, la apertura NYSE del lunes 26/10/2026 será 07:30; una tarea a las 06:00 comenzaría 90 minutos antes. No se puede validar su acción real mientras no exista. |
| Calendario / IEX Live | Calendario privado con seis sesiones; ledger íntegro, sin desconexiones ni revisiones registradas. Existen 24 primeras velas de 15 minutos del viernes 23/10, cada una respaldada por sus 15 minutos. Faltan las dos primeras velas de esa sesión: no se interpretan como minutos sin transacciones. |
| Continuidad / warmup | Las 24 velas recientes forman un sufijo causal continuo y permiten calcular las variables a la última vela. El snapshot REST registrado es íntegro y tiene 15.246 velas, pero **no conecta** con ese sufijo Live debido al inicio incompleto del viernes. No se afirma equivalencia EMA a través de ese hueco. El observador reinicia el segmento en la continuidad verificable, como Fase 23. |
| Predicción / evaluación | No existe ledger prospectivo local, por lo que hay cero predicciones y evaluaciones verificables. La última vela del viernes está obsoleta para una decisión el sábado. El estado IEX privado existe y muestra `STOPPED/NONE/STALE_LIVE_DATA`, sin error de ejecución registrado. |

Estado global local: **`BLOCKED_AUTOMATION`** por tarea ausente. El modelo y los datos almacenados son verificables; ello no demuestra que la próxima conexión, la captura del lunes, una predicción o una evaluación funcionen. El histórico examinado y los tests sintéticos tampoco demuestran calidad predictiva.

## Continuidad y disponibilidad

El diagnóstico verifica la cadena de hashes y la secuencia de recepción, separa primeras versiones de revisiones, verifica identidad NVDA/IEX/raw, exige 15 minutos observados para cada vela estricta y calcula el sufijo continuo con `phase23ContinuousSuffix()` y `calculatePhase23Features()`. También informa `MISSING_FIRST`, `MISSING_CLOSE`, `INTRADAY_GAP`, `PARTIAL_IN_PROGRESS` o `COMPLETE` para la última sesión. La continuidad de viernes a lunes usa el calendario oficial, que incorpora días festivos, cierres anticipados y cambios EDT/EST. Contar 21 velas en todo el archivo no basta.

`TRADING_POC_IEX_WARMUP_REGISTRY` es opcional. Si falta y la historia Live aún no reúne 21 velas continuas, el diagnóstico informa `WARMUP_RECOMMENDED`; no registra un snapshot automáticamente. Si se dispone de un histórico IEX raw verificado, su registro sigue siendo **explícito** con `npm.cmd run ml:iex:warmup -- --source <carpeta-historica-verificada> --out <registro-privado-nuevo>`. Un snapshot registrado después de la vela candidata, alterado o que contenga velas posteriores a su registro no se admite. Un snapshot íntegro puede no conectar con el Live; el diagnóstico lo distingue.

La última vela guardada actualmente no es oportunidad actual. Para una futura vela se verifican por separado primera versión Live, recepción en la ejecución actual, ausencia de desconexión posterior, máximo 15 minutos desde recepción, modelo congelado antes de la vela, disponibilidad de indicadores y una apertura programada posterior a la decisión con cuatro velas hasta el cierre. `HORIZON_INELIGIBLE` al final de sesión es un estado normal, no una falla de Python. `NO_LIVE_DATA` fuera de horario no es una señal LATERAL.

## Evaluaciones

El ledger prospectivo es append-only. El diagnóstico cuenta predicciones, horizontes aún no vencidos, evaluaciones vencidas pendientes y los estados `EVALUATED`, `MISSING_ENTRY` y `MISSING_OUTCOME` por separado. Comprueba integridad de cadena, unicidad de predicción y evaluación, referencia a una predicción real y que una evaluación completa incluya las referencias observadas de entrada y desenlace. Una evaluación de datos faltantes no se presenta como resultado de mercado. Las probabilidades originales no se recalculan ni se modifican. En el entorno local todavía no hay evaluaciones reales para inspeccionar.

## Uso seguro en Windows

Desde la raíz del repositorio:

```powershell
npm.cmd run iex:doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\daily-task.ps1 status
Get-ScheduledTaskInfo -TaskName 'Trading-POC Daily Research' -ErrorAction SilentlyContinue |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

La opción explícita `npm.cmd run iex:doctor -- --output-dir <carpeta-privada-nueva>` genera `report.json`, `report.md` y `SHA256SUMS` dentro de `TRADING_POC_PRIVATE_DIR` o del directorio privado predeterminado de `%LOCALAPPDATA%\Trading-POC`. Rechaza destinos existentes y rutas fuera de ese directorio. El diagnóstico normal no genera reportes. Si la tarea no está instalada, su instalación futura requiere la acción explícita del operador documentada en [daily-automation.md](daily-automation.md); este PR no la instala.

`taskCurrentState` informa por separado el estado de `Get-ScheduledTask` (`READY`, `RUNNING`, `DISABLED` o `QUEUED`). `taskResultCode` interpreta el valor original de `LastTaskResult`: `0` es éxito de una ejecución completada; `267008` (`0x00041300`, `SCHED_S_TASK_READY`) y `267009` (`0x00041301`, `SCHED_S_TASK_RUNNING`) son estados informativos. En estos dos casos `taskLastResult` indica `NO_COMPLETED_RESULT`, sin atribuirles un fallo ni inventar el resultado de una ejecución previa. Los códigos de error reconocibles se distinguen de los códigos desconocidos. Los diagnósticos conservan el número original en decimal y hexadecimal para auditoría. La traducción no cambia el disparador, la tarea ni el recolector.

## Verificación del lunes 26 de octubre de 2026

1. **Antes de las 07:30 de Nicaragua:** volver a ejecutar `iex:doctor`; comprobar existencia y acción de la tarea, `StartWhenAvailable`, `IgnoreNew`, inicio 06:00 en la zona horaria efectiva, siguiente/última ejecución, coordinador activo, recolector conectado o bloqueo explícito, hash del modelo y continuidad. Si la tarea sigue ausente, no afirmar automatización. Una tarea `Ready` indica que espera su disparador, no que ya generó predicciones.
2. **Durante la sesión:** comprobar nuevas barras IEX de un minuto con recepción real, velas estrictas completas de 15 minutos y primeras versiones conservadas; observar estados `NO_LIVE_DATA`, `INDICATORS_INSUFFICIENT`, `HORIZON_INELIGIBLE`, `RECORDED` o errores concretos. Una predicción válida debe quedar registrada antes de su desenlace y no se puede fabricar con datos REST o velas anteriores al arranque.
3. **Después del horizonte:** comprobar evaluaciones `EVALUATED` frente a `MISSING_ENTRY` y `MISSING_OUTCOME`, integridad SHA-256, ausencia de duplicados y resumen diario. La falta de una oportunidad temporal y de cobertura válida puede producir cero predicciones sin significar una falla del modelo.

No ejecutar `daily:run`, `iex:collect` ni `ml:iex:observe` durante el diagnóstico. Los archivos privados, secretos, modelos y ledgers no se incluyen en el PR. La auditoría valida estructura y consistencia local; no prueba autenticidad de origen de cada dato ni accesibilidad futura de Alpaca. La sesión del lunes y sus resultados siguen pendientes de observación.

## Validación del PR

Las pruebas usan archivos y relojes sintéticos temporales, sin credenciales ni Programador de tareas real. Cubren configuración de tarea, zona, modelo, estado ausente o inválido, integridad y revisiones, continuidad, DST, frescura, horizonte, duplicados, los tres estados de evaluación y ausencia de escrituras. `npm.cmd run typecheck` y `npm.cmd run build` aprobaron. Una primera ejecución paralela de `npm.cmd test` tuvo un timeout de cinco segundos en una prueba del asistente sin relación con IEX; la misma prueba aislada aprobó, y la repetición secuencial de la suite aprobó con 285 pruebas Vitest y 182 pruebas históricas. La CI Windows Node 22/24 ejecuta esta suite mediante `npm test`; el job Python 3.12 conserva sus pruebas existentes. Registrar el resultado efectivo de la CI en el PR, sin confundir una ejecución pendiente con aprobación.
