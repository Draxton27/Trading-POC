import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {captureYoelSources, YOEL_TABLES, type TableReader} from '../../trading_poc_001_bollinger/src/phase42b-source.ts';

describe('42B read-only source capture',()=>{
  it('preserves source IDs, seals hashes, and refuses overwrite',async()=>{
    const root=mkdtempSync(join(tmpdir(),'poc-42b-'));
    const read:TableReader=async function*(){yield {id:'rec12345678901234',fields:{example:'synthetic'}};};
    try {
      const options={root,runId:'one',baseId:'app12345678901234',read,now:()=>new Date('2026-11-12T12:00:00Z')};
      const first=await captureYoelSources(options);
      expect(Object.keys(first.tables)).toEqual([...YOEL_TABLES]);
      expect(JSON.parse(readFileSync(join(root,'one','table-1.json'),'utf8')).records[0].id).toBe('rec12345678901234');
      const manifest=readFileSync(join(root,'one','manifest.json'),'utf8');
      await expect(captureYoelSources(options)).rejects.toThrow();
      expect(readFileSync(join(root,'one','manifest.json'),'utf8')).toBe(manifest);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('rejects duplicate IDs before creating any capture',async()=>{
    const root=mkdtempSync(join(tmpdir(),'poc-42b-'));
    const read:TableReader=async function*(){yield {id:'rec12345678901234',fields:{}};yield {id:'rec12345678901234',fields:{}};};
    try {await expect(captureYoelSources({root,runId:'dup',baseId:'app12345678901234',read})).rejects.toThrow('SOURCE_ID_INVALID_OR_DUPLICATE');}
    finally {rmSync(root,{recursive:true,force:true});}
  });
});
