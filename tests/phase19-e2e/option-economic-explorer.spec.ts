import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {test,expect} from '@playwright/test';

const directory=process.env.TRADING_POC_SCREENSHOT_DIR??'test-results/phase41u-explorer';
mkdirSync(directory,{recursive:true});

test('41U: modos, capital, filtros, comparador y panel en DEMO sintético',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{if(/\/api\/v1\/(orders|executions)(\/|\?|$)/.test(request.url()))forbidden.push(request.url());});
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await page.getByRole('button',{name:'Opciones'}).click();
  const table=page.getByRole('table',{name:'Cadena de opciones'});
  await expect(page.getByRole('button',{name:'Cerca del precio'})).toHaveAttribute('aria-pressed','true');
  await expect(table.locator('tr.chain-strike-row')).toHaveCount(3);
  await expect(table.locator('.chain-contract').first()).toContainText('Costo bruto');
  await page.screenshot({path:join(directory,'near-demo.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Por presupuesto'}).click();
  await page.getByLabel('Capital del explorador').fill('1000');
  await page.getByLabel('Cantidad del explorador').fill('2');
  await expect(table.locator('.chain-contract').first()).toContainText('Capital comprometido');
  await page.screenshot({path:join(directory,'budget-demo.png'),fullPage:true,animations:'disabled'});
  await page.getByText('Filtros económicos opcionales').click();
  await page.getByLabel('ASK máximo').fill('1');
  await expect(table.locator('.chain-contract').first()).toContainText('Excede un límite');
  await page.getByRole('checkbox',{name:'Mostrar solo coincidencias evaluables'}).check();
  await expect(table).toContainText('Ninguno de los contratos consultados coincide');
  await page.getByRole('checkbox',{name:'Mostrar solo coincidencias evaluables'}).uncheck();
  await page.getByLabel('ASK máximo').fill('');
  await page.getByRole('button',{name:/Comparar CALL strike 220/}).click();
  await page.getByRole('button',{name:/Comparar PUT strike 220/}).click();
  await page.getByRole('button',{name:/Comparar contratos \(2\/4\)/}).click();
  const compare=page.getByRole('table',{name:'Comparador de opciones'});
  await expect(compare).toContainText('Capital %');
  await expect(compare).toContainText('Calidad / feed / hora');
  await expect(compare).toContainText('$826,00');
  await page.getByLabel('Cantidad del explorador').fill('3');
  await expect(compare).toContainText('$1239,00');
  await page.getByLabel('Cantidad del explorador').fill('2');
  await page.screenshot({path:join(directory,'comparison-capital-demo.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:/Analizar CALL strike 220/}).first().click();
  await expect(page.getByRole('dialog',{name:'Panel de contrato'})).toContainText('Cómo interpretar este contrato');
  await expect(page.getByRole('dialog',{name:'Panel de contrato'}).getByLabel('Cantidad hipotética de contratos')).toHaveValue('2');
  await page.screenshot({path:join(directory,'economic-panel-demo.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Cerrar panel de contrato'}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('table',{name:'Cadena de opciones'})).toBeVisible();
  expect(await page.locator('.chain-grid-wrap').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await expect(page.getByText('deslice la tabla horizontalmente')).toBeVisible();
  await page.screenshot({path:join(directory,'mobile-explorer-demo.png'),fullPage:true,animations:'disabled'});
  expect(forbidden).toEqual([]);
});

test('41U: ASK ausente y feed retrasado conservan calidad y accesibilidad',async({page})=>{
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:new Date().toISOString()}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261030'],source:'IBKR Paper'}}));
  await page.route('**/api/v1/options/strikes?*',route=>route.fulfill({json:{items:[220,225,230],total:3,offset:0,
    nextOffset:null,expiration:'20261030'}}));
  const at=new Date().toISOString();
  const base={symbol:'NVDA',right:'CALL',expiration:'20261030',multiplier:100,currency:'USD',provider:'IBKR',
    receivedAtUtc:at,marketTimestampUtc:at};
  const rows=[{strike:220,call:{...base,conId:201,strike:220,bid:2,ask:null,feedType:'DELAYED',
    marketDataStatus:'partial',dataStatus:'cotizacion_parcial'},put:null,issues:[]},
  {strike:225,call:{...base,conId:202,strike:225,bid:2,ask:2.2,feedType:'FROZEN',
    marketDataStatus:'available',dataStatus:'recibido'},put:null,issues:[]}];
  await page.route('**/api/v1/options/chain?*',route=>route.fulfill({json:{expiration:'20261030',rows,errors:[],
    source:'IBKR Paper',referenceSource:'MANUAL_STRIKE',referencePrice:220,
    subscriptionStatus:{requested:2,limit:10}}}));
  await page.route('**/api/v1/options/quotes?*',route=>route.fulfill({json:{items:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('button',{name:'Por presupuesto'}).click();
  await page.getByLabel('Costo máximo por contrato').fill('300');
  const table=page.getByRole('table',{name:'Cadena de opciones'});
  await expect(table.locator('.chain-contract').first()).toContainText('Filtro no evaluable');
  await expect(table.locator('.chain-contract').nth(1)).toContainText('Congelado');
  await page.screenshot({path:join(directory,'non-evaluable-paper-fixture.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Exploración libre'}).click();
  await page.locator('.options-strike-list').getByRole('button',{name:'$230,00'}).click();
  await expect(page.getByRole('button',{name:'Volver a la referencia de NVDA'})).toBeVisible();
  await page.getByRole('button',{name:'Volver a la referencia de NVDA'}).click();
  await expect(page.getByRole('button',{name:'Volver a la referencia de NVDA'})).toHaveCount(0);
  await page.screenshot({path:join(directory,'delayed-frozen-paper-fixture.png'),animations:'disabled'});
});
