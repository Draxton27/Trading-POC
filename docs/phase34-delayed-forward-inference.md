# Observación adelantada al desenlace con Alpaca SIP retrasado

Fase 34 une el ledger privado append-only de la ingesta Alpaca con el modelo
XGBoost congelado. Es investigación observacional: no crea señales, órdenes,
suscripciones IBKR ni una predicción ejecutable para opciones.

## Fuente y condición temporal

El observador acepta solamente revisiones verificables del ledger de Fases
32/33 con `NVDA`, velas de 15 minutos, `feed=sip`, `adjustment=split` y estado
`DELAYED`. Verifica la cadena de hashes antes de usar una vela. El calendario
oficial de Alpaca se guarda localmente junto al ledger como
`ledger.jsonl.calendar.json`; es metadato de sesión, no una fuente alternativa
de precios. Si falta, el observador se detiene.

En cada ejecución toma **solo la vela más nueva** conocida por el ledger. No
recorre velas antiguas para completar huecos. La predicción se rechaza si el
cierre de `t+4` ya ocurrió o si el modelo se congeló durante o después de la
vela `t`. De este modo un ledger detenido no puede producir predicciones
retrospectivas presentadas como adelantadas.

Las diez variables provienen sin cambios de `calculatePhase23Features`. Los
gaps, el historial insuficiente, sesiones incompatibles y velas posteriores al
último instante elegible de cada sesión generan un error controlado. Se respeta
el horizonte Fase 23: el cierre de `t+4` debe permanecer dentro de la sesión,
incluidos cierres anticipados.

## Registro privado

`TRADING_POC_ML_FORWARD_OBSERVATION_LOG` apunta por defecto a
`private/ml-forward-observation/records.jsonl`. Cada entrada es append-only,
encadenada por hash y protegida por un bloqueo exclusivo. La identidad se basa
en modelo congelado, modo y vela; ejecutar de nuevo no sustituye una predicción
original si Alpaca corrige una vela anterior.

El modo es siempre `DELAYED_FORWARD_OBSERVATION`. `PROSPECTIVE_CAPTURE` sigue
bloqueado. La entrada guarda hashes y revisiones de todas las velas utilizadas,
las diez variables y sus probabilidades. `hypotheticalNextEntryOpen` y
`outcomeT4Close` se registran como `null`: sus timestamps se conocen, pero sus
precios futuros no se leen ni se escriben en esta fase. La evaluación de esos
desenlaces corresponde a Fase 35.

Por el retraso mínimo, `recordedBeforeNextEntry` será normalmente `false`. Eso
queda visible en la API y pantalla; una observación no se presenta como una
oportunidad ejecutable a la apertura de `t+1`.

## Windows

Con `.venv\phase28-py312` y los secretos Alpaca ya configurados solo en
`.env.local`:

```powershell
$env:PYTHON = (Resolve-Path '.\.venv\phase28-py312\Scripts\python.exe').Path
$env:TRADING_POC_ML_RUN_DIR = (Resolve-Path '.\trading_poc_001_bollinger\output\real\phase28-xgboost\20261020T134917Z-d22ccbc44e1e').Path
npm.cmd run alpaca:ingest -- --once --delay-minutes 20
npm.cmd run ml:observe -- --once
```

Para ejecutar ambos procesos periódicamente, inicie la ingesta antes del
observador y use intervalos de al menos 60 segundos. El servidor HTTP solo lee
`/api/v1/ml/forward-observation`; nunca ejecuta Python ni escribe el ledger.
Los datos, el calendario, el modelo y los registros privados están excluidos de
Git.
