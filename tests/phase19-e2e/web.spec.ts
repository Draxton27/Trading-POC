import {test,expect} from '@playwright/test';
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
  await page.goto('/');await page.getByRole('button',{name:'Mercado'}).click();
  await page.locator('.chart-controls button',{hasText:'QQQ'}).click();
  await expect(page.locator('.chart-heading h2')).toContainText('QQQ');
  await page.locator('.chart-controls button',{hasText:'1h'}).click();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'Cargar historial anterior'}).click();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
});
test('opciones y diario etiquetan datos sintéticos y admiten no operar',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.getByText('SINTÉTICO',{exact:true})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'PUT'}).click();await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'Diario'}).click();
  await expect(page.locator('select[name="direction"]')).toHaveValue('no_trade');
  await expect(page.getByText(/No se crean ejemplos ficticios/)).toBeVisible();
});
