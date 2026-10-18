# Fase 12: auditoría de datos y procedencia

Código utilizado: `51ac6bdc67f0249897160eb81b3ae6940c2ef252`. Fuente local: `NVDA_ALPACA_SIP_15min_20211017_20261017.csv`.
No se descargaron datos nuevos ni se añadieron velas SIP originales a este PR. Las credenciales no se registran en estos artefactos.

## Identidad y sumas de entrada

| Archivo | SHA-256 |
|---|---|
| csv | `7b06d0a493515b18a581963d2d2d488e73a7cd0dc2c961b60a99315e7a9b0ecc` |
| metadata | `123ff39326b3aa2eb16a0455a0b9652a77ea009363758353880761d524a014e2` |
| calendar | `75c3228c9addae74242763927a18d6e206fc623f2204381894f2d162befbe37a` |
| provenance | `90e3381b68308f8e3188ff2651f7c3432ecccc4872ee8d32181b3ac10b66ea94` |

Proveedor: Alpaca Market Data API; activo: NVDA; clase: real; 15 minutos: 15; feed: sip; ajuste: split; sesión: regular.
Procedencia declarada: proveedor Alpaca Market Data API; timeframe 15Min; feed sip; ajuste split; sesión regular; ventana solicitada 2021-10-17T00:00:00.000Z a 2026-10-17T23:45:00.000Z.

## Cobertura y calendario

Velas cargadas: 32510; primera 2021-10-18T13:30:00.000Z; última 2026-10-16T19:45:00.000Z.
Sesiones programadas en el rango observado: 1255; observadas: 1255; ausentes: 0; parciales: 0.
Sesiones observadas con referencia del día previo completo: 1254; sin referencia: 1.
Agregaciones horarias completas/incompletas: 8755/0; diarias completas/incompletas: 1255/0.

| Año | Sesiones ausentes | Sesiones parciales |
|---|---:|---:|
| 2021 | 0 | 0 |
| 2022 | 0 | 0 |
| 2023 | 0 | 0 |
| 2024 | 0 | 0 |
| 2025 | 0 | 0 |
| 2026 | 0 | 0 |

Sesiones ausentes: ninguna.
Sesiones parciales: ninguna.

La referencia de cada sesión exige que la sesión bursátil programada inmediatamente anterior esté completa. Festivos y cierres anticipados provienen del calendario adjunto; huecos de datos descalifican el nivel y los horizontes afectados.
