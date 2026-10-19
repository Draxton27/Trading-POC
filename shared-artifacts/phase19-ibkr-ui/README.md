# Paquete de revisión de Fase 19

Aplicación privada de análisis en español; código probado en el commit 82c69d78e35c7de7317ecfa57b002db5879b8f1e. El protocolo inicial fue registrado primero en d59c9759f18cc7a9ef01057da1e2228e8503535d. Este paquete contiene documentación, resultados de pruebas y capturas reales de DEMO. No incluye CSV SIP/OPRA, bases SQLite ni credenciales.

| Archivo | Contenido |
|---|---|
| phase19-architecture.md | equipos A/B y límites de módulos |
| phase19-dependency-audit.md | versiones, licencias, compatibilidad y npm audit |
| phase19-repository-integration.md | funciones históricas reutilizadas y hashes fuente |
| phase19-ibkr-agent-report.md | adaptador de solo lectura y simulación |
| phase19-network-security.md | amenazas, red privada y autenticación |
| phase19-api-contracts.md | recursos HTTP/WS y esquemas compartidos |
| phase19-database-schema.md | SQLite, migraciones e identidad |
| phase19-ui-guide.md | navegación y límites visibles |
| phase19-windows-setup.md | instalación local y Paper A/B |
| phase19-future-deployment.md | medidas para futuro servidor privado |
| phase19-test-results.json | resultados reproducibles y pendientes |
| phase19-limitations.md | diferencias respecto al alcance deseado |
| phase19-report.md | informe en español |
| phase19-pr25-review-fixes.md | mapa de correcciones del PR #25 |
| phase19-windows-startup-fix.md | causa y pruebas del error `spawn EINVAL` |
| phase19-ibkr-tick-validation.md | códigos TWS y normalización por feed |
| phase19-indicator-equivalence.md | SMA/Bollinger entre motor y gráfico |
| phase19-historical-context-audit.md | niveles sin información futura |
| phase19-live-data-integration.md | circuito PAPER y prueba posterior |
| phase19-journal-compatibility.md | ledger F17, temporalidad y operaciones |
| phase19-pr25-regression-results.json | pruebas de la revisión, separadas del informe inicial |
| phase19-option-contracts-fix.md | timeout y contratos parciales; repetición exacta en Windows |
| phase19-option-contracts-results.json | resultados locales de esta corrección y verificaciones pendientes |
| phase19-demo-dashboard.png | captura Chromium de Inicio DEMO |
| phase19-demo-options.png | captura Chromium de Opciones DEMO |
| phase19-demo-journal.png | captura Chromium de Diario DEMO |
| SHA256SUMS.txt | hashes de todos los archivos anteriores y este README |

Reproducción desde la raíz del repositorio: npm ci; npm run typecheck; npm test; npm run build; npm run test:e2e. Esta última orden genera las tres capturas de DEMO en `test-results/phase19-smoke`, fuera de Git. Solo defina `TRADING_POC_SCREENSHOT_DIR=shared-artifacts/phase19-ibkr-ui` si desea reemplazar expresamente los PNG originales. En un Windows con Chrome instalado puede definir `TRADING_POC_CHROMIUM_PATH` si falta Chromium de Playwright. Para OFFLINE se requieren fuentes SIP locales autorizadas. La conexión TWS Paper auténtica no fue probada; el agente MOCK se etiqueta como simulado. Los resultados iniciales y las imágenes anteriores se conservan como evidencia del commit original.

Verificación de integridad: los hashes corresponden a los bytes publicados en Git. Ejecute `sha256sum -c SHA256SUMS.txt` sobre los archivos extraídos con `git archive` o en un checkout con `core.autocrlf=false`. En Windows, la conversión automática de LF a CRLF puede cambiar el hash del archivo de trabajo aunque el contenido versionado sea correcto. SHA256SUMS.txt no se incluye a sí mismo.
