import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {test,expect} from '@playwright/test';

const directory=process.env.TRADING_POC_SCREENSHOT_DIR??'test-results/phase41s-chain';
mkdirSync(directory,{recursive:true});

test('41S: ambos lados, detalle, comparador y vista movil en DEMO aislado',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{if(/\/api\/v1\/(orders|executions)(\/|\?|$)/.test(request.url()))forbidden.push(request.url());});
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await page.getByRole('button',{name:'Opciones'}).click();
  const table=page.getByRole('table',{name:'Cadena de opciones'});
  await expect(table.locator('tr.chain-strike-row')).toHaveCount(3);
  await expect(table.locator('.chain-contract.call')).toHaveCount(3);
  await expect(table.locator('.chain-contract.put')).toHaveCount(3);
  await expect(table.locator('.chain-contract.call').first()).toContainText('Sintético');
  await expect(page.locator('.options-observed')).toContainText('DEMO');
  await page.screenshot({path:join(directory,'desktop-chain-demo.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'5 strikes'}).click();
  await expect(table.locator('tr.chain-strike-row')).toHaveCount(5);
  await expect(table.locator('.chain-contract')).toHaveCount(10);
  await page.getByRole('button',{name:/Seleccionar CALL strike 220/}).focus();
  await page.keyboard.press('Enter');
  const drawer=page.getByRole('dialog',{name:'Panel de contrato'});
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Equilibrio bruto al vencimiento');
  await expect(drawer).toContainText('Análisis técnico NVDA');
  await page.screenshot({path:join(directory,'desktop-contract-drawer-demo.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  await page.getByRole('button',{name:/Comparar CALL strike 220/}).click();
  await page.getByRole('button',{name:/Comparar PUT strike 220/}).click();
  await page.getByRole('button',{name:/Comparar contratos \(2\/4\)/}).click();
  await expect(page.getByRole('table',{name:'Comparador de opciones'}).locator('tbody tr')).toHaveCount(2);
  await page.screenshot({path:join(directory,'desktop-comparison-demo.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Ver CALL'})).toBeVisible();
  await page.getByRole('button',{name:'Ver PUT'}).click();
  await expect(table.locator('.chain-contract.put').first()).toBeVisible();
  await page.screenshot({path:join(directory,'mobile-put-demo.png'),fullPage:true,animations:'disabled'});
  expect(forbidden).toEqual([]);
});

test('41S: definicion Paper sin BID/ASK y Gateway desconectado se distinguen',async({page})=>{
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:new Date().toISOString()}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261030'],source:'IBKR Paper'}}));
  const item={conId:12345,symbol:'NVDA',right:'CALL',strike:220,expiration:'20261030',multiplier:100,
    currency:'USD',bid:null,ask:null,dataStatus:'cotizacion_pendiente'};
  await page.route('**/api/v1/options/chain?*',route=>route.fulfill({json:{rows:[{strike:220,call:item,put:null,issues:[]}],
    errors:[],source:'IBKR Paper',referenceSource:'MANUAL_STRIKE',referencePrice:220}}));
  await page.route('**/api/v1/options/quotes?*',route=>route.fulfill({json:{items:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.locator('.chain-contract.call')).toContainText('N/D');
  await expect(page.locator('.chain-side-empty').first()).toBeVisible();
  await page.screenshot({path:join(directory,'paper-no-quotes.png'),animations:'disabled'});
  await page.route('**/api/v1/options/chain?*',route=>route.fulfill({json:{rows:[],errors:[],source:'IBKR desconectado',
    referenceSource:'NONE',referencePrice:null}}));
  await page.getByRole('button',{name:'Actualizar'}).click();
  await expect(page.locator('.options-state')).toHaveAttribute('data-state','IBKR_DISCONNECTED');
  await page.screenshot({path:join(directory,'gateway-disconnected.png'),animations:'disabled'});
});

test('41T: referencia histórica IEX y fallos parciales no parecen cotizaciones Live',async({page})=>{
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:new Date().toISOString()}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261030'],source:'IBKR Paper'}}));
  await page.route('**/api/v1/options/chain?*',route=>route.fulfill({json:{expiration:'20261030',
    rows:[{strike:140,call:{conId:101,symbol:'NVDA',right:'CALL',strike:140,expiration:'20261030',multiplier:100,
      bid:null,ask:null,feedType:'DELAYED',dataStatus:'cotizacion_parcial'},put:null,
      issues:[{right:'PUT',strike:140,code:'PAGE_TIMEOUT',message:'Consulta sin verificar',stage:'page_budget',requestId:null,ibkrCode:null}]}],
    errors:[{right:'PUT',strike:140,code:'PAGE_TIMEOUT',message:'Consulta sin verificar',stage:'page_budget',requestId:null,ibkrCode:null}],
    source:'IBKR Paper',referenceSource:'ALPACA_IEX_VERIFIED_SESSION_CLOSE',referenceKind:'HISTORICAL_EXPLORATION',
    referencePrice:140,referenceObservedAtUtc:'2026-10-27T20:00:00Z',referenceReceivedAtUtc:'2026-10-27T20:00:30Z',
    sessionDate:'2026-10-27',ageTradingSessions:1,isCurrent:false,isExecutable:false,
    subscriptionStatus:{requested:2,limit:10},selectionRequired:false}}));
  await page.route('**/api/v1/options/quotes?*',route=>route.fulfill({json:{items:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.locator('.options-observed')).toContainText('Histórico, no es precio actual');
  await expect(page.getByLabel('Resumen de cadena')).toContainText('2 contratos solicitados');
  await expect(page.getByLabel('Resumen de cadena')).toContainText('PAGE_TIMEOUT 1');
  await expect(page.getByRole('table',{name:'Cadena de opciones'})).toContainText('Consulta sin verificar');
  await expect(page.getByRole('table',{name:'Cadena de opciones'})).not.toContainText('ITM');
  await page.screenshot({path:join(directory,'paper-historical-partial.png'),animations:'disabled'});
});

test('41T: BID/ASK presentes no implican frescura ni disponibilidad',async({page})=>{
  const now=Date.now(),receivedAtUtc=new Date(now).toISOString(),oldUtc=new Date(now-60_000).toISOString();
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:receivedAtUtc}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261030'],source:'IBKR Paper'}}));
  const quote=(conId:number,strike:number,feedType:string,at:string,marketDataStatus:string,subscriptionStatus='ACTIVE')=>({
    conId,symbol:'NVDA',right:'CALL',strike,expiration:'20261030',multiplier:100,currency:'USD',provider:'IBKR',
    bid:2,ask:2.2,feedType,receivedAtUtc:at,marketTimestampUtc:at,marketDataStatus,subscriptionStatus,
    dataStatus:subscriptionStatus==='FAILED'?'suscripcion_fallida':marketDataStatus==='unavailable'?'cotizacion_no_disponible':
      at===oldUtc?'obsoleto':'recibido'});
  const items=[quote(301,140,'DELAYED',receivedAtUtc,'available'),quote(302,141,'FROZEN',receivedAtUtc,'available'),
    quote(303,142,'LIVE',oldUtc,'available'),quote(304,143,'LIVE',receivedAtUtc,'unavailable'),
    quote(305,144,'LIVE',receivedAtUtc,'available','FAILED')];
  await page.route('**/api/v1/options/chain?*',route=>route.fulfill({json:{expiration:'20261030',
    rows:items.map(item=>({strike:item.strike,call:item,put:null,issues:[]})),errors:[],source:'IBKR Paper',
    referenceSource:'MANUAL_STRIKE',referencePrice:140,subscriptionStatus:{requested:5,limit:10}}}));
  await page.route('**/api/v1/options/quotes?*',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/options/comparison',route=>{
    const conId=Number(route.request().postDataJSON()?.conId);
    void route.fulfill({json:{item:items.find(item=>item.conId===conId)??null,source:'IBKR Paper'}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  const summary=page.getByLabel('Resumen de cadena'),table=page.getByRole('table',{name:'Cadena de opciones'});
  await expect(summary).toContainText('BID/ASK presentes (no necesariamente vigentes) 5');
  await expect(summary).not.toContainText('cotizaciones completas');
  await expect(table.locator('.chain-contract.call').nth(0)).toContainText('Retrasado');
  await expect(table.locator('.chain-contract.call').nth(1)).toContainText('Congelado');
  await expect(table.locator('.chain-contract.call').nth(2)).toContainText('Obsoleta');
  await expect(table.locator('.chain-contract.call').nth(3)).toContainText('Cotización no disponible');
  await expect(table.locator('.chain-contract.call').nth(4)).toContainText('Suscripción fallida');
  await expect(table).not.toContainText('LIVE reciente');
  await page.getByRole('button',{name:/Analizar CALL strike 143/}).click();
  await expect(page.getByRole('dialog',{name:'Panel de contrato'})).toContainText('Cotización no disponible');
  await page.getByRole('button',{name:'Cerrar panel de contrato'}).click();
  await page.getByRole('button',{name:/Analizar CALL strike 144/}).click();
  await expect(page.getByRole('dialog',{name:'Panel de contrato'})).toContainText('Suscripción fallida');
  await expect(page.getByRole('dialog',{name:'Panel de contrato'})).not.toContainText('LIVE reciente');
});
