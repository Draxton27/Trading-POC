import {test,expect} from '@playwright/test';

test('capturas verificables de la aplicación DEMO en ejecución',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.getByText('DEMO',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.market-chart canvas').first()).toBeVisible();
  await page.screenshot({path:'shared-artifacts/phase19-ibkr-ui/phase19-demo-dashboard.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Opciones'}).click();
  await expect(page.getByText('SINTÉTICO',{exact:true})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.screenshot({path:'shared-artifacts/phase19-ibkr-ui/phase19-demo-options.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Diario'}).click();
  await expect(page.getByText(/No se crean ejemplos ficticios/)).toBeVisible();
  await page.screenshot({path:'shared-artifacts/phase19-ibkr-ui/phase19-demo-journal.png',fullPage:true,animations:'disabled'});
});
