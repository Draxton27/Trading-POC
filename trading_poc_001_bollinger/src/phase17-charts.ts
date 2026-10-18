import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from './phase16-ledger.ts';

export type ChartManifest = {captureId: string; sha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  capturedAtUtc: string | null; capturedAtSource: 'operator_declared' | 'unknown';
  originalFileMtimeUtc: string; mtimeVerification: 'unverified_filesystem_metadata';
  importedAtUtc: string; privateFileName: string};

export function preserveChart(privateRoot: string, source: string, captureId: string,
  capturedAtUtc: string | null, importedAtUtc = new Date().toISOString()): ChartManifest {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(captureId)) throw new Error('captureId inválido.');
  if (capturedAtUtc && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(capturedAtUtc) ||
      !Number.isFinite(Date.parse(capturedAtUtc)) ||
      new Date(capturedAtUtc).toISOString().slice(0, 19) !== capturedAtUtc.slice(0, 19) ||
      capturedAtUtc > importedAtUtc)) throw new Error('Hora de captura inválida.');
  const bytes = readFileSync(source);
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error('Tamaño de captura inválido.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Solo se aceptan PNG, JPEG o WebP originales.');
  const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp';
  const extension = png ? 'png' : jpeg ? 'jpg' : 'webp';
  const hash = sha256(bytes);
  const charts = join(privateRoot, 'charts');
  mkdirSync(charts, {recursive: true, mode: 0o700});
  const privateFileName = `${hash}.${extension}`;
  const target = join(charts, privateFileName);
  if (!existsSync(target)) writeFileSync(target, bytes, {flag: 'wx', mode: 0o600});
  else if (sha256(readFileSync(target)) !== hash) throw new Error('Captura privada alterada.');
  const manifestPath = join(charts, `${captureId}.json`);
  if (existsSync(manifestPath)) {
    const prior = JSON.parse(readFileSync(manifestPath, 'utf8')) as ChartManifest;
    if (prior.sha256 !== hash || prior.capturedAtUtc !== capturedAtUtc) {
      throw new Error('captureId ya existe con otra captura; usar ID nuevo y conservar la original.');
    }
    return prior;
  }
  const manifest: ChartManifest = {captureId, sha256: hash, mimeType,
    capturedAtUtc, capturedAtSource: capturedAtUtc ? 'operator_declared' : 'unknown',
    originalFileMtimeUtc: statSync(source).mtime.toISOString(),
    mtimeVerification: 'unverified_filesystem_metadata', importedAtUtc,
    privateFileName};
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
  return manifest;
}
