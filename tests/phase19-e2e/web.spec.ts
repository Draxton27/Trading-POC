import {test,expect} from '@playwright/test';
test('libera la seleccion PAPER incluso si se quita mientras llega la suscripcion',async({page})=>{
  let finishResponse:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{finishResponse=resolve;});
  let selectedConsumer='',released:string[]=[];
  const item={conId:12345,right:'CALL',strike:200,expiration:'20261023',multiplier:100,bid:null,ask:null};
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:new Date().toISOString()}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261023'],source:'simulado'}}));
  await page.route('**/api/v1/options/strikes?*',route=>route.fulfill({json:{items:[200],total:1,offset:0,nextOffset:null,expiration:'20261023'}}));
  await page.route('**/api/v1/options/contracts?*',route=>route.fulfill({json:{items:[item],source:'simulado'}}));
  await page.route('**/api/v1/options/comparison',async route=>{
    selectedConsumer=route.request().postDataJSON().consumerId;
    await gate;
    await route.fulfill({json:{item}});
  });
  await page.route('**/api/v1/market/subscriptions/*',route=>{
    released.push(new URL(route.request().url()).searchParams.get('consumerId')??'');
    return route.fulfill({json:{released:'12345'}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('button',{name:'Comparar',exact:true}).first().click();
  await expect.poll(()=>selectedConsumer).not.toBe('');
  await page.locator('.options-comparison summary').click();
  await page.getByRole('button',{name:'Quitar contrato 12345'}).click();
  expect(released).not.toContain(selectedConsumer);
  finishResponse();
  await expect.poll(()=>released).toContain(selectedConsumer);
});
test('compara hasta cuatro contratos DEMO y conserva la seleccion al cambiar de tipo',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  const compare=page.getByRole('button',{name:'Comparar',exact:true});
  await expect(compare).toHaveCount(5);
  for(let i=0;i<4;i++)await compare.first().click();
  await expect(compare).toHaveCount(1);
  await expect(compare.first()).toBeDisabled();
  await page.locator('.options-comparison summary').click();
  const table=page.getByRole('table',{name:'Comparador de opciones'});
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(table.getByText('conId 90000')).toBeVisible();
  await page.getByRole('button',{name:'PUT',exact:true}).click();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await table.getByRole('button',{name:'Quitar contrato 90000'}).click();
  await page.getByRole('button',{name:'Comparar',exact:true}).first().click();
  await expect(table.getByText('conId 90100')).toBeVisible();
});
test('analiza un contrato DEMO con capital hipotético sin consultar cuentas ni órdenes',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{if(/\/api\/v1\/(?:orders|positions|executions)(?:\/|\?|$)/.test(request.url()))
    forbidden.push(request.url());});
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('button',{name:'Ver análisis'}).first().click();
  const panel=page.locator('.option-analysis');
  await expect(panel.getByText('Sintético',{exact:true})).toBeVisible();
  await expect(panel.getByText('Prima bruta, 1 contrato(s)')).toBeVisible();
  await expect(panel.locator('dl').first().locator('dd').nth(1)).toHaveText('$521,00');
  await panel.getByRole('spinbutton',{name:'Cantidad hipotética de contratos'}).fill('2');
  await expect(panel.locator('dl').first().locator('dd').nth(1)).toHaveText(/\$1\.?042,00/);
  await panel.getByRole('spinbutton',{name:'Capital hipotético USD'}).fill('500');
  await expect(panel.getByText('Presupuesto hipotético excedido.')).toBeVisible();
  await panel.getByRole('spinbutton',{name:'Precio hipotético NVDA al vencimiento USD'}).fill('220');
  await expect(panel.getByText('Resultado bruto')).toBeVisible();
  await expect(panel.getByText('P&L neto no disponible', {exact:false})).toBeVisible();
  expect(forbidden).toEqual([]);
});
test('inicio DEMO muestra series, estado y gráfico funcional',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:/Buenos días/})).toBeVisible();
  await expect(page.getByText('DEMO',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:/NVDA/}).first()).toBeVisible();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
  await expect(page.getByText('Sin envío de órdenes')).toBeVisible();
  expect(errors).toEqual([]);
});
test('mercado cambia símbolo y temporalidad sin acceso a TWS',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Mercado',exact:true}).click();
  await page.locator('.chart-controls button',{hasText:'QQQ'}).click();
  await expect(page.locator('.chart-heading h2')).toContainText('QQQ');
  await page.locator('.chart-controls button',{hasText:'1h'}).click();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'Cargar historial anterior'}).click();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
});
test('opciones y diario etiquetan datos sintéticos y admiten no operar',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.locator('.options-observed')).toContainText('DEMO sintético');
  await expect(page.getByRole('table',{name:'Cadena de opciones'}).locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'PUT',exact:true}).click();
  await expect(page.getByRole('table',{name:'Cadena de opciones'}).locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'Diario'}).click();
  await expect(page.locator('select[name="direction"]')).toHaveValue('no_trade');
  await expect(page.getByText(/No se crean ejemplos ficticios/)).toBeVisible();
});
test('cadena PAPER conserva el contrato válido ante resolución parcial y muestra diagnóstico',async({page})=>{
  await page.route('**/api/v1/health',route=>route.fulfill({json:{ok:true,mode:'PAPER',offlineAvailable:false,timeUtc:new Date().toISOString()}}));
  await page.route('**/api/v1/options/expirations',route=>route.fulfill({json:{items:['20261028'],source:'IBKR Paper'}}));
  await page.route('**/api/v1/options/strikes?*',route=>route.fulfill({json:{items:[220,225],total:2,offset:0,nextOffset:null,expiration:'20261028'}}));
  await page.route('**/api/v1/options/contracts?*',route=>route.fulfill({json:{items:[{conId:12345,symbol:'NVDA',right:'CALL',strike:220,
    expiration:'20261028',multiplier:100,currency:'USD',bid:null,ask:null,dataStatus:'cotizacion_pendiente'}],
    source:'IBKR Paper',referenceSource:'ALPACA_IEX_LAST_COMPLETE_BAR',referencePrice:221,
    errors:[{strike:225,code:'INVALID_CONTRACT',message:'Definición incompatible: expiration.',mismatchFields:['expiration'],requestId:'test',ibkrCode:null}]}}));
  await page.route('**/api/v1/options/quotes?*',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/market/subscriptions/*',route=>route.fulfill({json:{released:'12345'}}));
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.getByRole('table',{name:'Cadena de opciones'}).locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.options-observed')).toContainText('Alpaca IEX · última vela completa');
  await expect(page.getByText('No fue posible cargar 1 contrato(s).')).toBeVisible();
  await page.getByText('Ver detalles técnicos').click();
  await expect(page.getByText(/Campos: expiration/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Ver análisis'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Comprar|Vender|Enviar orden/i})).toHaveCount(0);
});
test('cadena de opciones mantiene controles accesibles en pantalla móvil',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.getByRole('heading',{name:'Cadena de opciones'})).toBeVisible();
  await expect(page.getByRole('button',{name:'CALL',exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:'Cadena de opciones'})).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.options-hero')).toBeVisible();
});
