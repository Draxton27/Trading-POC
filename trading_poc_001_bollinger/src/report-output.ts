import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DataMetadata} from './data-contract.ts';

/** Keep the versioned demonstration reports separate from real-data analysis. */
export function reportDirectory(metadata: DataMetadata, baseDirectory = 'output'): string {
  return metadata.data_class === 'real' ? join(baseDirectory, 'real') : baseDirectory;
}

export function saveReportArtifacts(metadata: DataMetadata, artifacts: {
  reportMarkdown: string;
  reportJson: string;
  signalsCsv: string;
}, baseDirectory = 'output'): string {
  const directory = reportDirectory(metadata, baseDirectory);
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, 'report.md'), artifacts.reportMarkdown);
  writeFileSync(join(directory, 'report.json'), artifacts.reportJson);
  writeFileSync(join(directory, 'signals.csv'), artifacts.signalsCsv);
  return directory;
}
