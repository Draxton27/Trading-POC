# Fase 22: límites documentales de academia

Se conservan por separado el rango óptimo (`minAskCents`, `maxAskCents`) y la columna documental `MÍNIMO Y MÁXIMO` (`outerMinCents`, `outerMaxCents`). Los cuatro importes se guardan en centavos enteros. La interpretación como prima ASK por acción fue proporcionada por el operador; los documentos no verifican explícitamente esa unidad. La evaluación existente continúa utilizando exclusivamente el rango óptimo. Los límites adicionales no representan una señal, un filtro ni una orden.

CSV, XLSX y HTML aceptan el encabezado normalizado `MINIMOYMAXIMO` y expresiones completas `MIN importe MAX importe` o `MIN importe - importe`. Se admiten dólares opcionales, espacios, decimales de hasta dos cifras y guiones cortos o largos. Ambos importes deben ser positivos, seguros y ordenados. Una celda vacía deja ambos límites en `null`; una celda no reconocida, ambigua o inválida también deja ambos en `null`, se indica en las notas de las importaciones nuevas y se cuenta en `unparsedOuterCount`. No se interpretan separadores de miles ni texto adicional. La fecha de referencia no implica vigencia; los registros históricos sin vigencia siguen siendo históricos.

La migración agrega dos columnas anulables sin reconstruir la tabla ni alterar IDs. Al reimportar el mismo SHA-256, se actualizan solo límites ausentes y únicamente si el número, la identidad, el rango óptimo y la fecha de todas las filas coinciden. Una discrepancia o un límite ya guardado contradictorio cancela toda la transacción. Una segunda reimportación es idempotente. Nunca se guarda el archivo fuente.

## Actualizar los 53 registros existentes en Windows

1. Detener la aplicación, la API y cualquier otro proceso que use la base. Instalar la versión que contiene esta fase: durante la revisión, desde la raíz del repositorio, ejecutar `git fetch origin` y `git switch codex/phase22-academy-bounds`; después del merge usar `git switch main` y `git pull --ff-only origin main`. Ejecutar `npm ci`.
2. La CLI usa `TRADING_POC_DB_PATH` si está definida, o `TRADING_POC_PRIVATE_DIR\trading-poc.sqlite`, o por defecto `%LOCALAPPDATA%\Trading-POC\trading-poc.sqlite`. Asegurarse de que las variables de entorno de esta consola sean las mismas que utiliza la aplicación; no se cargan automáticamente desde `.env` por esta CLI. Con todos los procesos desconectados, copiar la base y sus archivos WAL auxiliares si existen, sin sobrescribir una copia anterior, con PowerShell desde la raíz:

   ```powershell
   $phase22Db = if ($env:TRADING_POC_DB_PATH) { $env:TRADING_POC_DB_PATH } elseif ($env:TRADING_POC_PRIVATE_DIR) { Join-Path $env:TRADING_POC_PRIVATE_DIR 'trading-poc.sqlite' } else { Join-Path $env:LOCALAPPDATA 'Trading-POC\trading-poc.sqlite' }
   $phase22Db = (Resolve-Path -LiteralPath $phase22Db).Path
   $phase22Backup = "$phase22Db.phase22-backup"
   foreach ($suffix in @('', '-wal', '-shm')) { if (Test-Path -LiteralPath "$phase22Backup$suffix") { throw "Ya existe: $phase22Backup$suffix" } }
   foreach ($suffix in @('', '-wal', '-shm')) { if (Test-Path -LiteralPath "$phase22Db$suffix") { Copy-Item -LiteralPath "$phase22Db$suffix" -Destination "$phase22Backup$suffix" } }
   ```

3. Reimportar el **archivo original exacto**, conservando sus bytes. Por ejemplo, si este es el archivo que originó los 53 registros:

   ```powershell
   npm run academy:import -- --existing-only "C:\Users\danie\Downloads\inversiones\inversiones\RANGO DE PRECIOS ACTUAL.xlsx"
   ```

   Si los registros proceden de otros documentos, repetir para cada original. `--existing-only` impide insertar un documento de SHA distinto: ante un error de hash, localizar el original exacto; no omitir el indicador para forzar la operación. La primera ejecución abre la base y aplica la migración automáticamente.
4. Comprobar el JSON de salida: `alreadyPresent: true`, `recordCount` igual al número de filas de ese documento, `updatedCount` igual a las filas completadas y `unparsedOuterCount` igual al número de celdas no reconocidas. No se garantiza que todos los 53 tengan límites interpretables. Ejecutar el mismo comando nuevamente debe dar `updatedCount: 0`; el número total de registros e IDs permanece intacto. Si hay celdas no reconocidas, revisar el original localmente antes de ampliar el parser. Un fallo de identidad o contradicción cancela las actualizaciones de ese documento.
5. Reiniciar la aplicación y consultar `GET /api/v1/academy/ranges?symbol=NVDA&asOf=2026-10-19`; verificar ambos intervalos y la referencia histórica. No subir el documento, SQLite, copia de seguridad ni reportes privados a Git.

Los archivos de distinto SHA no son la misma versión aunque tengan el mismo nombre. Esta fase no reconstruye versiones anteriores ni inventa vigencias. Los resultados documentales no prueban que las cotizaciones estén disponibles ni que un precio sea ejecutable.
