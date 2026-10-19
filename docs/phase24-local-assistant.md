# Fase 24: asistente local de solo lectura

El asistente usa Ollama para elegir entre tres herramientas cerradas. Las llamadas se validan en el backend; la respuesta y las evidencias financieras se redactan con plantillas y datos del servidor, no con texto libre generado por el modelo. El contenido recuperado nunca se envía a Ollama, por lo que una instrucción dentro de un documento no puede convertirse en una instrucción del modelo. El texto de la consulta y hasta seis consultas anteriores sí se envían al servicio local para elegir herramientas. No se guardan conversaciones en el backend; el historial visible permanece en memoria de la página hasta recargarla o cerrarla.

Solo se consulta `http://127.0.0.1:11434/api/chat` con un socket local directo, sin proxy, redirecciones ni URL configurada por el usuario. Rechaza nombres de modelo que incluyan `cloud`. **El proceso de Ollama es independiente:** para impedir que sus funciones cloud procesen consultas externamente, hay que deshabilitarlas en ese proceso y usar un modelo descargado localmente. No se puede verificar desde esta integración que otro servicio que escuche en ese puerto respete esa configuración. No activar logs de depuración que puedan contener consultas privadas. Ver [configuración de Ollama](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).

## Configurar y ejecutar en Windows

1. Instalar [Ollama para Windows](https://ollama.com/download/windows). Si ya hay una instancia de Ollama abierta, cerrarla desde su icono en la bandeja; de lo contrario la configuración siguiente no afectará al servicio que ya está ejecutándose.
2. En una ventana PowerShell dedicada, iniciar el servidor local con cloud deshabilitado y dejarla abierta:

   ```powershell
   $env:OLLAMA_HOST = '127.0.0.1:11434'
   $env:OLLAMA_NO_CLOUD = '1'
   ollama serve
   ```

   Comprobar en la salida de Ollama que indique `Ollama cloud disabled: true`. Como alternativa persistente, la documentación de Ollama permite configurar `disable_ollama_cloud` en su archivo de configuración y reiniciar el servicio.
3. En otra ventana, descargar una vez el modelo local (esta descarga requiere Internet, pero no incluye consultas del asistente):

   ```powershell
   ollama pull llama3.2:3b
   ```

4. Desde la raíz de Trading-POC, en la consola que inicia el backend y la web:

   ```powershell
   npm ci
   $env:TRADING_POC_OLLAMA_MODEL = 'llama3.2:3b'
   npm run dev
   ```

   La variable es opcional; ese modelo es el predeterminado. Puede configurarse otro modelo **local** compatible con tool calling. La configuración usa letras, dígitos, puntos, guiones, `_` y `:`, sin `/` ni `cloud`. Abrir `http://127.0.0.1:5173/` y seleccionar **Asistente**.

Si Ollama está apagado o el modelo falta, se muestra un error y no se fabrica una respuesta. El límite de espera es 20 segundos; una máquina lenta al cargar el modelo puede necesitar volver a intentar. No se usa streaming.

## Herramientas y evidencia

- `get_market_snapshot`: cierre e indicadores de 15 minutos de NVDA, QQQ o SMH. En PAPER solo lee cotizaciones existentes en memoria, sin crear suscripciones. El histórico se clasifica según metadatos locales y nunca como precio actual; DEMO y archivos sintéticos se identifican como sintéticos.
- `get_academy_reference`: consulta SQLite con el servicio documental existente y presenta rango óptimo, límites, fecha y vigencia explícita. La interpretación de ASK por acción procede del operador, y una referencia sin vigencia no se convierte en recomendación.
- `get_system_status`: informa modo, disponibilidad histórica y conexión del agente sin exponer cuentas ni posiciones.

Cada respuesta correcta incluye evidencia estructurada con fuente, activo, fecha, tipo y disponibilidad. Una cotización solo se presenta como LIVE disponible con feed LIVE, proveedor IBKR, valores presentes, sin error de datos, recepción y timestamp de mercado no futuros y de hasta 30 segundos. DELAYED, FROZEN, DELAYED_FROZEN, UNKNOWN y simulado se distinguen; sin timestamp de mercado verificable la cotización queda obsoleta. La implementación actual del agente TWS puede publicar `marketTimestampUtc: null`, por lo que una cotización no se presenta como actual solo por su hora de recepción.

La API exige el token local ya utilizado por las demás escrituras. Admite 2000 caracteres por consulta, hasta seis consultas anteriores, tres llamadas de herramienta, dos activos en total y dos solicitudes concurrentes. La respuesta de Ollama está limitada a 64 KiB y se cancela con `AbortController` a los 20 segundos. Nombres, símbolos y argumentos se validan con esquemas cerrados antes de consultar datos; no hay ejecución de comandos, consultas SQL generadas, órdenes ni herramientas HTTP. Las respuestas de Ollama no se muestran como afirmaciones financieras. Si el modelo no selecciona ninguna herramienta, la interfaz pide reformular la consulta. La precisión al seleccionar herramientas depende del modelo local.
