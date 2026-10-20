# Fase 26: interpretación técnica conversacional fundamentada

## Diseño

Ollama sigue eligiendo entre las herramientas cerradas de Fase 24. Fastify valida los argumentos y consulta las fuentes locales. Los cálculos y el texto sobre mercado salen de funciones puras del backend; la respuesta libre del modelo no se usa como afirmación financiera. No se envían al modelo velas, cotizaciones, resultados calculados ni documentos de la academia.

El motor usa velas completas de 15 minutos disponibles al momento de consulta. Rechaza velas duplicadas, desordenadas, con duración distinta de 15 minutos u OHLC inconsistente. Las velas marcadas como incompletas se conservan para detectar discontinuidades, pero no se usan en indicadores. Los retornos requieren velas consecutivas dentro de la misma fecha de Nueva York. Si falta un dato, un denominador es cero o el historial no alcanza, el valor queda `null`/`N/D` con su estado de disponibilidad.

Las SMA y Bollinger conservan sus fórmulas originales y usan solo el tramo continuo de velas cerradas hasta el cierre observado. Una vela esperada ausente o incompleta reinicia ese tramo. Con el calendario bursátil local se distinguen sesiones cerradas y cierres anticipados, incluidos los cambios de horario de Nueva York. Sin calendario, la ventana se limita conservadoramente a la sesión actual; no se supone que sesiones intermedias tuvieron datos completos. La respuesta incluye la política, cantidad de velas consecutivas y la causa de los valores `INCOMPLETE_WINDOW`. La inspección no usa velas posteriores al instante solicitado.

La investigación E2E y sus comandos reproducibles están en [Validación del PR #32](phase26-pr32-validation.md).

Cada observación estructurada informa clave, valor, unidad, período, timestamp UTC del cierre y disponibilidad (`AVAILABLE`, `INSUFFICIENT_HISTORY`, `INCOMPLETE_WINDOW` o `INVALID_DENOMINATOR`). La evidencia también conserva fuente, activo, clase y disponibilidad histórica/sintética.

## Fórmulas

- Distancia al promedio simple: `(cierre / SMA - 1) × 100`. Un signo positivo solo describe que el cierre está por encima de esa media; uno negativo, por debajo.
- Posición de Bollinger 20/2: `(cierre - banda inferior) / (banda superior - banda inferior) × 100`. 0% corresponde a la banda inferior y 100% a la superior; puede quedar fuera de ese intervalo. No implica sobrecompra, sobreventa o reversión.
- Ancho relativo de Bollinger: `(banda superior - banda inferior) / banda media × 100`.
- Retorno de 1 vela: `(cierre actual / cierre anterior - 1) × 100`, con un intervalo consecutivo de 15 minutos.
- Retorno de 4 velas: `(cierre actual / cierre de cuatro intervalos antes - 1) × 100`, en cuatro intervalos consecutivos. En ambos casos el dato está disponible al cierre de la vela actual.
- Volumen relativo: `volumen actual / promedio del mismo horario NY en las 20 sesiones observadas anteriores`. La sesión actual queda excluida del promedio. Si faltan las 20 observaciones comparables o el promedio es cero, no se informa RVOL.
- Fortaleza relativa: compara los retornos porcentuales de 15 minutos y 60 minutos de los dos activos, en períodos equivalentes y en el mismo timestamp UTC. La distancia a SMA 20 y la posición Bollinger se muestran como contexto normalizado, no como retorno. Nunca se comparan precios absolutos entre activos.

### Timestamps que no coinciden

Cuando los activos tienen cierres más recientes distintos, el backend busca el timestamp de cierre más reciente presente en ambos y vuelve a calcular los indicadores usando solo velas hasta ese corte. Si no existe, muestra las series por separado y se abstiene de comparar fortaleza relativa. También se abstiene si difieren la fuente o la clase de datos.

## Interpretación

Las frases describen qué observan los cálculos: por ejemplo, el cierre está sobre tres de las cuatro SMA disponibles, pero bajo la cuarta; o la distancia a SMA 20 y el retorno de 60 minutos tienen signos distintos. Una lectura mixta se mantiene como mixta. Ninguna métrica individual confirma una tendencia y no se emiten instrucciones de compra o venta.

Las series históricas de Alpaca se identifican como `HISTORICAL` y `HISTORICAL_ONLY`; las barras DEMO como `SYNTHETIC`. Las cotizaciones de IBKR permanecen separadas: solo se etiquetan `LIVE` cuando el proveedor, el feed, permisos, valores y timestamps de mercado y recepción satisfacen las comprobaciones actuales. Retrasadas, congeladas, obsoletas, simuladas y no disponibles conservan su etiqueta; un cierre histórico no se presenta como una cotización actual.

## Ejemplo verificable con fixture sintético

Consulta: «Analizá NVDA y comparalo con QQQ. Explicá sus indicadores técnicos».

La respuesta se divide en **Datos observados**, **Interpretación técnica**, **Comparación entre activos** y **Limitaciones de la información**, con las fuentes y timestamps asociados. En el fixture de la prueba, NVDA tiene cierre 102, SMA 20 de 100,15, distancia a SMA 20 de aproximadamente 1,85%, retorno de 15 minutos de aproximadamente 0,99% y retorno de 60 minutos de 2%. QQQ usa un fixture con movimiento equivalente a la mitad: sus retornos son aproximadamente 0,50% y 1%. El backend describe que NVDA tuvo retornos porcentuales mayores en ambos horizontes del mismo corte; no predice el próximo movimiento. Son cifras controladas de pruebas, no datos reales ni una conclusión de mercado.

En Fase 24 la respuesta de mercado mostraba principalmente cifras. Esta fase añade las fórmulas, el significado de los signos, los desacuerdos entre indicadores, los períodos explícitos y la cautela temporal. El formato por secciones hace visible qué es observación y qué es interpretación.

## Ollama y el formato de salida

Se conservan las llamadas a herramientas nativas ya usadas por Fase 24 y se valida estrictamente cada nombre y argumento con Zod. La documentación de Ollama describe `format` con JSON Schema para restringir el contenido de una respuesta estructurada, y documenta las llamadas a herramientas como otro mecanismo. No documenta en esos ejemplos que el esquema `format` valide de forma conjunta los argumentos de `tool_calls` en la misma respuesta. Por eso esta fase no agrega un segundo formato de selección: no ofrecería una garantía adicional demostrada y podría interferir con la compatibilidad del selector. Las llamadas desconocidas o mal formadas siguen fallando cerradas. No se hizo una prueba con Llama 3.2 3B real en esta ejecución; las pruebas usan Ollama simulado.

### Selector local y errores de herramientas

El backend reconoce antes de llamar a Ollama un conjunto pequeño de consultas inequívocas y de solo lectura: análisis histórico de uno o dos símbolos permitidos (`NVDA`, `QQQ`, `SMH`), comparación explícita de hasta dos de ellos, explicación educativa de indicadores y estado explícito del sistema/IBKR. Las dos consultas siguientes entran por ese camino y reciben evidencia local estructurada aun cuando Ollama no esté iniciado:

- «Analizá el histórico de NVDA. Explicá sus medias móviles, Bollinger, retornos y volumen relativo.»
- «Compará NVDA con QQQ. ¿Cuál mostró mayor fortaleza relativa en los últimos 15 y 60 minutos del histórico?»

El selector no infiere símbolos, no admite más de dos activos y no convierte frases de compra, venta, órdenes, contratos, texto adversarial o consultas ambiguas en una acción local. Esas consultas mantienen la ruta de Ollama y, si sus argumentos no pasan Zod, se devuelven como error controlado. La recuperación de una llamada malformada solo reutiliza el selector con el texto original; por diseño, un caso inequívoco ya habría evitado Ollama desde el inicio.

Cuando una herramienta devuelta por Ollama no es válida, el servidor emite un diagnóstico estructurado de nivel `warn` con el modelo, el nombre de herramienta, el tipo y las claves de los argumentos y códigos/rutas de Zod. No incluye valores de argumentos, historial, pregunta, rangos académicos, velas, cotizaciones, credenciales ni secretos. `TRADING_POC_LOG_LEVEL` permite ajustar el nivel de salida; su valor predeterminado es `warn`. Las validaciones estrictas, el límite de una llamada a Ollama, `keep_alive` y el timeout se mantienen.

### Referencias documentales de la academia

Las solicitudes inequívocas que mencionan «rango óptimo», «rango de la academia», «referencia documental» o «límites recomendados por la academia» se resuelven localmente con el símbolo explícito y permitido. El backend reutiliza get_academy_reference, academyArgs y academyEvidence(); el servicio de academia determina si el resultado es ACTIVE, REFERENCE_DATE, HISTORICAL_ONLY, CONFLICT o NONE. No se usa la explicación educativa como sustituto. Si una consulta documental no puede resolverse inequívocamente —por ejemplo, falta el activo, hay varios activos, la fecha es ambigua o aparece una instrucción adversarial— se devuelve un error controlado.

Se aceptan fechas ISO, fechas españolas con el mes escrito («17 de febrero de 2026») y fechas numéricas DD/MM/YYYY o MM/DD/YYYY solo cuando uno de los dos primeros componentes supera 12 y determina el orden. Se rechazan días imposibles, fechas numéricas ambiguas como 03/04/2026, meses sin día y varias fechas distintas. Los límites y rangos se muestran con su fecha y estado documental. Una referencia histórica sin vigencia declarada se conserva como HISTORICAL_ONLY; no se presenta como una recomendación vigente, precio de NVDA ni precio actual de opción. La unidad ASK por acción sigue identificada como interpretación del operador.

Prueba manual en DEMO con una base local que contenga referencias: preguntar «¿Qué rango óptimo tiene NVDA según la academia para el 17 de febrero de 2026?». La respuesta debe incluir la sección «Referencia documental», la fecha seleccionada, los valores disponibles y el estado que determine el registro local. Una base sin referencia debe indicar NONE; un conflicto debe indicarse como tal y no mostrar un rango evaluable. Las pruebas automatizadas usan fixtures sintéticos y no requieren Ollama.

### Prueba manual con Llama 3.2 3B en Windows

Esta ejecución no usó Ollama real. Para comprobarlo localmente, con Ollama instalado y el modelo descargado, iniciar el servicio y luego la aplicación DEMO:

```powershell
ollama pull llama3.2:3b
ollama serve

$env:TRADING_POC_MODE='DEMO'
$env:TRADING_POC_OLLAMA_MODEL='llama3.2:3b'
npm.cmd run dev
```

En otra consola, abrir `http://127.0.0.1:5173/`, obtener la sesión local desde la interfaz y enviar las dos consultas anteriores en **Asistente**. Deben aparecer secciones de datos observados, interpretación, limitaciones y, para la segunda, comparación entre activos. Confirmar que no aparece `Ollama solicitó argumentos de mercado inválidos`; para estas dos frases tampoco debe llegar una solicitud a `/api/chat` de Ollama. Probar por separado una frase ambigua y una instrucción de compra para confirmar que no se transforman en acciones deterministas.

## Proyectos revisados

| Proyecto | Patrón útil | Licencia del repositorio | Decisión |
| --- | --- | --- | --- |
| [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | Separación de tareas de análisis y agregación de evidencia. | Apache-2.0, con aviso y política de marcas propios. | Se toma como referencia de separación conceptual. Se descarta incorporar su plataforma de agentes, fuentes externas y ejecución de análisis: el alcance requiere cálculos locales pequeños, de solo lectura y verificables. |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | Roles especializados y etapas explícitas de investigación. | Apache-2.0. | Se conserva solo la idea de mostrar observaciones separadas de la síntesis. Se descartan LangGraph, Python, debate multiagente, proveedores externos y decisiones/órdenes: agregan costo, no determinismo y capacidades fuera del alcance. |
| [ollama-js](https://github.com/ollama/ollama-js) | Cliente para `/api/chat`, selección de modelo y llamadas a herramientas; licencia MIT. | MIT. | Se revisó como referencia, pero no se agrega la dependencia: el backend existente mantiene el socket local directo, sin proxy ni URL controlada por el usuario, límites y cancelación ya probados. |
| [technicalindicators](https://github.com/anandanand84/technicalindicators) | Implementaciones TypeScript y pruebas de indicadores. | MIT. | No se incorpora ni se copia lógica. `calculateIndicators()` es la fuente existente para SMA y Bollinger, lo que evita una segunda interpretación matemática y dependencia innecesaria. |

No se copió código de esos proyectos. La revisión de licencias describe las licencias publicadas en sus repositorios; no reemplaza una auditoría de dependencias de sus proyectos.

## WebSockets y límites

Esta fase no modifica `/agent/v1/connect` ni `/api/v1/stream`. El asistente continúa usando HTTP y Ollama `stream: false`. Un trabajo futuro podría reutilizar los eventos existentes para refrescar evidencia y estado en la UI; eso requeriría decidir la frecuencia y las reglas de obsolescencia antes de implementar polling o suscripciones nuevas. No se agregan canales ni suscripciones.

Los datos de este estudio son retrospectivos. El cálculo no incorpora noticias, fundamentales, inferencia predictiva, CALL/PUT, ejecuciones ni rendimiento de opciones. Un feed LIVE se identifica por separado, y no altera la interpretación del histórico.
