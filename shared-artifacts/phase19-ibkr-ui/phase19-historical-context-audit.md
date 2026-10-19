# Auditoría temporal de niveles previos

`GET /api/v1/market/context` exige `symbol` y `asOfUtc` explícito. La UI lo toma del final de la última vela mostrada o del instante UTC elegido para revisar una fecha antigua. En OFFLINE/PAPER se consulta el calendario Alpaca local del símbolo, se busca la última sesión bursátil anterior a la fecha de Nueva York de `asOfUtc` y se acepta solo su agregado diario completo cuyo `endUtc <= asOfUtc`. Si esa sesión no tiene barra completa, ambos niveles quedan nulos: no se salta silenciosamente a una sesión más antigua.

La respuesta incluye `sourceSessionNy`, `availableAtUtc` y `asOfUtc`. El calendario conoce festivos y cierres anticipados; una sesión abreviada completa es válida. DEMO usa las sesiones sintéticas observadas, sin pretender un calendario real. Las pruebas cubren lunes con viernes previo, feriado, cierre anticipado, primera sesión, agregado incompleto, sesión esperada ausente y operación situada años antes del final del dataset.

Los niveles son descriptivos y no se convierten en señales. El selector de fecha está rotulado UTC; no infiere la zona horaria del navegador. La revisión de operaciones no dibuja niveles si no se solicita un contexto para ese instante.
