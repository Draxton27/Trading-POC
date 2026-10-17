# Trading POC 001: ¿qué pasa después de una compresión de Bollinger?

Este es **el primer experimento técnico** de nuestro proyecto. No es un robot de trading ni recomienda comprar CALL o PUT.

## ¿Qué hace?

1. Lee un archivo de velas (precio inicial, máximo, mínimo, final y volumen) de 5 minutos.
2. Calcula las bandas de Bollinger y la separación entre ellas.
3. Busca momentos en que las bandas estaban muy juntas y empiezan a separarse mientras el precio sale por arriba o abajo de ellas.
4. Mide si el precio continuó en esa dirección **15, 30 o 60 minutos después**.
5. Muestra qué ocurrió en una parte inicial y otra posterior de los datos.

**No calcula ganancias de opciones**. Que QQQ suba no significa que un CALL específico gane dinero.

## Cómo ejecutarlo

Requisito: **Node.js 22.16+**. La demostración no necesita paquetes de terceros ni claves de API; las pruebas de comparación sí requieren `npm ci`.

En una terminal, dentro de la carpeta del proyecto:

```bash
npm run demo
```

Esto crea un archivo con **7,800 velas de demostración inventadas** y ejecuta el análisis. Sus resultados son **100% ficticios y NO deben utilizarse para operar**.

El CSV de demostración lleva un archivo contiguo `data/QQQ_FICTICIO_5min.csv.meta.json` con su procedencia. El programa identifica los datos ficticios por ese metadato, nunca por el nombre del archivo.

Se generan estos archivos:

- `output/report.md`: resumen legible y estadísticas.
- `output/report.json`: resultados para una futura interfaz.
- `output/signals.csv`: inicio y fin de cada vela con señal, y momento en que la señal estuvo disponible.

Para utilizar tus propios datos:

```bash
npm run analyze -- data/QQQ_REAL_5min.csv
```

Tu archivo debe tener exactamente las columnas `timestamp,open,high,low,close,volume` (se permite otro orden de columnas). `timestamp` identifica **el inicio de la vela**, exige fecha y zona horaria explícita en ISO 8601 (`Z` u offset) y se normaliza a UTC. Cada inicio debe coincidir con un límite UTC de cinco minutos. Ejemplo:

```csv
timestamp,open,high,low,close,volume
2026-06-01T13:30:00.000Z,600.00,600.25,599.80,600.15,12000
2026-06-01T13:35:00.000Z,600.15,600.30,599.99,600.23,14000
```

Junto al CSV crea `data/QQQ_REAL_5min.csv.meta.json`:

```json
{
  "asset": "QQQ",
  "provider": "nombre del proveedor de los datos",
  "bar_minutes": 5,
  "data_class": "real",
  "session": "regular",
  "exchange_timezone": "America/New_York"
}
```

`data_class` es `synthetic` o `real`, según la declaración del usuario; el programa no verifica que los datos declarados reales provengan del mercado. `session` es `regular` o `extended`. La temporalidad admitida en esta fase es de cinco minutos para acciones estadounidenses cotizadas en horario de Nueva York.

Se requieren al menos 300 velas y muchas más para intentar estimaciones de utilidad práctica. Para datos reales, revisa ajustes por splits, procedencia, cobertura, calidad y derechos de uso.

## Tiempo de las velas y disponibilidad de señales

Una vela iniciada a las `13:30:00Z` cubre el intervalo **13:30–13:35 UTC**. Su cierre, y cualquier señal que dependa de él, solo se conocen **a partir de las 13:35:00Z**. En `signals.csv`, `bar_start_utc` es el timestamp original normalizado, `bar_end_utc` es el final de la vela y `available_at_utc` es el primer instante en que puede conocerse la señal. En este POC los últimos dos coinciden. Estos campos no representan hora ni precio de una operación. El rendimiento histórico sigue usando el cierre de la vela de señal como referencia estadística, sin afirmar que se pudiera ejecutar una operación a ese precio.

## Sesiones y huecos de datos

- Horario regular: inicio de barras desde **09:30 hasta 15:55**, hora `America/New_York` (la última termina a las 16:00).
- Horario extendido: inicio de barras desde **04:00 hasta 19:55**, hora `America/New_York` (la última termina a las 20:00). Declarar `extended` permite ese horario, pero no garantiza que el archivo contenga todas sus barras.
- La conversión de UTC a `America/New_York` tiene en cuenta el horario de verano. No debe suponerse una hora UTC fija para la apertura durante todo el año.
- Se rechazan timestamps repetidos o desordenados y huecos de más de cinco minutos **entre barras del mismo día local**. Se admiten intervalos entre días, incluidos cierres normales, fines de semana, festivos y días de cierre temprano. El archivo puede cubrir solo parte de una sesión. Esta versión no incorpora un calendario bursátil oficial y no detecta días completos ausentes ni certifica cierres tempranos.
- Las bandas y el historial de compresión utilizan las últimas barras presentes aunque crucen sesiones; no se reinician cada mañana. La evaluación de movimientos futuros sigue exigiendo barras consecutivas. No se modificaron las reglas de señales ni los cálculos de rendimiento en esta fase.

El CSV se rechaza si faltan campos, hay fechas imposibles o sin zona, precios no positivos, OHLC incoherente, volumen negativo o no entero, o valores no finitos. Se admite volumen cero. Si existe una suspensión o un intervalo intradía sin barras, hay que resolverlo en los datos antes de analizarlos; no se rellenan precios automáticamente.

Pruebas automáticas (tras `npm ci`, comprueban tipos y comparan con `trading-signals@8.3.0`):

```bash
npm test
```

## Importar QQQ histórico de Alpaca (fase 3)

El importador solicita aproximadamente **90 días** de velas de QQQ a la API de datos de Alpaca. Usa `timeframe=5Min`, `feed=sip`, `adjustment=split` y solo conserva los inicios de vela del horario regular de Nueva York. El extremo final solicitado es el inicio de una vela que **terminó al menos 20 minutos antes** de ejecutar la importación. Ese margen supera los 15 minutos de retraso exigidos para SIP histórico en el plan Basic. Nunca solicita el precio actual ni hace operaciones.

Puede guardar las credenciales en un archivo `.env` dentro de `trading_poc_001_bollinger`, junto a `package.json` (está excluido de Git):

```dotenv
APCA_API_KEY_ID=su-clave
APCA_API_SECRET_KEY=su-secreto
```

Desde esa carpeta, ejecute `npm run import:alpaca`. El comando carga `.env` si existe; las variables ya definidas en la terminal tienen prioridad. También puede configurar las credenciales solo en la terminal, sin archivo. En PowerShell:

```powershell
$env:APCA_API_KEY_ID = 'su-clave'
$env:APCA_API_SECRET_KEY = 'su-secreto'
npm run import:alpaca
```

En Bash:

```bash
export APCA_API_KEY_ID='su-clave'
export APCA_API_SECRET_KEY='su-secreto'
npm run import:alpaca
```

El resultado se guarda en `data/QQQ_ALPACA_SIP_5min.csv` y su archivo contiguo `.meta.json`; ambos se excluyen de Git. Los metadatos declaran `asset=QQQ`, `provider=Alpaca Market Data API`, `data_class=real`, `bar_minutes=5`, `session=regular`, `exchange_timezone=America/New_York`, `feed=sip` y `adjustment=split`. Son declaraciones de procedencia de la importación, no una auditoría independiente del proveedor. Para analizarlo:

```bash
npm run analyze -- data/QQQ_ALPACA_SIP_5min.csv
```

Alpaca pagina sus respuestas; el importador recorre todas las páginas, limita las solicitudes a un máximo nominal de 120 por minuto, reintenta temporalmente `429` y errores de servidor, y detiene la importación ante `401` o `403` (credenciales o permiso de datos). No cambia automáticamente a IEX. Si el plan de la cuenta no permite la consulta SIP histórica solicitada, se informa el error de acceso. Según la [documentación de Alpaca sobre planes de datos](https://docs.alpaca.markets/us/docs/about-market-data-api) y su [FAQ de datos de mercado](https://docs.alpaca.markets/us/docs/market-data-faq), Basic tiene límite de 200 solicitudes por minuto y acceso SIP histórico con retraso de al menos 15 minutos; la disponibilidad efectiva depende de la cuenta y sus permisos.

Cada `timestamp` del CSV es el **inicio UTC** de la vela. La selección de 09:30 a 15:55 se calcula en `America/New_York`, por lo que cambia automáticamente entre EST y EDT. La API puede no devolver barras en días festivos, cierres anticipados o intervalos sin operaciones. El importador no crea barras para suplirlas; acepta saltos entre fechas locales, pero el contrato actual **rechaza huecos entre barras del mismo día** y deja sin archivo nuevo esa descarga. No hay un calendario bursátil oficial en el POC: no certifica días completos ausentes ni que un cierre temprano sea legítimo. Tampoco verifica revisiones tardías de datos del proveedor. El ajuste por split altera precios y volumen de acuerdo con el proveedor, por lo que no debe mezclarse esta serie con otra sin el mismo ajuste.

Las pruebas de Alpaca usan solo respuestas simuladas y no requieren credenciales. En este repositorio no se publica un conjunto real de QQQ; ejecute la importación con su propia cuenta y respete las condiciones de uso de datos del proveedor. Las reglas de señales, los umbrales de Bollinger y las estadísticas del POC siguen iguales.

## ¿Qué significan los resultados?

- **Señales válidas:** cuántas veces ocurrió la condición definida.
- **Movimiento favorable:** porcentaje de veces en que el precio terminó en la dirección observada después del tiempo indicado. Si el precio queda igual, no cuenta.
- **Cambio medio:** variación media del precio en esa dirección, no rendimiento de opciones.
- **IC 95%:** intervalo orientativo de incertidumbre. Puede subestimar el riesgo por la dependencia entre movimientos del mercado.
- **Base de mercado:** frecuencia de subidas o bajadas de todos los momentos válidos del mismo período, sin aplicar el filtro. Es una comparación exploratoria imperfecta.

Los parámetros de señales son hipótesis iniciales arbitrarias, no configuraciones optimizadas ni verificadas. Se evita usar precios futuros al detectar una señal, se restringen resultados a barras consecutivas dentro de sesión y se utiliza un descanso de 12 velas tras cada señal para reducir duplicaciones.

El generador de prueba omite fines de semana, pero no festivos bursátiles. Sus 100 días ficticios permanecen en horario de verano de Nueva York y usan una hora UTC fija para simplificar. **No es un calendario de mercado real**.

## Relación con la investigación de GitHub

La [validación documentada en RESEARCH.md](RESEARCH.md) compara nuestro cálculo con `trading-signals@8.3.0` vela por vela. En las 7.800 velas ficticias hubo igualdad numérica exacta de bandas y ancho donde ambos producen resultados. `trading-signals` está fijada como dependencia de **pruebas**; el análisis sigue usando el cálculo local. La biblioteca tiene un método propio de señales con otra regla, que no se utiliza aquí.

## Próximos pasos

1. Importar datos históricos auténticos de QQQ con una cuenta Alpaca autorizada y comparar su cobertura con los gráficos de TC2000.
2. Evaluar una eventual sustitución del cálculo local solo si aparece una necesidad concreta; la paridad de indicadores no valida por sí misma la estrategia.
3. Estudiar si la señal supera una referencia razonable en datos nuevos, con costos, falsos positivos y otras condiciones del mercado.
4. Solo más adelante estudiar el precio real de contratos CALL y PUT.

**Aviso:** uso educativo e investigación. No constituye asesoramiento financiero.
