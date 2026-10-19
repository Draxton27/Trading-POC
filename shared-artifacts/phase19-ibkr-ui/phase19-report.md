# Informe de entrega — Fase 19

Código probado: 82c69d78e35c7de7317ecfa57b002db5879b8f1e. La aplicación local en español inicia en DEMO sin TWS; usa datos deterministas sintéticos, KLineCharts 10, cuatro SMA, Bollinger, volumen, diario privado append-only y vistas de mercado, opciones, operaciones y señales. OFFLINE cargó los tres históricos Alpaca SIP autorizados sin publicarlos; el SHA-256 NVDA coincidió con 7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc. Las agregaciones respetan el código de investigación original. No se modificaron los estudios Fases 9–18.

API Fastify y SQLite Drizzle se ejecutan en B; el agente aislado @stoqey/ib en A solo consulta. El canal MOCK autenticado entre dos procesos respondió como PAPER SIMULADO, resolvió parámetros sintéticos y posiciones vacías; no constituye prueba de TWS real. Las cotizaciones conservan tipo de feed y recepción. Live no se acepta. No hay funciones de órdenes.

Validación: npm ci, npm run typecheck, npm test (15 nuevas + 168 históricas), npm run build y npm run test:e2e (4 pruebas Chromium) pasaron. Nueve validadores históricos de NVDA y Fases 11–15 pasaron; sus artefactos publicados se restauraron al hash original después de las ejecuciones de regresión. Tres validadores QQQ 5m carecen de archivos de entrada locales. npm audit: 0 altos/críticos, 4 moderados de cadena dev. El workflow Windows queda sujeto al PR.

Capturas de Inicio, Opciones y Diario se generaron desde Chromium con la aplicación DEMO activa. No representan una cuenta real. El alcance pendiente es prueba física Windows/TWS Paper, permisos de mercado reales, parser Flex auténtico y edición gráfica avanzada. Ningún resultado aquí demuestra rentabilidad o disponibilidad de datos OPRA.
