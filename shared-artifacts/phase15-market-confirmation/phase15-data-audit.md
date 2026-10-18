# Auditoría de Fase 15

Protocolo previo: `docs/phase15-research-protocol.md` (commit `7ab491edb2c040b096213764ded69352cf593aad`). Código: `9ff477c9a141f8b324afa30318e9e154234e2a24`. Sin nuevas descargas.

- Señales F11/F12: 876/366; unión exacta F13/F14: 1242; identidad, desenlaces y controles: verificados.
- Grupos: {"concordance":650,"contradiction":289,"mixed":132,"missing":171}; elegibles a 30 minutos: {"concordance":560,"contradiction":261,"mixed":113,"missing":171}.
- Horizontes incompletos: 137; razones: {"session_close":137}. Repetidas: 154; resultados solapados: 50.
- Control original disponible en 971 señales. Calendario económico con timestamp verificado usado: 159.
- Soporte común: 92/381 estratos; 173/560 concordantes y 136/261 contradictorias. No se extrapoló fuera del soporte.
- Verificación temporal: `market_available_at_utc = signal_available_at_utc` para todas las señales; las cuatro velas concluyen a ese cierre. Noticias antes/después según timestamp verificado del mismo día.
- SHA-256 fuente NVDA: `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc`; artefactos F11–F14: {"source":"7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc","phase11":"05031c1371b2596efa7653e326cdad1325855454479a1e1f25c3aeff66f6ba1f","phase12":"3e1f2ddab92bee95c270a9f1f170574a4089c1d9bd3696287a343a30fc030f56","phase13":"45f15df045e7210651745919bbd7f22a9eb88cc199638a1a9c606a7ade40c0e7","phase14":"5c930e3b0ddefa672428665843106c6d87d6fb6ac3c81563c9b0cdfd5f06e6da"}. La auditoría F14 conserva hashes de QQQ, SMH, sidecars y calendario.

Los CSV SIP privados siguen en `trading_poc_001_bollinger/data/` del entorno autorizado. Para reproducir los retornos ETF desde cero se requiere acceso autorizado a los mismos insumos Alpaca; la licencia de redistribución de OHLCV SIP no está acreditada. Los archivos publicados contienen datos derivados por señal, sin OHLCV original.
