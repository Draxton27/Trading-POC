# Limitaciones comprobadas y pendientes

- No hubo sesión auténtica TWS ni prueba A/B física. SDK, permisos Paper, feed OPRA/SIP, latencia y reconexión de producción siguen sin validar. El agente MOCK demuestra el protocolo, no la cuenta real.
- Windows real aún no se probó en una máquina del operador. El PR ejecutará npm ci, tipos, tests y build en windows-latest; requiere revisión del resultado de CI. better-sqlite3 usa módulo nativo.
- Flex de IBKR no tiene parser definitivo sin exportación auténtica anonimizada. El importador Fase 17 admite su formato CSV documentado, no archivos Flex arbitrarios.
- El gráfico inicial registra niveles horizontales de soporte/resistencia/zona; las zonas de dos precios, segmentos, anotaciones textuales, edición visual y vinculación directa de captura están modelados en API pero no completos en UI.
- Las barras OFFLINE requieren las fuentes SIP autorizadas locales; faltan en Git por licencia. PAPER no recupera automáticamente todos los históricos de TWS. Las ejecuciones TWS se exponen con hora cruda y UTC nulo hasta validar la zona exacta.
- Las tablas SQLite de proyección están migradas; no todas tienen flujo de escritura completo en esta versión. Las señales Fase 16 se consultan, pero el observador/settler siguen siendo comandos existentes, no se inician automáticamente desde la interfaz.
- La vista inicial de opciones limita la cadena a cinco contratos y no demuestra frescura, tamaño disponible ni capacidad de ejecución. No hay órdenes.
- La carga JS de producción ronda 646 KiB minificada, aviso Vite de chunk grande; dividir por ruta mejoraría inicio.
- npm audit registra cuatro moderados de drizzle-kit/herramientas de desarrollo. No se expone el servidor de desarrollo.
- Validadores antiguos validate:strategy, validate:ema9 y validate:volume no pudieron ejecutarse por ausencia de metadatos/CSV QQQ 5m en este entorno; unit tests respectivos sí pasaron.
