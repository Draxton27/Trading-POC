# Fase 19 — decisión de arquitectura (antes de implementar)

Fecha de registro: 2026-10-19 UTC. Base: `main` en `231ce63` (PR #24 de Fase 18 fusionado). Esta decisión precede al código y a cualquier captura de la aplicación.

## Límite funcional y físico

Trading-POC será una herramienta privada de lectura, análisis y anotación. No habrá rutas HTTP, mensajes internos ni métodos públicos para enviar, modificar o cancelar órdenes. TWS Paper y el agente de solo lectura residirán en la computadora A; API, web, SQLite y estudios en la B. El agente conecta a TWS en `127.0.0.1` y abre una conexión **saliente** hacia una IP privada de B. Paper es el valor predeterminado, pero el puerto 7497 por sí solo no prueba la identidad de la cuenta. Live queda deshabilitado por defecto. La interfaz y API funcionan en DEMO sin TWS y en OFFLINE con datos locales autorizados.

## Responsabilidades

`packages/contracts`: esquemas Zod versionados y tipos compartidos; tiempos internos UTC. `packages/research-adapter`: traducción de CSV y salidas inmutables de estudios a recursos paginados, sin copiar detectores. `packages/market-domain`: proyecciones e indicadores incrementales para presentación; los cálculos históricos existentes siguen siendo la referencia de regresión. `apps/api`: Fastify 5, validación, almacenamiento privado, rutas de lectura, diario append-only, canal de navegador y canal autenticado separado del agente. `apps/ibkr-agent`: único consumidor de `@stoqey/ib`, interfaz reducida de consultas, cuotas de solicitudes y suscripciones, transporte autenticado y simulador determinista. `apps/web`: React/Vite en español; nunca habla directamente con TWS ni contiene secretos. SQLite/Drizzle es un índice privado y no reemplaza diarios originales.

Los módulos existentes `csv.ts`, `multitimeframe.ts`, `bollinger.ts`, `phase16-engine.ts`, `phase17-journal.ts`, `phase17-broker-store.ts` y `phase18-core.ts` tienen exportaciones reutilizables; son archivos TypeScript del paquete histórico, sin contrato de servicio estable. El adaptador limitará los imports a funciones verificadas. Los validadores y artefactos de Fases 9–18 no se alterarán.

## Fuentes y tiempo

DEMO usa datos sintéticos etiquetados. OFFLINE lee CSV SIP locales autorizados, metadatos y calendarios; no los publica. PAPER lee cotizaciones y operaciones disponibles en una sesión TWS autenticada por el usuario; no presupone que la API recupere todo el historial. Cada dato conserva fuente, feed, timestamp de mercado, recepción y estado live/delayed/frozen. Gráficos diarios y horarios solo incorporan velas cerradas al instante de observación. Datos faltantes permanecen faltantes. Los diarios humanos se anexan; una anotación posterior nunca se convierte en decisión previa.

## Librerías objetivo y criterios

Node >=22, TypeScript estricto y npm workspaces; React/Vite, Tailwind CSS, componentes de estilo shadcn/ui, lucide-react, KLineCharts 10, TanStack Query, react-hook-form/Zod; Fastify 5 y `@fastify/websocket`; `@stoqey/ib` aislado; SQLite con Drizzle y migraciones; Vitest y Playwright. Versiones exactas y lockfile. La auditoría de dependencias, licencias, seguridad y compatibilidad se publicará antes de instalar. No se introduce Python, Docker ni WSL. Los componentes shadcn/ui se incorporan como código local accesible, sin depender de un registro en ejecución.

## Amenazas, privacidad y red

Amenazas principales: exposición de TWS o API, suplantación del agente, comandos de orden inyectados, fuga de cuentas o secretos, confusión PAPER/LIVE, replay de mensajes, marcas temporales falsas y publicación de SIP/OPRA privados. Mitigaciones: TWS solo loopback y modo Read-Only; transporte privado cifrado recomendado Tailscale con ACL específica; secreto de aplicación independiente; identificadores de instalación/conexión, validación Zod, secuencia/idempotencia, lista cerrada de mensajes, límites de tamaño y frecuencia; API web ligada a localhost; protección de POST y WebSocket por origen y token local; registros de cuenta pseudonimizados; directorio privado fuera de Vite y Git. No se usa Tailscale Funnel ni reenvío público de puertos. La opción Read-Only de TWS es defensa adicional, no la única barrera.

## Etapas y verificación

1. Fundación: workspaces, contratos, API/UI y agente simulado; arranque Windows sin TWS.
2. Mercado: carga paginada NVDA/QQQ/SMH, KLineCharts, indicadores y dibujos manuales separados.
3. Operaciones/señales/diario: adaptadores existentes, anotaciones y proyecciones privadas.
4. Agente: consultas permitidas, estado de TWS, pacing y pruebas con mocks; sesión auténtica pendiente si no está disponible.
5. Transporte entre equipos: canal saliente autenticado, reconexión y simulaciones; prueba física posterior.
6. Integración: builds, tests, regresiones históricas, captura DEMO real y documentación Windows.

Un despliegue en servidor requerirá autenticación de usuarios, TLS, autorización, copias de seguridad y revisión de licencias antes de abrir acceso remoto. No se habilita en esta fase.
