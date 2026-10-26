import {test,expect} from '@playwright/test';

test('DEMO registra entrada y salida hipotéticas sin consultar órdenes ni ejecuciones',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{
    if(/\/api\/v1\/(?:orders|executions|positions)(?:\/|\?|$)/.test(request.url()))forbidden.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('checkbox',{name:'Comparar contrato 90000'}).check();
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
