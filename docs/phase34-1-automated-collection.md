# Fase 34.1: recolector coordinado Alpaca SIP y XGBoost

El comando `ml:collect` coordina la ingesta y `ml:observe` dentro de un solo proceso local. Solo consulta Market Data tras un intervalo oficial de 15 minutos cuyo cierre ya tiene al menos 20 minutos de antigüedad. Usa el calendario Alpaca, incluidos cambios de horario, festivos y cierres anticipados. Al iniciar fuera de esos instantes informa `MARKET_CLOSED` y espera al siguiente intervalo útil. Cada ciclo registra un estado atómico en `private/ml-collector/status.json`; la API solo lee `/api/v1/ml/collector`.

El calendario privado acumulativo y los ledgers existentes conservan sus hashes y revisiones. La ingesta es siempre NVDA, 15Min, SIP y `adjustment=split`. El observador mantiene las diez variables de Fase 23, la continuidad de EMA9, el modelo congelado y el límite estricto anterior al cierre de `t+4`. No hace backfill. Cuando falta historial continuo, un modelo válido o una vela nueva, no ejecuta Python. `PROSPECTIVE_CAPTURE` sigue bloqueado. El estado `RECORDED` solo describe investigación observacional; no es una señal ejecutable.

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
