import {test,expect} from '@playwright/test';

test('Radar DEMO distingue indicadores sintéticos y ausencia de probabilidades',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Radar de Mercado'}).click();
  await expect(page.getByRole('heading',{name:'Radar de Mercado'})).toBeVisible();
  await expect(page.getByRole('table',{name:'Resumen del radar'}).getByRole('row')).toHaveCount(4);
  await expect(page.getByText('Datos sintéticos: solo demostración.',{exact:false}).first()).toBeVisible();
  await expect(page.getByText('MODELO_NO_DISPONIBLE').first()).toBeVisible();
  await page.getByLabel('Tipo de contrato').selectOption('CALL');
  await expect(page.getByText('ASK LIVE N/D').first()).toBeVisible();
});

test('escenarios Investep DEMO muestran fuente y filtros sin operación',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Radar de Mercado'}).click();
  const section=page.getByRole('region',{name:'Escenarios técnicos Investep'});
  await expect(section.getByRole('heading',{name:'Escenarios técnicos Investep'})).toBeVisible();
  await expect(section.getByRole('table',{name:'SMA multitemporal de escenarios'})).toBeVisible();
  await expect(section.getByText('SYNTHETIC',{exact:false}).first()).toBeVisible();
  await section.getByText('Niveles y rangos previos').click();
  await expect(section.getByRole('table',{name:'Niveles técnicos potenciales'})).toBeVisible();
  await section.getByLabel('Familia').selectOption('SMA_BREAK_RETEST');
  await section.getByLabel('Estado').selectOption('NO_SCENARIO');
  await expect(section.getByText('No hay escenarios de esa familia y estado',{exact:false})).toBeVisible();
  await section.getByLabel('Activo').selectOption('QQQ');
  await expect(section.getByRole('heading',{name:'QQQ · estructura de la última vela disponible'})).toBeVisible();
  await expect(section.getByText('Compra recomendada')).toHaveCount(0);
});

test('escenarios muestran contradicciones verificables en el detalle',async({page})=>{
  await page.route('**/api/v1/radar/scenarios?symbol=NVDA',async route=>{
    const original=await route.fetch(),body=await original.json();
    if(body.current?.[0])body.current[0].contradictions=[{timeframe:'1h',component:'SMA20_40',detail:'SMA20/40 de 1h conserva orden contrario.'}];
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/');await page.getByRole('button',{name:'Radar de Mercado'}).click();
  const section=page.getByRole('region',{name:'Escenarios técnicos Investep'});
  await expect(section.getByText('SMA20/40 de 1h conserva orden contrario.')).not.toBeVisible();
  await section.getByText('Evidencia, contradicciones y límites').first().click();
  await expect(section.getByText('SMA20/40 de 1h conserva orden contrario.')).toBeVisible();
});
