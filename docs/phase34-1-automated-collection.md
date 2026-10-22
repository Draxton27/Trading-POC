# Fase 34.1: recolector coordinado Alpaca SIP y XGBoost

El comando `ml:collect` coordina la ingesta y `ml:observe` dentro de un solo proceso local. Solo consulta Market Data tras un intervalo oficial de 15 minutos cuyo cierre ya tiene al menos 20 minutos de antigüedad. Usa el calendario Alpaca, incluidos cambios de horario, festivos y cierres anticipados. Al iniciar fuera de esos instantes informa `MARKET_CLOSED` y espera al siguiente intervalo útil. Cada ciclo registra un estado atómico en `private/ml-collector/status.json`; la API solo lee `/api/v1/ml/collector`.

El calendario privado acumulativo y los ledgers existentes conservan sus hashes y revisiones. La ingesta es siempre NVDA, 15Min, SIP y `adjustment=split`. El observador mantiene las diez variables de Fase 23, la continuidad de EMA9, el modelo congelado y el límite estricto anterior al cierre de `t+4`. No hace backfill. Cuando falta historial continuo, un modelo válido o una vela nueva, no ejecuta Python. `PROSPECTIVE_CAPTURE` sigue bloqueado. El estado `RECORDED` solo describe investigación observacional; no es una señal ejecutable.

## Corrección del diagnóstico del 21 de octubre de 2026

El proceso registró 13 observaciones y después mostró varios `PYTHON_ERROR`. La revisión identificó que el observador rechazaba correctamente las velas cuyo horizonte t+4 salía de la sesión, pero el recolector transformaba toda salida no exitosa en un error genérico de Python. En la sesión regular del 21 de octubre (cierre 20:00 UTC), la vela que termina a las 19:00 UTC todavía es elegible; la que termina a las 19:15 UTC ya no lo es. El recolector comprueba esa condición con el calendario oficial antes de iniciar el observador y registra `HORIZON_INELIGIBLE`. La falla observada a las 18:00 UTC era de una vela elegible: el estado antiguo no conservó el código de salida ni la causa del subproceso, por lo que su origen preciso no puede recuperarse de ese registro. No se le atribuye al horizonte ni a Python sin evidencia adicional.

El observador ahora devuelve códigos estructurados: `PYTHON_ERROR`, `HORIZON_INELIGIBLE`, `INDICATORS_INSUFFICIENT`, `OUTCOME_PASSED`, `LEDGER_INVALID` y `MODEL_NOT_CONFIGURED`. Para fallas auténticas de Python, el recolector agrega hora, vela, código de salida, señal y causa acotada en `status.json.python.jsonl`, junto al estado privado configurado. Si `infer.py` termina con error y devuelve exactamente `{"error":"..."}` por stdout, se conserva solo ese campo tras redacción; en cualquier otro caso se usa stderr como alternativa. Se ocultan secretos de entorno conocidos y rutas locales. La API y la interfaz reciben solo el código de error; no reciben el diagnóstico técnico.

Solo las fallas explícitamente transitorias, como red, límite de solicitudes o un subproceso temporalmente ocupado, permiten hasta dos reintentos adicionales del mismo intervalo, con esperas crecientes de uno y dos minutos. Los errores deterministas y el tercer fallo transitorio esperan el siguiente instante oficial. Si no hay calendario futuro disponible, el proceso comprueba de nuevo como máximo una vez por hora. La evaluación de Fase 35 se ejecuta tras una ingesta nueva incluso si la última vela es `HORIZON_INELIGIBLE` o si la inferencia falla. Ningún ledger previo se modifica y el recolector no convierte velas tardías en observaciones prospectivas.

## Configuración Windows

Copie `.env.example` a `.env.local` en la raíz y configure una sola vez `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `TRADING_POC_ML_RUN_DIR` y `PYTHON` con la ruta absoluta a `.venv\phase28-py312\Scripts\python.exe`. Si el ledger o el modelo usan otras carpetas privadas, configure además `TRADING_POC_ALPACA_INGESTION_LOG`, `TRADING_POC_ALPACA_INGESTION_CALENDAR`, `TRADING_POC_ML_FORWARD_OBSERVATION_LOG` y `TRADING_POC_ML_COLLECTOR_STATUS`. Estas rutas y credenciales permanecen fuera de Git.

Desde la raíz del repositorio:

```powershell
npm.cmd run ml:collect -- --once
npm.cmd run ml:collect -- --continuous
```

`--once` sirve para diagnóstico. `--continuous` espera el próximo intervalo bursátil útil y se detiene con Ctrl+C. Solo se permite una instancia por archivo de estado; un bloqueo con PID ya terminado se recupera al reiniciar. Los errores de red o rate limit se reintentan con espera acotada. Un 401/403, un modelo ausente o un ledger inválido quedan visibles como estados específicos; las credenciales nunca se incluyen en el estado público.

Para usar el **Programador de tareas de Windows**, cree manualmente una tarea con el programa `npm.cmd`, argumentos `run ml:collect -- --continuous` y directorio de inicio igual a la raíz de Trading-POC. Configure su cuenta de usuario, inicio de sesión y reinicio ante fallo según sus necesidades. No cree dos tareas que apunten al mismo estado privado. La aplicación no instala ni modifica tareas del sistema.

La API y el panel muestran si el proceso está activo, el último ciclo, la última ingesta, la última vela, la última observación, la próxima consulta, el error y el total de observaciones nuevas. Si el archivo privado de estado se corrompe, el recolector no lo sobrescribe; se debe revisar antes de reiniciar. Si los historiales son insuficientes o el plan SIP no entrega velas con la demora requerida, no se genera predicción. Esta fase no evalúa rendimiento futuro; esa evaluación queda para Fase 35.
