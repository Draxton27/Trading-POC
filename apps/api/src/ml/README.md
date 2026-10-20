# Panel experimental XGBoost (Fase 30)

La API lee únicamente cuatro archivos de un experimento local explícito: `report.json`, `model.json`, `exploratory_predictions.csv` y `reproduction.json`. `TRADING_POC_ML_RUN_DIR` selecciona exactamente una carpeta. Si falta, el estado es `NO_MODEL`; no se busca el experimento más reciente. Los archivos privados permanecen en `output/real/`, ignorado por Git.

En Windows, desde la raíz del repositorio, para probar el experimento local indicado:

```powershell
$env:TRADING_POC_ML_RUN_DIR = (Resolve-Path '.\trading_poc_001_bollinger\output\real\phase28-xgboost\20261020T134917Z-d22ccbc44e1e').Path
npm.cmd run dev:offline
```

Para conservar esta configuración entre reinicios, agregue a `.env.local` una sola línea `TRADING_POC_ML_RUN_DIR=<ruta absoluta de la carpeta resuelta>`. El archivo está ignorado por Git. El lanzador carga `.env.local` desde la raíz. Visite `http://127.0.0.1:5173` y abra **Predicciones**. En otra terminal, puede consultar `http://127.0.0.1:4300/api/v1/ml/status`, `/summary`, `/metrics` y `/predictions?symbol=NVDA&timeframe=15m&offset=0&limit=25`. El servicio responde solo para NVDA 15m y limita cada página a 100 filas.

El identificador de experimento deriva del SHA-256 de los cuatro archivos y la fecha del nombre del run. El lector comprueba tamaños, estructura, SHA declarado del dataset entre informe y reproducción, versión del modelo, clases, número de árboles, orden cronológico, límites y suma de probabilidades. No usa la ruta privada de `reproduction.json` para abrir otros archivos. El SHA del CSV original de Fase 23 se contrasta entre los dos manifiestos; para verificar nuevamente los bytes del CSV original se requiere ejecutar el validador de Fase 23 sobre su carpeta privada.

`report.json` puede contener predicciones fuera de muestra de desarrollo, pero la API solo expone métricas resumidas y páginas del CSV de evaluación exploratoria. La pantalla muestra siempre que las probabilidades no están calibradas para operar. No hay inferencia actual.
