# Validación del PR #32

## Investigación de las tres fallas E2E

La primera ejecución de la rama reportó 5/8 pruebas aprobadas. Las tres aserciones fallidas fueron:

| Prueba | Error observado |
| --- | --- |
| `tests/phase19-e2e/screenshots.spec.ts:8` | Se esperaba ver `SINTÉTICO` en Opciones. |
| `tests/phase19-e2e/web.spec.ts:28` | Se esperaban 5 casillas `Comparar contrato`; se recibieron 0. |
| `tests/phase19-e2e/web.spec.ts:61` | Se esperaban 5 filas en `tbody`; se recibió 1. |

No se conservaron los `trace.zip` ni las capturas de aquella ejecución: Playwright reemplazó el directorio temporal de resultados en las pruebas posteriores. Por ello no se atribuye una causa distinta a cada aserción basándose solo en su texto. La evidencia reproducible es que el servidor existente en `127.0.0.1:4300` respondía `mode=PAPER`, mientras el archivo `.env` local fijaba `TRADING_POC_MODE=PAPER`. La configuración anterior de Playwright usaba `reuseExistingServer: !process.env.CI` y el puerto web 5173. Cambiar `TRADING_POC_MODE` en el proceso de la prueba no cambiaba el modo de un servidor ya iniciado. Las aserciones DEMO se ejecutaron así contra una interfaz PAPER.

Se archivó el árbol limpio de `main` (`4198215b29e76689e8d5a667515e6d4df1f695d3`) fuera de Git, con las mismas dependencias y navegador Edge. Se iniciaron API y Vite DEMO de forma independiente, con puertos y bases SQLite privados distintos para cada revisión:

| Revisión | API / web | Resultado E2E |
| --- | --- | --- |
| `main` limpio | 46132 / 56132 | 8/8 aprobadas |
| PR #32 antes de estas correcciones | 46131 / 56131 | 8/8 aprobadas |

En esas condiciones equivalentes no se reprodujo ninguna de las tres fallas. Se clasifican como contaminación del entorno de prueba, no como regresiones demostradas del PR. Las capturas de las corridas correctas se generaron en `test-results/phase19-smoke/`, directorio ignorado por Git. La nueva configuración conserva captura y traza al fallar, usa puertos DEMO separados, prohíbe reutilizar un servidor salvo opción explícita y verifica `mode=DEMO` antes de las pruebas. No cambia aserciones para forzarlas a pasar.

## Huecos en indicadores

Antes se filtraban las velas `isComplete=false` y luego se calculaban SMA y Bollinger sobre las observaciones restantes. Eso podía unir dos segmentos separados por una vela ausente o incompleta, y una sesión bursátil entera sin datos pasaba inadvertida. La corrección valida el conjunto disponible al instante de consulta y construye una secuencia de inicios esperados mediante el calendario local cuando existe. Cada ausencia reinicia la ventana. Una sesión cerrada por feriado o fin de semana no introduce hueco; el cierre anticipado termina en su hora oficial. En DEMO o sin calendario, la política conservadora usa solo la sesión actual. Las fórmulas de `calculateIndicators()` permanecen intactas.

El resultado expone `continuity.policy`, `calendarAvailable` y `consecutiveBars`. Las métricas cuyo período ya no cabe después del último hueco son `null` y quedan marcadas `INCOMPLETE_WINDOW`. El cierre histórico conocido sigue visible aunque otras métricas no sean evaluables. Las comparaciones de dos activos aplican la misma regla a cada serie y se recalculan en el último cierre común. Las pruebas sintéticas cubren huecos intradía, velas incompletas, sesiones ausentes, cierres anticipados, horario de verano, historial desigual y exclusión de una vela futura inválida.

## Reproducción local aislada en Windows

Se necesitan tres consolas PowerShell desde la raíz del repositorio. Seleccionar dos puertos libres y un navegador Chromium o Edge instalado. No utilizar el `.env` PAPER existente para estos servicios.

API:

```powershell
$env:TRADING_POC_MODE='DEMO'
$env:TRADING_POC_API_PORT='14300'
$env:TRADING_POC_WEB_PORT='15173'
$env:TRADING_POC_AGENT_SECRET=''
$env:TRADING_POC_PRIVATE_DIR="$PWD\private\e2e-demo"
$env:TRADING_POC_DB_PATH="$PWD\private\e2e-demo\db.sqlite"
$env:TRADING_POC_PHASE17_PRIVATE_DIR="$PWD\private\e2e-demo\phase17"
npm.cmd run dev:api
```

Web:

```powershell
$env:TRADING_POC_MODE='DEMO'
$env:TRADING_POC_API_PORT='14300'
$env:TRADING_POC_WEB_PORT='15173'
npm.cmd run dev:web
```

Pruebas:

```powershell
$env:TRADING_POC_E2E_API_PORT='14300'
$env:TRADING_POC_E2E_WEB_PORT='15173'
$env:TRADING_POC_E2E_REUSE_DEMO='1'
$env:TRADING_POC_CHROMIUM_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm.cmd run test:e2e -- --reporter=line
```

La reutilización es optativa y únicamente debe usarse para estos servicios DEMO aislados. La comprobación de modo aborta si la API responde PAPER. Sin la opción de reutilización, Playwright intenta iniciar servicios nuevos en los puertos E2E; no se conecta silenciosamente a un servidor preexistente.

En este entorno Windows la variante en que Playwright inicia `npm run dev` por sí mismo agotó el tiempo de arranque del servidor web; no se contabiliza como ejecución E2E aprobada. La validación final usa las tres consolas anteriores, donde los dos servicios se iniciaron y cerraron por separado y el proceso de Playwright finalizó con código 0. Queda pendiente verificar ese arranque autogestionado en otro entorno o CI; el fallo no se oculta reutilizando PAPER.

## Corrección del selector de referencias documentales

La consulta «¿Qué rango óptimo tiene NVDA según la academia para el 17 de febrero de 2026?» ahora se reconoce antes de consultar Ollama y ejecuta solo la referencia académica local. La respuesta incluye la sección «Referencia documental», fecha y rango disponibles, además del estado calculado por el servicio existente. No convierte la fecha de referencia en vigencia ni interpreta ASK como precio de la acción. Si no hay referencia, se informa NONE; si hay registros contradictorios, se informa CONFLICT y no se muestra un rango evaluable.

El parser valida el calendario y admite fecha española con mes escrito, ISO y DD/MM/YYYY o MM/DD/YYYY cuando el orden puede determinarse. Rechaza fechas inexistentes, formatos numéricos ambiguos, mes/año sin día y más de una fecha distinta. Ante una consulta documental que el selector no pueda resolver, se devuelve HTTP 422 controlado; una herramienta educativa de Ollama no puede sustituirla. Las pruebas también confirman que las dos consultas técnicas de NVDA y NVDA/QQQ siguen resolviéndose localmente y que una explicación educativa legítima conserva su respuesta.

La prueba específica de asistente pasó 18/18. La suite E2E completa se ejecutó contra API y web en puertos 14300/15173, con base privada y ambos endpoints de salud verificados como DEMO: 8/8 aprobadas. Ollama real no se usó; este cambio no depende de su instalación.

## Resultados finales

- `npm test`: 114 pruebas de Vitest y 177 históricas, todas aprobadas. Esta corrección añade cuatro pruebas que cubren selección documental, fechas válidas e inválidas, ausencia y conflicto de referencias, y prevención de sustitución educativa, además de comprobar que las rutas técnica, comparativa y educativa siguen funcionando.
- `npm run typecheck`: aprobado para el monorepositorio y el POC histórico.
- `npm run build`: aprobado; Vite advierte que el paquete JavaScript principal supera 500 kB, aviso preexistente y ajeno a esta corrección.
- `npm run test:e2e` con API y web DEMO aislados: 8/8 aprobadas, incluidas las tres que habían fallado. El modo se verificó tanto directamente en la API como a través del proxy web.

Las pruebas sintéticas no usan datos de mercado reales ni credenciales. El resultado anterior de 8/8 contra `main` y la rama original se obtuvo con el mismo procedimiento de aislamiento antes de estas correcciones.
