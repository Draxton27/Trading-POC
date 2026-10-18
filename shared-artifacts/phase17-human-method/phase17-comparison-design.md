# Comparación entre decisión humana y señal congelada

La comparación usa las señales originales de Fase 16 y una copia privada del diario humano extendido. No detecta eventos nuevos ni recalcula desenlaces. La tolerancia de **±15 minutos** y la correspondencia de dirección/tipo proceden del protocolo F16; no se optimizan aquí.

La vista se corta en `decisionAtUtc`; `documentedAtUtc` prueba cuándo se registró. Contiene solo `family`, `direction`, `availableAtUtc`, indicadores y contexto de la señal **si ya eran conocidos al decidir**. Una coincidencia de patrón puede tener `signalKnownAtDecision=false`; no afirma que el operador vio la detección automática. No incluye `settlement`, retorno, MFE/MAE, precio de venta ni anotaciones posteriores. El resultado real solo puede añadirse a una vista separada de revisión, nunca a la captura de lo que se sabía al decidir.

| Estado | Condición conservadora |
| --- | --- |
| `both` | Decisión humana `live` documentada antes del resultado principal, mismo símbolo/dirección/tipo, y hora de decisión dentro de ±15 minutos de confirmación. |
| `human_only` | Decisión humana prospectiva de operar, con cobertura de mercado declarada, sin señal compatible. No implica que el detector sea defectuoso. |
| `explicit_rejection` | `no_trade`, `observedMarket=true` e ID de señal escrito explícitamente en `rejectedSignalIds`; el rechazo se documentó antes del desenlace. |
| `no_trade` | Decisión de no operar sin referencia explícita a señal; se conserva como decisión humana, no como rechazo del detector. |
| `system_only` | Señal sin coincidencia ni rechazo explícito, pero con revisión del mercado documentada cerca de la confirmación; no se interpreta como rechazo. |
| `insufficient` | Sin cobertura humana verificada, datos temporales insuficientes, reconstrucción histórica o anotación posterior. La ausencia de diario nunca equivale a rechazo. |

Si varias decisiones pueden coincidir, se ordenan por diferencia absoluta de tiempo e ID estable y cada decisión se asigna como máximo una vez. La referencia explícita de rechazo tiene prioridad sobre la mera ausencia de entrada. Los campos privados y operaciones importadas no se publican automáticamente. Los conteos resultantes son descriptivos y no prueban superioridad del humano o sistema.
