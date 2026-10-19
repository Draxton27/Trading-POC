# Trading-POC · aplicación de análisis (Fase 19)

Aplicación privada en español para observar NVDA, QQQ y SMH, consultar estudios históricos, contratos de opciones y operaciones importadas, y registrar decisiones humanas. **No contiene funciones de envío, modificación o cancelación de órdenes.** Los detectores históricos y los resultados de Fases 9–18 permanecen en `trading_poc_001_bollinger/`.

## Inicio rápido en Windows 10/11

Instale Node.js 22 o posterior y ejecute en PowerShell desde este repositorio:

```powershell
npm ci
.\scripts\windows\Start-TradingPoc.ps1 -Mode DEMO
```

Abra `http://127.0.0.1:5173/` **en el mismo equipo**. DEMO usa datos deterministas y sintéticos. No requiere TWS, cuenta, secretos ni datos de mercado privados. `npm run dev`, `npm run dev:web`, `npm run dev:api`, `npm run dev:agent`, `npm run typecheck`, `npm test` y `npm run build` están disponibles desde la raíz. `npm run test:e2e` usa Chromium de Playwright.

Para OFFLINE, conserve los tres CSV SIP autorizados, sus metadatos y calendarios bajo `trading_poc_001_bollinger/data/`; inicie con `Start-TradingPoc.ps1 -Mode OFFLINE`. El CSV fuente nunca se sirve directamente. La API entrega páginas acotadas; las temporalidades horaria y diaria usan las funciones existentes de agregación y respetan velas completas.

Para Paper con dos computadoras, lea [la guía Windows](shared-artifacts/phase19-ibkr-ui/phase19-windows-setup.md) y [el modelo de red](shared-artifacts/phase19-ibkr-ui/phase19-network-security.md). La API HTTP escucha solo en `127.0.0.1`. El agente se ejecuta junto a TWS en A y sale hacia un puerto privado de B. Necesita un secreto de aplicación propio y una cuenta Paper esperada para comprobar la sesión. La conexión auténtica con TWS y la prueba física entre equipos **no se han verificado en Codex**.

Los datos privados se guardan fuera de Vite y se excluyen de Git. El diario Fase 19 es append-only; el almacén FIFO de Fase 17 conserva los archivos originales de operaciones. Las capturas publicadas en [artefactos](shared-artifacts/phase19-ibkr-ui/README.md) son de la aplicación real ejecutada en DEMO, con datos sintéticos.

## Estructura

- `apps/web`: React, KLineCharts 10 y formularios de decisión.
- `apps/api`: Fastify, SQLite/Drizzle, adaptadores de investigación y canal privado.
- `apps/ibkr-agent`: interfaz de consulta IBKR y transporte saliente autenticado.
- `packages/contracts`: esquemas Zod compartidos y versionados.
- `packages/research-adapter`: carga de datos y resultados anteriores sin copiar detectores.
- `docs/phase19-architecture-decision.md`: decisión registrada antes del código.

La documentación detalla los límites pendientes. Ningún resultado de investigación histórico se convierte aquí en recomendación de trading.
