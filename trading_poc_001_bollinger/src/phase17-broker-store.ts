import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {basename, join} from 'node:path';
import {sha256} from './phase16-ledger.ts';
import {BROKER_COLUMNS, importBrokerExecutions, type BrokerImport} from './phase17-broker.ts';
import {csvCell, parseCsvRows} from './phase17-csv.ts';

export type BrokerSource = {schemaVersion: 1; sourceSha256: string;
  importedAtUtc: string; originalFileName: string | null; rawCsvBase64: string;
  envelopeSha256: string};
export type BrokerStoreState = BrokerImport & {sourceFiles: Array<{
  sourceSha256: string; importedAtUtc: string; originalFileName: string | null}>;
  executionSources: Record<string, string[]>; stateSha256: string};

const sourceDirectory = (privateRoot: string) => join(privateRoot, 'broker-sources');
const validUtc = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

function acquireLock(path: string): number {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      fsyncSync(fd);
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number(readFileSync(path, 'utf8'));
      let alive = false;
      if (Number.isSafeInteger(owner) && owner > 0) {
        try {process.kill(owner, 0); alive = true;}
        catch (probe) {alive = (probe as NodeJS.ErrnoException).code !== 'ESRCH';}
      }
      if (alive || !owner && Date.now() - statSync(path).mtimeMs < 60_000) {
        throw new Error('Otra importación privada está activa.');
      }
      unlinkSync(path);
    }
  }
  throw new Error('No se pudo recuperar el bloqueo privado.');
}

function sourceRows(source: BrokerSource): string[][] {
  const {envelopeSha256, ...body} = source;
  if (sha256(JSON.stringify(body)) !== envelopeSha256) {
    throw new Error(`Sobre privado del bróker alterado: ${source.sourceSha256}`);
  }
  const bytes = Buffer.from(source.rawCsvBase64, 'base64');
  if (sha256(bytes) !== source.sourceSha256 ||
      bytes.toString('base64') !== source.rawCsvBase64) {
    throw new Error(`Archivo original privado alterado: ${source.sourceSha256}`);
  }
  if (!validUtc(source.importedAtUtc)) throw new Error('Hora de importación privada inválida.');
  const rows = parseCsvRows(bytes.toString('utf8'));
  if (!rows.length || rows[0]!.join(',') !== BROKER_COLUMNS.join(',')) {
    throw new Error('Cabecera original del bróker distinta del esquema F17.');
  }
  for (const row of rows.slice(1)) {
    if (row.length !== BROKER_COLUMNS.length ||
        !validUtc(row[7]!) || Date.parse(row[7]!) > Date.parse(source.importedAtUtc)) {
      throw new Error('Ejecución original incompleta o posterior a su importación.');
    }
  }
  return rows.slice(1);
}

function loadSources(privateRoot: string): BrokerSource[] {
  const directory = sourceDirectory(privateRoot);
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory);
  if (names.some(name => !/^[a-f0-9]{64}\.json$/.test(name) &&
      !/^\.[a-f0-9]{64}\.[a-f0-9-]+\.partial$/.test(name))) {
    throw new Error('Archivo desconocido en el almacén privado del bróker.');
  }
  return names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .sort().map(name => {
      const source = JSON.parse(readFileSync(join(directory, name), 'utf8')) as BrokerSource;
      if (source.schemaVersion !== 1 || name !== `${source.sourceSha256}.json`) {
        throw new Error(`Sobre privado del bróker inválido: ${name}`);
      }
      sourceRows(source);
      return source;
    });
}

function rebuild(sources: BrokerSource[], atUtc: string): BrokerStoreState {
  const executionSources = new Map<string, Set<string>>();
  const dataRows: string[][] = [];
  for (const source of [...sources].sort((a, b) =>
    a.sourceSha256.localeCompare(b.sourceSha256))) {
    for (const row of sourceRows(source)) {
      dataRows.push(row);
      const ids = executionSources.get(row[0]!) ?? new Set<string>();
      ids.add(source.sourceSha256);
      executionSources.set(row[0]!, ids);
    }
  }
  const combined = BROKER_COLUMNS.join(',') + '\n' + dataRows.map(row =>
    row.map(csvCell).join(',') + '\n').join('');
  const result = importBrokerExecutions(combined, atUtc);
  const sourceFiles = [...sources].sort((a, b) =>
    a.sourceSha256.localeCompare(b.sourceSha256)).map(source => ({
      sourceSha256: source.sourceSha256, importedAtUtc: source.importedAtUtc,
      originalFileName: source.originalFileName}));
  const sourceMap = Object.fromEntries([...executionSources].sort(([a], [b]) =>
    a.localeCompare(b)).map(([id, hashes]) => [id, [...hashes].sort()]));
  return {...result, sourceFiles, executionSources: sourceMap,
    stateSha256: sha256(JSON.stringify({sourceFiles, result, sourceMap}))};
}

export function readBrokerStore(privateRoot: string, atUtc = new Date().toISOString()): BrokerStoreState {
  return rebuild(loadSources(privateRoot), atUtc);
}

/** One immutable private envelope per original CSV; all inventory is rebuilt from them. */
export function importBrokerSource(privateRoot: string, raw: Buffer,
  originalFileName: string | null, importedAtUtc = new Date().toISOString()):
  {state: BrokerStoreState; sourceSha256: string; alreadyPresent: boolean} {
  if (!validUtc(importedAtUtc)) throw new Error('Hora de importación UTC inválida.');
  mkdirSync(privateRoot, {recursive: true, mode: 0o700});
  const lockPath = join(privateRoot, '.broker-import.lock');
  const lock = acquireLock(lockPath);
  try {
    const sources = loadSources(privateRoot);
    const sourceSha256 = sha256(raw);
    const previous = sources.find(source => source.sourceSha256 === sourceSha256);
    if (previous) return {state: rebuild(sources, importedAtUtc), sourceSha256,
      alreadyPresent: true};
    const body = {schemaVersion: 1 as const, sourceSha256,
      importedAtUtc, originalFileName: originalFileName ? basename(originalFileName) : null,
      rawCsvBase64: raw.toString('base64')};
    const source: BrokerSource = {...body, envelopeSha256: sha256(JSON.stringify(body))};
    const next = rebuild([...sources, source], importedAtUtc);
    const directory = sourceDirectory(privateRoot);
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const target = join(directory, `${sourceSha256}.json`);
    const temporary = join(directory, `.${sourceSha256}.${randomUUID()}.partial`);
    const fd = openSync(temporary, 'wx', 0o600);
    try {writeFileSync(fd, JSON.stringify(source) + '\n'); fsyncSync(fd);}
    finally {closeSync(fd);}
    renameSync(temporary, target);
    const dirFd = openSync(directory, 'r');
    try {fsyncSync(dirFd);} finally {closeSync(dirFd);}
    return {state: next, sourceSha256, alreadyPresent: false};
  } finally {closeSync(lock); unlinkSync(lockPath);}
}
