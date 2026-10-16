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

Requisito: **Node.js 22.16+**. No necesita instalar paquetes de terceros ni claves de API para esta prueba.

En una terminal, dentro de la carpeta del proyecto:

```bash
npm run demo
```

Esto crea un archivo con **7,800 velas de demostración inventadas** y ejecuta el análisis. Sus resultados son **100% ficticios y NO deben utilizarse para operar**.

Se generan estos archivos:

- `output/report.md`: resumen legible y estadísticas.
- `output/report.json`: resultados para una futura interfaz.
- `output/signals.csv`: momentos concretos en que se detectó una señal.

Para utilizar tus propios datos:

```bash
npm run analyze -- data/QQQ_REAL_5min.csv
```

Tu archivo debe tener exactamente las columnas `timestamp,open,high,low,close,volume`; los tiempos deben estar en orden, con intervalo de 5 minutos dentro de cada sesión y formato ISO con zona horaria. Ejemplo:

```csv
timestamp,open,high,low,close,volume
2026-06-01T13:30:00.000Z,600.00,600.25,599.80,600.15,12000
2026-06-01T13:35:00.000Z,600.15,600.30,599.99,600.23,14000
```

Se requieren al menos 300 velas y muchas más para intentar estimaciones de utilidad práctica. Usa barras de sesión regular ajustadas por splits. Revisa zona horaria, procedencia de datos, calidad y derechos de uso.

Pruebas automáticas:

```bash
npm test
```

## ¿Qué significan los resultados?

- **Señales válidas:** cuántas veces ocurrió la condición definida.
- **Movimiento favorable:** porcentaje de veces en que el precio terminó en la dirección observada después del tiempo indicado. Si el precio queda igual, no cuenta.
- **Cambio medio:** variación media del precio en esa dirección, no rendimiento de opciones.
- **IC 95%:** intervalo orientativo de incertidumbre. Puede subestimar el riesgo por la dependencia entre movimientos del mercado.
- **Base de mercado:** frecuencia de subidas o bajadas de todos los momentos válidos del mismo período, sin aplicar el filtro. Es una comparación exploratoria imperfecta.

Los parámetros de señales son hipótesis iniciales arbitrarias, no configuraciones optimizadas ni verificadas. Se evita usar precios futuros al detectar una señal, se restringen resultados a barras consecutivas dentro de sesión y se utiliza un descanso de 12 velas tras cada señal para reducir duplicaciones.

El generador de prueba omite fines de semana, pero no festivos bursátiles y usa una hora UTC fija para simplificar. **No es un calendario de mercado real**.

## Relación con la investigación de GitHub

Verificamos en el código de [`trading-signals`](https://github.com/bennycode/trading-signals/tree/main/packages/trading-signals/src/volatility) que proporciona `BollingerBands` y `BollingerBandsWidth`, con pruebas. Este prototipo incluye un cálculo **independiente** para que la primera ejecución funcione sin Internet ni instalaciones. **El siguiente paso es comparar sus valores uno por uno con `trading-signals` y, si coinciden, sustituirlo por esa dependencia.**

## Próximos pasos

1. Incorporar datos históricos auténticos de QQQ y compararlos con los gráficos de TC2000.
2. Instalar `trading-signals`, ejecutar sus pruebas y comparar sus fórmulas.
3. Estudiar si la señal supera una referencia razonable en datos nuevos, con costos, falsos positivos y otras condiciones del mercado.
4. Solo más adelante estudiar el precio real de contratos CALL y PUT.

**Aviso:** uso educativo e investigación. No constituye asesoramiento financiero.
