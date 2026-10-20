import {test,expect} from '@playwright/test';

test('asistente muestra carga, fuentes, estado y conserva historial al navegar',async({page})=>{
  let release:()=>void=()=>{},requestStarted:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{requestStarted=resolve;});let request:any;
  await page.route('**/api/v1/assistant/chat',async route=>{request=route.request().postDataJSON();requestStarted();await gate;await route.fulfill({json:{answer:'NVDA: cierre sintético de 15 minutos; no es una cotización actual.',sections:[{title:'Datos observados',items:['NVDA: cierre histórico, no actual.']},{title:'Interpretación técnica',items:['Movimiento reciente positivo.']}],evidence:[{source:'DEMO sintético',asset:'NVDA',dateUtc:'2026-10-16T20:00:00.000Z',dataType:'SYNTHETIC',availability:'AVAILABLE',summary:'histórico sintético',values:{observations:[{key:'returnFourBarsPercent',value:1.25,unit:'percent',period:'4 intervalos consecutivos de 15 minutos',timestampUtc:'2026-10-16T20:00:00.000Z',availability:'AVAILABLE'}]}}]}});});
  await page.goto('/');await page.getByRole('button',{name:'Asistente'}).click();
  await page.getByLabel('Consulta',{exact:true}).fill('Histórico de NVDA');await page.getByRole('button',{name:'Enviar consulta'}).click();
  await expect(page.getByRole('status')).toContainText('Consultando Ollama');await started;expect(request.message).toBe('Histórico de NVDA');release();
  await expect(page.getByText('Datos observados',{exact:true})).toBeVisible();await expect(page.getByText('Interpretación técnica',{exact:true})).toBeVisible();await expect(page.getByText('SINTÉTICO · DISPONIBLE')).toBeVisible();
  await page.getByText('Métricas, período y disponibilidad',{exact:true}).click();await expect(page.getByText('Retorno 60 min',{exact:true})).toBeVisible();await expect(page.getByText('4 intervalos consecutivos de 15 minutos',{exact:true})).toBeVisible();
  await expect(page.getByText('Fecha UTC: 2026-10-16T20:00:00.000Z')).toBeVisible();
  await page.getByRole('button',{name:'Mercado'}).click();await page.getByRole('button',{name:'Asistente'}).click();await expect(page.getByText('Histórico de NVDA')).toBeVisible();
});

test('asistente comunica error controlado si Ollama no está disponible',async({page})=>{
  await page.route('**/api/v1/assistant/chat',route=>route.fulfill({status:503,json:{error:'Inicie Ollama en 127.0.0.1:11434.'}}));
  await page.goto('/');await page.getByRole('button',{name:'Asistente'}).click();await page.getByLabel('Consulta',{exact:true}).fill('Estado del sistema');
  await page.getByRole('button',{name:'Enviar consulta'}).click();await expect(page.getByRole('alert')).toContainText('Inicie Ollama');
});
