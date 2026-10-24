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
