# Preguntas abiertas y auditoría de conocimiento

No se dispone en esta rama de audios publicables, transcripción integral certificada, ejemplo operativo original ni operaciones reales. El usuario aportó un resumen y anexo de ocho respuestas; las 35 filas originales del [registro de evidencia](phase17-operator-evidence-register.csv) conservan `resumen_conversacional_de_audio_pendiente_de_cotejo`; `PRE07_V2` registra una aclaración posterior y una captura de esta conversación. Su revisión textual no sustituye cotejar los archivos originales autorizados ni prueba que el operador use un criterio en todas sus operaciones.

## Preguntas vigentes tras el resumen del operador

| Afirmaciones | Conocido por el resumen | Falta confirmar antes de formalizar una regla |
| --- | --- | --- |
| `PRE01`–`PRE08`, `PRE07_V2` | Consulta empresa, sector, macro, bonos, resultados y Finviz. `PRE07_V2` identifica Recom, escala 1–5, valor visible 1,21 y criterio declarado `Recom < 2,5`. | Secuencia y horas reales; fecha de mercado de la captura; si aplica a acciones, selección de opciones, CALL, PUT o exclusión de activos. El precio objetivo de analistas y Recom no son señales intradía. |
| `TRE01`–`TRE06` | Examina SMA 20/40/100/200, orden, separación, precio y cierres en diario y horario. | Parámetros de gráfico, qué separación/pendiente considera suficiente, cómo distingue retroceso de cambio de tendencia. Los 80/90/95% son estimaciones personales no validadas. |
| `LEV01`–`LEV04` | Dibuja techos, pisos y zonas; observa cierres y rupturas/rechazos. | Nivel original, hora de trazado, vigencia, invalidación y confirmación de entrada. |
| `BOL01`–`BOL03` | Consulta Bollinger aproximadamente en 15 minutos junto al contexto mayor. | Parámetros exactos, combinación que observó y si una expansión fue continuación o regreso en cada caso. |
| `NO01`–`NO03` | Puede no operar con lateralidad, medias entrelazadas, noticias o confirmación insuficiente. | Criterio concreto, ejemplos auténticos y constancia de que estaba observando la señal. |
| `OPT01`–`OPT03` | Considera CALL/PUT, strike, vencimiento, prima, bid-ask y día de la semana. | Contratos OCC y quotes reales, preferencias por día y vencimiento, sin inventar delta o spread máximo. |
| `RISK01`–`RISK05` | Menciona objetivo, límite, salida anticipada y reservas frente a stops. | Porcentajes y base de cálculo; hora de cada cambio del plan y fill de salida. Una pérdida no se presume recuperable. |
| `REV01`–`REV03` | Usa historial del bróker y gráficos para revisar decisiones. | Campos realmente exportados, captura original, explicación de cada caso y posibilidad de cotejarla con datos conocidos entonces. |

Un futuro cotejo de audio o transcripción autorizada debe añadir una **versión nueva** de la afirmación con fuente, hora y relación con el ID anterior. Las filas actuales y el estado inicial del commit `643ab32f24de8c07c99e4e303a163f6ddf78526c` se conservan. No se publican audios ni datos personales.

## Inventario inicial conservado del commit `643ab32`

La tabla siguiente registra el estado anterior a recibir el resumen; sus frases «información faltante» no niegan las nuevas declaraciones atribuidas y pendientes de cotejo.

| Criterio | Estado | Procedencia actual | Falta para confirmar |
| --- | --- | --- | --- |
| Se deben registrar tendencia, SMA 20/40/100/200 y niveles | Confirmado como requisito del encargo, **no** como regla de entrada del operador | Explicación textual Fases 16–17 | Declaración del operador y ejemplo con hora de decisión |
| Orden, pendiente y distancia de SMA podrían describir tendencia | Hipótesis técnica pendiente de validación | Inferencia técnica, Fase 10 y catálogo F17 | Confirmar qué observa realmente y cuándo |
| Máximos/mínimos previos y niveles manuales podrían influir | Hipótesis técnica pendiente de validación | Encargo F17 e inferencia técnica | Dibujo original, regla de validez y duración |
| Bollinger podría aportar contexto | Hipótesis técnica pendiente de validación | Estudios Fases 9–11 | Confirmar si el operador lo consulta, en qué temporalidad |
| QQQ, SMH, volatilidad y noticias podrían alterar la decisión | Hipótesis técnica pendiente de validación | Estudios Fases 13–15 | Confirmar uso discrecional y fuente disponible en tiempo real |
| Entrada exacta, confirmación, invalidación y salida | Información faltante | No hay declaración verificable | Secuencia real, ejemplos antes del resultado y casos rechazados |
| Selección de CALL/PUT, strike y vencimiento | Información faltante | Solo se solicita registrarlos | Motivos reales y cotización observada del contrato |
| Límite de pérdida, objetivo, tamaño y cambios de plan | Información faltante | Solo se solicita registrarlos | Criterios y hora de cada modificación |
| Probabilidades personales de 80/90/95% | Información faltante; **no se usan** | No hay estimación auditada | Protocolo estadístico nuevo y muestra prospectiva suficiente |

Preguntas para el operador, en lenguaje sencillo:

1. Antes de abrir, ¿qué mirás primero y qué te haría esperar?
2. ¿Cómo decidís si NVDA sube, baja o no tiene dirección clara? ¿Qué papel tienen las cuatro medias y en qué gráficos?
3. ¿Cómo dibujás un techo, piso o zona? ¿Cuándo dejás de usarla?
4. ¿Qué debe hacer el precio para que consideres entrar? ¿Qué hecho demostraría que tu idea era incorrecta?
5. Si pensás en una opción, ¿por qué elegís CALL o PUT, strike y vencimiento? ¿Qué bid/ask veías antes de decidir?
6. ¿Cuándo salís, reducís posición o decidís no operar? ¿Cambia la respuesta cerca de noticias o resultados?
7. ¿Podés aportar uno o dos ejemplos originales, con su hora de captura, y también un caso que rechazaste? Los archivos privados pueden mantenerse fuera de Git.

Cada respuesta futura debe añadirse con fecha, fuente (`audio privado`, `explicación posterior`, `ejemplo real` o `inferencia técnica`) y nivel de verificación. Nunca se publica un audio ni un dato personal sin autorización. Una operación rentable del bróker es un resultado observado, no confirmación de que la regla tenga ventaja estadística.
