# Auditoría de dependencias — 2026-10-19 UTC

Consultadas versiones estables de npm, engines, licencias y actividad antes de instalar. Versiones exactas en cada package.json y package-lock.json. Node objetivo >=22.16.0; entorno de prueba Linux Node 24.19.0. No se usa latest flotante.

| Función | Paquete fijado | Licencia | Evaluación |
|---|---|---|---|
| UI | react/react-dom 19.3.1 | MIT | Mantenidos; tipos React 19 |
| Build | vite 8.3.4 | MIT | Node >=20.19/22.12; build correcto |
| Estilos | tailwindcss 4.3.3 | MIT | Plugin Vite oficial; componentes estilo shadcn locales |
| Gráfico | klinecharts 10.1.0 | Apache-2.0 | API v10 setDataLoader/indicators/overlays comprobada con Chromium |
| Datos | @tanstack/react-query 5.104.4 | MIT | Caché y peticiones cliente |
| Formularios | react-hook-form 7.90.0, zod 4.6.7 | MIT | Tipos estrictos y esquemas compartidos |
| API | fastify 5.12.7, @fastify/websocket 11.3.4 | MIT | HTTP/WS separados |
| TWS | @stoqey/ib 1.6.12 | MIT | Publicado 2026-10-02; tipos disponibles; handshake real pendiente |
| Almacenamiento | better-sqlite3 13.0.3 | MIT | Engines Node >=22; módulo nativo instalado en Linux; Windows CI pendiente |
| ORM | drizzle-orm 0.45.4, drizzle-kit 0.31.11 | Apache-2.0 / MIT | Migraciones reproducibles |
| Pruebas | vitest 5.0.5, @playwright/test 1.64.1 | MIT / Apache-2.0 | 15 unitarias nuevas, 4 navegador |

Se revisó la cadena transitiva mediante npm audit. Resultado: 0 críticos, 0 altos, 4 moderados. Los cuatro pertenecen a drizzle-kit y su cadena de herramientas de desarrollo (@esbuild-kit/core-utils, @esbuild-kit/esm-loader, esbuild). Aviso de esbuild: GHSA-67mh-4wv8-2f99 sobre acceso a servidor de desarrollo antiguo; no se expone vite ni drizzle-kit a red. No se publica servidor dev. Se deberá actualizar drizzle-kit cuando exista corrección compatible. npm audit --omit=dev no detectó riesgo alto de runtime. No se instalaron paquetes beta o Python. La compatibilidad real de better-sqlite3 en Windows 10/11 se valida con el workflow Windows del PR, no con la prueba Linux.
