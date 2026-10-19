# Auditoría de integración con el repositorio

Base: main en 231ce63, con PR #24 de Fase 18 fusionado. No se modificó ningún archivo de trading_poc_001_bollinger ni artefactos publicados de Fases 9–18.

Reutilización directa comprobada:
- csv.ts: carga y validación de CSV de 15 minutos, metadatos.
- alpaca-calendar.ts y multitimeframe.ts: calendario y agregación horaria/diaria, incluido último bloque abreviado.
- phase17-csv.ts: lectura de registros CSV publicados.
- phase17-broker-store.ts: importación privada de ejecuciones, deduplicación y FIFO entre archivos.
- phase16-ledger.ts: escritura y verificación de diario append-only.
- Artefactos Fases 14/15: eventos y señales de solo lectura.

Adaptadores necesarios: packages/research-adapter transforma las estructuras previas a MarketBar y páginas; market-domain presenta SMA/Bollinger para el gráfico; apps/api traduce consultas HTTP y rechaza entradas inválidas. El frontend no incluye detectores. No se reescribieron las seis familias congeladas. El CSV privado de cinco años permanece fuera de Git. Hash NVDA observado: 7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc. Hash QQQ observado: 962696cb57499ecf0991b1915975f5fe5725e7df7185654bfa4a2f71775eb2fb. Hash SMH observado: d517e4652e9f4e44c715b5580dd4fa6d303b0a9f3246169027d142b2aac0cb55.

Limitación: los módulos antiguos exportan funciones TypeScript sin API de servicio estable. La integración fija estos imports; futuras refactorizaciones requieren regresión. Los validadores antiguos de QQQ 5m no pueden ejecutarse aquí porque faltan sus metadatos/CSV originales. El lector OFFLINE necesita los tres conjuntos completos de CSV, metadatos y calendario.
