import {test,expect} from '@playwright/test';

test('DEMO registra entrada y salida hipotéticas sin consultar órdenes ni ejecuciones',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{
    if(/\/api\/v1\/(?:orders|executions|positions)(?:\/|\?|$)/.test(request.url()))forbidden.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('button',{name:/^Analizar CALL strike/}).first().click();
  const panel=page.locator('.option-analysis');
  await expect(panel.getByRole('button',{name:'Registrar entrada simulada'})).toBeVisible();
  await panel.getByRole('button',{name:'Registrar entrada simulada'}).click();
  await panel.getByRole('spinbutton',{name:'Prima hipotética de entrada'}).fill('2');
  await panel.getByRole('spinbutton',{name:'Cantidad de contratos simulados'}).fill('2');
  await panel.getByRole('spinbutton',{name:'Comisión de entrada simulada'}).fill('0');
  await panel.getByRole('checkbox',{name:'Confirmar simulación sin orden'}).check();
  await panel.getByRole('button',{name:'Confirmar entrada simulada'}).click();
  await expect(panel.getByText('Entrada hipotética registrada.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Simulador Paper'}).click();
  await expect(page.getByText('DEMO_SYNTHETIC',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('2/2')).toBeVisible();
  await page.getByRole('button',{name:'Ver detalle / registrar salida'}).click();
  await page.getByRole('spinbutton',{name:'Prima hipotética de salida'}).fill('3');
  await page.getByRole('spinbutton',{name:'Cantidad de salida simulada'}).fill('1');
  await page.getByRole('textbox',{name:'Motivo de salida simulada'}).fill('cierre parcial sintético');
  await page.getByRole('checkbox',{name:'Confirmar salida simulada'}).check();
  await page.getByRole('button',{name:'Confirmar salida simulada'}).click();
  await expect(page.getByText('PARTIALLY_CLOSED',{exact:false}).first()).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();
  expect(forbidden).toEqual([]);
});

test('capital global permanece igual al paginar más de 25 posiciones y cerrar una parcialmente',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const session=await fetch('/api/v1/session').then(response=>response.json()) as {token:string};
    const request=async(path:string,body:Record<string,unknown>)=>{
      const response=await fetch(`/api/v1/simulator${path}`,{method:'POST',
        headers:{'content-type':'application/json','x-local-token':session.token},body:JSON.stringify(body)});
      if(!response.ok)throw new Error(`Simulador HTTP ${response.status}: ${await response.text()}`);
      return response.json();
    };
    let firstId='';
    for(let i=0;i<30;i++){
      const at=new Date().toISOString();
      const opened=await request('/positions',{idempotencyKey:crypto.randomUUID(),conId:90000,
        quantity:i===0?2:1,premiumPerShare:2,priceOrigin:'MANUAL_INPUT',entryFeeUsd:0,
        decisionAtUtc:at,simulatedEntryAtUtc:at,confirmHypothetical:true});
      if(i===0)firstId=opened.position.positionId;
    }
    const at=new Date().toISOString();
    await request(`/positions/${firstId}/close`,{idempotencyKey:crypto.randomUUID(),quantity:1,
      premiumPerShare:3,priceOrigin:'MANUAL_INPUT',exitFeeUsd:0,decisionAtUtc:at,
      simulatedExitAtUtc:at,reason:'cierre parcial sintético',confirmHypothetical:true});
    const first=await fetch('/api/v1/simulator/positions?offset=0&limit=25').then(r=>r.json());
    const second=await fetch('/api/v1/simulator/positions?offset=25&limit=25').then(r=>r.json());
    return {first,second};
  });
  expect(result.first.total).toBeGreaterThan(25);
  expect(result.first.items).toHaveLength(25);
  expect(result.second.items.length).toBeGreaterThan(0);
  expect(result.first.totalRemainingPremiumExposureUsd).toBe(result.second.totalRemainingPremiumExposureUsd);
  const exposure=result.first.totalRemainingPremiumExposureUsd as number;
  const capital=exposure+1000;
  await page.getByRole('button',{name:'Simulador Paper'}).click();
  await page.getByRole('spinbutton',{name:'Capital hipotético del simulador'}).fill(String(capital));
  const summary=page.getByText('Prima restante comprometida (todas las páginas)',{exact:false});
  const currency=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
  await expect(summary).toContainText(currency(exposure));
  await expect(summary).toContainText(currency(1000));
  await page.getByRole('button',{name:'Siguiente'}).click();
  await expect(page.getByText(/página 2/)).toBeVisible();
  await expect(summary).toContainText(currency(exposure));
  await expect(summary).toContainText(currency(1000));
  await page.getByRole('button',{name:'Anterior'}).click();
  await expect(page.getByText(/página 1/)).toBeVisible();
  await expect(summary).toContainText(currency(exposure));
});
