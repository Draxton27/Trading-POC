import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {postDecisionObservations} from '../../trading_poc_001_bollinger/src/phase38c-replay.ts';
import type {MarketCalendar} from '../../trading_poc_001_bollinger/src/alpaca-calendar.ts';
import type {Candle} from '../../trading_poc_001_bollinger/src/domain.ts';

const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const day='2026-10-20',start=Date.parse(`${day}T13:30:00Z`);
const bars=():Candle[]=>Array.from({length:26},(_,i)=>({timestamp:new Date(start+i*900_000).toISOString(),
  open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1,volume:100+i}));
const calendar:MarketCalendar=new Map([[day,{open:570,close:960}]]);

describe('Fase 38E, replay IEX controlado',()=>{
  it('separa variables causales y desenlace; un hueco deja el objetivo excluido',()=>{
    const full=bars(),original=postDecisionObservations(full,calendar);
    const changed=bars();changed[25]={...changed[25]!,close:changed[25]!.close+10,high:changed[25]!.high+10};
    const future=postDecisionObservations(changed,calendar);
    const early=original.find(row=>row.bar_start_utc===full[20]!.timestamp&&row.scenario==='ideal')!;
    expect(early.features).toEqual(future.find(row=>row.bar_start_utc===full[20]!.timestamp&&row.scenario==='ideal')!.features);
    expect(early.label).not.toEqual(future.find(row=>row.bar_start_utc===full[20]!.timestamp&&row.scenario==='ideal')!.label);
    const missing=postDecisionObservations(full.filter((_,i)=>i!==24),calendar);
    expect(missing.find(row=>row.bar_start_utc===full[20]!.timestamp&&row.scenario==='ideal')?.exclusion).toBe('FUTURE_BARS_MISSING');
  });
  it('prepara solo un histórico IEX verificado y rechaza un hash alterado',()=>{
    const privateRoot=resolve('private');mkdirSync(privateRoot,{recursive:true});
    const temp=mkdtempSync(join(privateRoot,'phase38e-test-')),source=join(temp,'source'),out=join(temp,'dataset');
    mkdirSync(source);
    try{
      const query={schema:'phase38d-v1',symbol:'NVDA',feed:'iex',timeframe:'1Min',adjustment:'raw',
        start:`${day}T00:00:00.000Z`,end:'2026-10-21T00:00:00.000Z'};
      const strict=['timestamp,open,high,low,close,volume',...bars().map(b=>
        [b.timestamp,b.open,b.high,b.low,b.close,b.volume].join(','))].join('\n')+'\n';
      const files:Record<string,string>={
        'query.json':JSON.stringify(query),
        'calendar.json':JSON.stringify({provider:'Alpaca Market Calendar',sessions:[{date:day,open:570,close:960}]}),
        'minutes.csv':'timestamp,open,high,low,close,volume,trade_count\n',
        'strict-15m.csv':strict,
      };
      files['calendar.json.sha256']=sha(files['calendar.json']!)+'\n';
      files['report.json']=JSON.stringify({schema:'phase38d-report-v1',source:query,
        sha256:{calendar:sha(files['calendar.json']!),strict15mCsv:sha(strict)},summary:{strict15m:26}});
      for(const [name,value] of Object.entries(files))writeFileSync(join(source,name),value);
      writeFileSync(join(source,'SHA256SUMS'),Object.entries(files).map(([name,value])=>`${sha(value)}  ${name}`).join('\n')+'\n');
      const execute=()=>spawnSync(process.execPath,['--import','tsx','trading_poc_001_bollinger/src/phase38e-cli.ts',
        '--source',source,'--out',out],{cwd:process.cwd(),encoding:'utf8'});
      const result=execute();expect(result.status).toBe(0);
      const observations=JSON.parse(readFileSync(join(out,'observations.json'),'utf8')) as Array<Record<string,unknown>>;
      expect(observations.every(row=>row.mode==='HISTORICAL_REPLAY'&&row.phase==='38E'&&row.feed==='iex'&&row.historical_received_at_utc===null)).toBe(true);
      writeFileSync(join(source,'strict-15m.csv'),strict.replace('100.5','200.5'));
      expect(execute().status).not.toBe(0);
    }finally{rmSync(temp,{recursive:true,force:true});}
  });
});
