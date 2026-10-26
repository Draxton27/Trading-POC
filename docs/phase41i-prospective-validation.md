# Fase 41I: protocolo prospectivo IEX

## Qué se congela

Esta fase **no entrena**. El modelo de referencia es el XGBoost IEX/raw de 38F con SHA-256 `b9bbece648544b39e1e4c4946933e4f4de2d65ec5094997938b25791cb1bb684`. Se verifican `model.json`, `linear.json`, `freeze.json` y `SHA256SUMS` antes de activar o informar. Se conservan las diez variables F0 en el mismo orden, NVDA, IEX, raw, 15 minutos, las clases ALCISTA/BAJISTA/LATERAL, argmax y ausencia de abstención probabilística. Las probabilidades de XGBoost, logística y frecuencia se guardan juntas en cada predicción 38F; ninguna variante de 41F se promueve aquí.

`ml/phase41i/protocol.json` es una **plantilla versionada**: los campos `created_at_utc`, `git_commit`, `model_frozen_at_utc` y `prospective_start_at_utc` son nulos hasta una activación explícita. La activación toma el reloj real del proceso y el commit real de Git. Publica atómicamente una copia privada de `protocol.json`, `activation.json`, `source-integrity.json` y `SHA256SUMS`. El SHA-256 de la copia privada es el identificador fijo del protocolo. `activation.json` conserva la hora, hashes y el estado y hash terminal del ledger 38F previo. Si el ledger no existe, declara `ABSENT` y cuenta cero. El directorio de activación existente se rechaza: no se reinicia ni se reemplaza el inicio de la cohorte.

El protocolo fija la puerta de revisión descriptiva en **60 sesiones con resultados evaluables, 20 etiquetas reales de cada clase y al menos 80 % de cobertura de velas completas exigibles** desde la activación. Esto no demuestra potencia estadística ni aptitud operativa. Para intervalos de incertidumbre se requieren al menos 20 sesiones y se remuestrean sesiones completas con los mismos índices en los tres modelos. Incluso entonces, la dependencia entre jornadas y los cambios prolongados de régimen pueden quedar fuera del bootstrap.

## Flujo causal y cobertura

### Corrección de cobertura del PR #68

El estado `RECORDED` enlazado a una predicción íntegra es terminal para la primera versión de la vela y el protocolo. La decisión se comprueba **dentro del bloqueo exclusivo** antes de agregar otro registro. El coordinador consulta el éxito persistido tras reiniciar y mantiene `ALREADY_PRESENT` como estado de observación, aunque la frescura operativa de esa vela pase a `STALE`. El observador consulta la predicción ya registrada antes de comprobar nuevamente la frescura; un fallo transitorio anterior aún puede recuperarse con un `RECORDED` causalmente válido. Los intentos fallidos previos permanecen intactos.

El reporte también acepta ledgers anteriores que contengan `RECORDED` seguido de `STALE_LIVE_DATA`: verifica la primera versión Live, el ID y hash de la predicción 38F y da precedencia al éxito. Informa por separado **decisiones registradas**, **candidatas únicas**, **velas admitidas**, **velas finalmente no admitidas** e **intentos fallidos anteriores a la recuperación**. Una vela admitida nunca integra las abstenciones finales; la cuenta de admitidas debe igualar la cohorte enlazada uno a uno. Una contradicción de hashes o enlaces invalida el reporte en vez de ajustar sus cifras.

La activación privada original `phase41i-prospective-protocol-v1` ocurrió el 25/10/2026 a las 19:56:54.006 UTC y registró `git_commit=412e38e829f9614f8957f1b3faf32fc56242c527`, que coincide con el código publicado entonces. El primer reporte v1 tenía **cero predicciones y cero evaluaciones**. Esta corrección cambia la política operativa de elegibilidad; por eso la ruta predeterminada nueva es `phase41i-prospective-protocol-v2`. Se activa solamente después del commit corregido, con reloj y commit reales, y genera reportes en un directorio privado nuevo. La v1 y sus artefactos no se sobrescriben ni se mezclan con la cohorte v2. El `schema` JSON sigue siendo v1 porque su estructura serializada no cambia; el commit y el SHA de la copia activada distinguen la versión operativa.

El único recolector Live sigue siendo 38A/38G. El coordinador diario conserva los bloqueos y llama al observador 38F. Tras la activación, una predicción entra en 41I solamente si la **primera versión completa** de su vela IEX Live empezó y fue recibida después del ancla. El observador conserva el máximo de 15 minutos desde la recepción, primera versión, calendario oficial, continuidad de indicadores, warmup REST anterior, modelo congelado antes de la vela, próxima apertura programada y cuatro velas completas restantes. Repite la comprobación de frescura justo antes de anexar. Una revisión posterior no cambia predicciones ni evaluaciones. Un CSV REST no puede convertirse en candidata Live.

La decisión de elegibilidad se escribe en `eligibility-ledger/` privado mediante el ledger existente de registros secuenciales, bloqueo exclusivo, archivo temporal y SHA encadenado. Un ID incorpora protocolo, hash de la primera vela y estado. Un polling repetido devuelve la primera decisión idéntica. Una falla transitoria puede tener un registro posterior de recuperación, sin borrar el primero. `RECORDED` enlaza el ID y hash del registro 38F. El reporte verifica ambos ledgers y el prefijo anterior a la activación; las predicciones previas permanecen fuera de la cohorte. `NO_LIVE_DATA` es estado operativo del coordinador, no una vela ficticia. Tras un reinicio, una vela anterior a la nueva ejecución no recibe una decisión retrospectiva. El coordinador sí registra `STALE_LIVE_DATA`, `FEED_DISCONNECTED` y errores de modelo para candidatas recibidas durante su ejecución.

La cobertura de mercado cuenta intervalos oficiales cerrados desde el ancla, sesiones programadas, sesiones con captura y primeras velas completas recibidas. Un intervalo no recibido es **falta de captura verificable**, jamás volumen cero ni ausencia comprobada de transacciones. La cobertura predictiva cuenta candidatas efectivamente examinadas, admitidas, predicciones enlazadas y abstenciones por motivo. Las sesiones sin tarea, desconexiones y velas no examinadas no se atribuyen artificialmente a un motivo de abstención individual. La evaluación distingue pendientes, vencidas sin evaluar, `EVALUATED`, `MISSING_ENTRY` y `MISSING_OUTCOME`. En `EVALUATED` se contrastan apertura, cuatro velas y cierre con las primeras versiones IEX y se verifica la etiqueta con el ATR original: la fórmula coincide con `NET_MOVE_4B_ATR05_V1` (desigualdad estricta). No se infieren `DOWN_TOUCH` ni `PERSISTENT_BEAR`.

Las métricas de los tres modelos usan exactamente los mismos IDs evaluados: Macro F1, balanced accuracy, matriz, precision/recall/F1 por clase, log loss, Brier, calibración descriptiva, ROC-AUC y average precision BAJISTA cuando son definibles. Si no hay clase BAJISTA y contraejemplos, AUC es `null`. La prevalencia BAJISTA se informa junto a average precision. Los estados son `NO_PROSPECTIVE_DATA`, `COLLECTING`, `INSUFFICIENT_EVIDENCE`, `DESCRIPTIVE_PROSPECTIVE_RESULTS` y `PROSPECTIVE_REVIEW_GATE_REACHED`. No hay métricas sintéticas en reportes reales.

## Diagnóstico local de solo lectura, 25 de octubre de 2026

`npm.cmd run iex:doctor` y `daily-task.ps1 status` se ejecutaron sin iniciar tarea, `daily:run` ni `iex:collect`. La tarea `Trading-POC Daily Research` **no está instalada**; por ello no existen argumentos, último resultado o próxima ejecución que inspeccionar. Windows usa `Central America Standard Time`; el próximo lunes oficial 26/10/2026 abre a las 07:30 locales. En EST abrirá a las 08:30 de Nicaragua. El disparador previsto de las 06:00 precede ambas aperturas por 90 y 150 minutos, respectivamente, y por eso no se cambió. El diagnóstico ahora calcula la apertura de la sesión oficial actual o siguiente con la zona horaria efectiva. Informa por separado `TASK_NOT_INSTALLED`, `TASK_MISCONFIGURED`, `TASK_READY`, `TASK_RUNNING`, `TIMEZONE_UNEXPECTED`, `MARKET_CALENDAR_UNAVAILABLE` y `MARKET_CLOSED`.

El modelo 38F, logística y sus manifiestos locales verificaron sus hashes. Python 3.12.4 y XGBoost 2.1.4 estaban disponibles. El calendario privado tenía seis sesiones oficiales; el ledger IEX era íntegro, con 24 velas completas verificadas de la sesión del 23/10 y dos velas iniciales faltantes, sin desconexiones ni revisiones. El warmup REST tenía 15.246 velas verificadas, pero **no conectaba** con la sesión Live incompleta; existe un sufijo Live continuo de 24 velas suficiente para el cálculo actual. El recolector estaba inactivo y el último estado privado era `STOPPED/NONE/STALE_LIVE_DATA`. El ledger prospectivo 38F aún no existía: cero predicciones y evaluaciones. El estado global fue `BLOCKED_AUTOMATION`. La presencia de credenciales en `.env.local` no demuestra permisos IEX actuales ni conexión futura.

## Operación en Windows

Desde la raíz del repositorio, con `.env.local` privado ya configurado para Alpaca, `TRADING_POC_IEX_FROZEN_DIR` apuntando al experimento 38F congelado y `PYTHON` al entorno Python 3.12 existente:

```powershell
npm.cmd run iex:doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\daily-task.ps1 status
npm.cmd run ml:iex:41i -- activate
npm.cmd run ml:iex:41i -- verify
npm.cmd run ml:iex:41i -- report
```

`activate` es una acción explícita e irreversible para esa versión; no acepta timestamps manuales. Debe ejecutarse tras el commit de código que se desea congelar. Los artefactos 41I se guardan por defecto en `private/ml-iex/` del repositorio, excluido de Git; `TRADING_POC_PRIVATE_DIR` puede trasladarlos. La ruta predeterminada del protocolo corregido es `phase41i-prospective-protocol-v2`; un override mediante `TRADING_POC_IEX_41I_PROTOCOL_DIR` debe apuntar también a un directorio **nuevo**, nunca al v1 anterior. El ledger IEX existente conserva su ruta configurada anterior en `%LOCALAPPDATA%` o mediante sus propias variables. El primer reporte v2 usa por defecto `phase41i-prospective-report-v2`; los reportes siguientes requieren `--out-dir` con **otro directorio nuevo**. `phase41i-prospective-report-v1` contiene el informe histórico inicial y no se sobrescribe. `verify` y `report` son de solo lectura para ledgers, broker y tarea. El reporte genera JSON, Markdown, manifiesto y SHA256SUMS sin imprimir rutas privadas. Los archivos privados se excluyen de Git.

Si la tarea sigue ausente, el operador puede instalarla **manualmente** cuando decida activar la automatización:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\daily-task.ps1 install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\daily-task.ps1 status
```

La instalación no ocurre al arrancar la aplicación, diagnosticar, activar el protocolo ni generar el reporte. El proceso diario original sigue coordinando SIP, evaluación y noticias; no se inicia otro WebSocket. Después de nuevas sesiones, volver a ejecutar `iex:doctor`, `ml:iex:41i -- verify` y generar otro reporte privado. Ante apagado, suspensión, huecos o reconexión, REST sirve solo para recuperación histórica/evaluación y para warmup causal registrado; nunca para fabricar predicciones pasadas. La falta de recepción IEX o de permisos debe conservarse como problema de infraestructura.

## Límites

La implementación y CI sintéticas prueban las reglas de ingeniería, no que Windows haya ejecutado la tarea ni que Alpaca entregue mañana un feed utilizable. En el momento del diagnóstico había **cero** predicciones prospectivas y ninguna métrica real. Un precio OHLC de referencia no es un fill. Los informes no conectan con IBKR, órdenes ni señales de opciones; las probabilidades permanecen experimentales y no calibradas para operación.
