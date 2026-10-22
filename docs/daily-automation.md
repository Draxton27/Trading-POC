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

Tras una suspensión, la ingesta histórica retrasada puede recuperar velas para evaluar observaciones ya registradas. El recolector conserva sus restricciones temporales y nunca convierte un backfill en una predicción adelantada al desenlace. No se modifican modelos ni registros anteriores.
