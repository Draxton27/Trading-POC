# Arquitectura implementada — Fase 19

Versión de código probada: 82c69d78e35c7de7317ecfa57b002db5879b8f1e. El protocolo inicial permanece en docs/phase19-architecture-decision.md, commit d59c9759f18cc7a9ef01057da1e2228e8503535d.

Computadora A: TWS Paper y agente sin navegador. El agente consulta a TWS solo por 127.0.0.1; comprueba nextValidId y la cuenta Paper esperada. Abre un WebSocket saliente hacia B. No conoce ni guarda la contraseña de IBKR. Computadora B: web React, API Fastify, SQLite privada y archivos de investigación. La API HTTP escucha solo en localhost. El receptor del agente escucha en una IP privada específica, por separado. Transporte inicial recomendado: Tailscale cifrado con política restringida, más secreto de aplicación.

El navegador habla con la API, nunca con TWS. Contratos Zod versionados residen en packages/contracts. El adaptador de investigación lee salidas y CSV locales de estudios anteriores sin copiar detectores. market-domain calcula indicadores de presentación; no sustituye los validadores históricos. El agente contiene el único import de @stoqey/ib. El protocolo permite únicamente solicitudes de lectura enumeradas.

DEMO ofrece barras y opciones deterministas sintéticas; no fabrica decisiones, operaciones, señales ni noticias. OFFLINE utiliza CSV SIP privados autorizados y derivados publicados. PAPER agrega consultas al agente; el histórico local continúa disponible si está instalado. No se ha realizado una sesión auténtica TWS ni una prueba física en dos equipos.

Persistencia: SQLite guarda proyecciones, cotizaciones, sesiones, ejecuciones y dibujos; el diario Fase 19 usa el ledger append-only de Fase 16 y el FIFO de Fase 17 conserva sus fuentes originales privadas. Ningún dato SIP u OPRA fuente se añade a este PR. Live no está implementado.
