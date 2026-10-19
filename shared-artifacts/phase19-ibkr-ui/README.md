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
| phase19-demo-dashboard.png | captura Chromium de Inicio DEMO |
| phase19-demo-options.png | captura Chromium de Opciones DEMO |
| phase19-demo-journal.png | captura Chromium de Diario DEMO |
| SHA256SUMS.txt | hashes de todos los archivos anteriores y este README |

Reproducción desde la raíz del repositorio: npm ci; npm run typecheck; npm test; npm run build; npm run test:e2e. Esta última orden vuelve a producir las tres capturas con la aplicación DEMO activa. Para Windows consulte phase19-windows-setup.md. Para OFFLINE se requieren fuentes SIP locales autorizadas. La conexión TWS Paper auténtica no fue probada; el agente MOCK se etiqueta como simulado.

Verificación de integridad: ejecutar sha256sum -c SHA256SUMS.txt desde este directorio en un entorno con sha256sum, o Get-FileHash por archivo en PowerShell. SHA256SUMS.txt no se incluye a sí mismo.
