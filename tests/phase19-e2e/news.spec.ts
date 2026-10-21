import {test,expect} from '@playwright/test';

test('Noticias DEMO muestra ausencia de datos reales y ningún análisis inventado',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Noticias'}).click();
  await expect(page.getByRole('heading',{name:'Noticias verificables'})).toBeVisible();
  await expect(page.getByText('No hay noticias reales disponibles.',{exact:false})).toBeVisible();
  await expect(page.getByText('Contenido de fuente, recepción local y análisis de IA se muestran por separado.',{exact:false})).toBeVisible();
});
test('Noticias distingue fecha declarada, primera recepción y clasificación simulada',async({page})=>{
  await page.route('**/api/v1/news/status',route=>route.fulfill({json:{state:'AVAILABLE',articleCount:1,revisionCount:1,classificationCount:1,collection:null,analysis:null}}));
  await page.route('**/api/v1/news/items?*',route=>route.fulfill({json:{state:'AVAILABLE',total:1,offset:0,limit:50,items:[{
    id:'synthetic-fixture',revision:1,source:'Fuente de prueba',canonicalUrl:'https://www.federalreserve.gov/newsevents/pressreleases/example.htm',title:'Comunicado de prueba',description:'Resumen de prueba.',publishedAtUtc:'2026-10-20T14:00:00.000Z',publicationStatus:'KNOWN',firstSeenAtUtc:'2026-10-21T15:00:00.000Z',receivedAtUtc:'2026-10-21T15:00:00.000Z',updatedAtUtc:null,
    classification:{assets:[],category:'MACROECONOMIA',sentiment:'NEUTRAL',relevance:'MEDIA',justification:'Comunicado de prueba',insufficientEvidence:false},classificationModel:'digest-de-prueba',analyzedAtUtc:'2026-10-21T15:01:00.000Z'}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Noticias'}).click();
  const row=page.getByRole('row').filter({hasText:'Comunicado de prueba'});
  await expect(row).toContainText('Fuente de prueba');await expect(row).toContainText('MACROECONOMIA');await expect(row).toContainText('IA: Comunicado de prueba');
  await expect(row.locator('td').nth(1)).not.toHaveText(await row.locator('td').nth(2).innerText());
});
