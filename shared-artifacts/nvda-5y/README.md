# Historial NVDA de cinco años

Este paquete reúne el CSV de NVDA de 15 minutos solicitado a Alpaca Market Data API, sus metadatos, calendario y procedencia. Incluye el archivo original de 12 meses y los informes de SMA y comparación histórica. El ZIP contiene los mismos 12 archivos de datos e informes que figuran por separado en este directorio. `SHA256SUMS.txt` permite verificar el paquete.

El nuevo historial cubre la solicitud UTC de 2021-10-17 a 2026-10-17 y contiene 32.510 velas en 1.255 sesiones completas. Las 6.497 velas del archivo original coinciden por timestamp y OHLCV. El estudio ampliado encontró 781 señales; la SMA 200 diaria está disponible en 657. De estas, 493 señales preceden la ventana original y 164 corresponden a fechas ya examinadas. Las 161 señales del estudio original siguen presentes; el historial extendido produce tres señales adicionales al inicio de esa ventana por contar con datos previos.

Para ejecutar el importador o reproducir los estudios en `trading_poc_001_bollinger`, copia los CSV y archivos contiguos de `data/` a `trading_poc_001_bollinger/data/`. Después ejecuta `npm run validate:nvda-sma-context -- data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv` y `npm run compare:nvda-history -- data/NVDA_ALPACA_SIP_15min_20211017_20261017.csv` desde esa carpeta. Los archivos de este paquete no contienen credenciales.

La comparación es retrospectiva. Las fechas del archivo original ya fueron examinadas y no constituyen validación independiente. Esta rama comparte los archivos para consulta; no fusiona el PR #12.
