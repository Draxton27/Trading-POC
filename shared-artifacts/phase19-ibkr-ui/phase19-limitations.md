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

## Estado adicional tras revisión del PR #25

- Arranque local Windows Node 24 verificado por HTTP; el script de humo desde ruta con espacios verificó ambos servicios, pero este sandbox negó permisos de inspección/terminación de árboles de procesos. El Ctrl+C inyectado por la terminal de automatización tampoco completó el cierre; se liberaron los procesos de prueba manualmente. Resultado de GitHub Actions Windows Node 22/24 y Git Bash físico pendiente.
- Ticks delayed/frozen, permisos OPRA y mercado Paper auténtico siguen sin validar contra TWS. Solo hay fixtures sintéticos y agente MOCK. `marketTimestampUtc` es nulo si TWS no aporta hora verificable.
- En PAPER no se construyen velas a partir de ticks; el gráfico permanece sobre DEMO u OFFLINE local. La interrupción del agente borra las últimas cotizaciones en memoria; no se garantiza continuidad intradía.
- El formulario breve de diario no aporta evidencia de mercado observado; se clasifica `timing_unverified`. Las entradas F19 antiguas permanecen solo lectura. Para campos F17 completos se requiere CSV oficial y capturas privadas previamente importadas.
- El CSV de operaciones F17 no incluye multiplicador verificado. Sus resultados nominales ×100 no sirven para contratos ajustados sin cotejo; la interfaz oculta cifras de raíces OCC fuera de los tres símbolos conocidos, pero incluso una raíz normal requiere verificación del contrato. Timestamps crudos TWS siguen sin zona confirmada.
- Playwright local se ejecutó con Chrome instalado mediante `TRADING_POC_CHROMIUM_PATH`; el Chromium propio de Playwright no estaba descargado. Las capturas de esa ejecución se dirigieron a `test-results/`, sin sustituir las imágenes publicadas.
