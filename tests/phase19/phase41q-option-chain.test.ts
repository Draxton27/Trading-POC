import {describe,expect,it} from 'vitest';
import {validateOptionIdentity} from '../../apps/api/src/options/identity.ts';
import {iexBarReference,quoteReference,selectContractStrikes} from '../../apps/api/src/options/selection.ts';

const requested={symbol:'NVDA',right:'CALL' as const,expiration:'20261028',strike:220};
const resolved={conId:12345,symbol:'NVDA',secType:'OPT',currency:'USD',right:'CALL',
  expiration:'20261028',strike:220,multiplier:100,tradingClass:'NVDA'};

describe('Fase 41Q: identidad exacta del contrato',()=>{
  it('admite las dos representaciones inequívocas de CALL y PUT y sufijo horario IBKR',()=>{
    expect(validateOptionIdentity({...resolved,right:'C',expiration:'20261028 16:00:00',multiplier:'100',strike:'220'},requested)
      .contract).toMatchObject({right:'CALL',expiration:'20261028',strike:220,multiplier:100});
    expect(validateOptionIdentity({...resolved,right:'P'}, {...requested,right:'PUT'}).mismatchFields).toEqual([]);
    expect(validateOptionIdentity({...resolved,right:'PUT'}, {...requested,right:'PUT'}).mismatchFields).toEqual([]);
  });
  it.each([
    [{conId:null},'conId'],[{conId:0},'conId'],[{secType:'STK'},'secType'],[{symbol:'QQQ'},'symbol'],
    [{currency:'CAD'},'currency'],[{right:'CALL/PUT'},'right'],[{expiration:'20261029'},'expiration'],
    [{expiration:'20261028 arbitrary'},'expiration'],[{expiration:'20260230'},'expiration'],
    [{expiration:'20261028 99:99:99'},'expiration'],[{strike:220.01},'strike'],[{multiplier:10},'multiplier'],
    [{tradingClass:'NVDL'},'tradingClass'],[{tradingClass:null},'tradingClass']
  ])('rechaza discrepancia %j en %s',(change,field)=>{
    expect(validateOptionIdentity({...resolved,...change},requested).mismatchFields).toContain(field);
  });
  it('no aproxima strikes ni infiere datos ausentes',()=>{
    expect(validateOptionIdentity({...resolved,strike:'220.0001'},requested).contract).toBeNull();
    expect(validateOptionIdentity({},requested).contract).toBeNull();
  });
});

describe('Fase 41Q: referencia causal para strikes',()=>{
  const now=Date.parse('2026-10-27T14:00:00Z');
  it('elige cinco strikes cercanos sin consultar toda la cadena',()=>{
    expect(selectContractStrikes([210,215,220,225,230,235,240],5,223)).toEqual([215,220,225,230,235]);
  });
  it('usa un último precio IBKR LIVE recibido recientemente, no delayed o sin proveedor',()=>{
    const q={last:223,provider:'IBKR',feedType:'LIVE',receivedAtUtc:'2026-10-27T13:59:45Z'};
    expect(quoteReference(q,now)).toBe(223);
    expect(quoteReference({...q,feedType:'DELAYED'},now)).toBeNull();
    expect(quoteReference({...q,provider:'UNKNOWN'},now)).toBeNull();
    expect(quoteReference({...q,receivedAtUtc:'2026-10-27T13:59:00Z'},now)).toBeNull();
  });
  it('usa solo la última vela completa IEX si recolector y feed siguen activos',()=>{
    const s={state:'PARTIAL',source:'Alpaca IEX Live',feed:'iex',close:222.5,
      collectorProcessStatus:'ACTIVE',collectorStatus:'SUBSCRIBED',barEndUtc:'2026-10-27T13:45:00Z',
      receivedAtUtc:'2026-10-27T13:45:10Z'};
    expect(iexBarReference(s,now)).toBe(222.5);
    expect(iexBarReference({...s,collectorProcessStatus:'INACTIVE'},now)).toBeNull();
    expect(iexBarReference({...s,state:'STALE'},now)).toBeNull();
    expect(iexBarReference({...s,barEndUtc:'2026-10-27T13:00:00Z'},now)).toBeNull();
    expect(iexBarReference({...s,source:'SIP'},now)).toBeNull();
  });
});
