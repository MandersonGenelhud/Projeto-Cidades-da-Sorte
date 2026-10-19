const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/');const button=page.locator('button[type=submit]');await button.waitFor();await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled);
  assert.equal(await page.locator('body').getAttribute('data-view'),'cinema');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#nome').fill('Pessoa Fictícia Navegador');await page.locator('#telefone').fill('69999990009');await page.locator('[name=consent]').check();
  await button.click();await page.locator('#feedback').waitFor({state:'visible'});assert.match(await page.locator('#feedback').innerText(),/Solicitação de teste recebida/);assert.equal(await page.locator('#nome').inputValue(),'');
  console.log('PASS browser: envio real ao banco local e limpeza após confirmação');
  await page.locator('#nome').fill('Outro Nome Fictício');await page.locator('#telefone').fill('69999990009');await page.locator('[name=consent]').check();await button.click();await page.locator('#feedback').waitFor({state:'visible'});assert.match(await page.locator('#feedback').innerText(),/Solicitação de teste recebida/);
  console.log('PASS browser: duplicata recebe confirmação genérica');
  await page.locator('#nome').fill('Nome Fictício');await page.locator('#telefone').fill('123');await page.locator('[name=consent]').check();await button.click();await page.waitForFunction(()=>document.querySelector('#telefone').getAttribute('aria-invalid')==='true');assert.equal(await page.locator('#telefone').inputValue(),'123');
  console.log('PASS browser: erro de validação mantém dados e identifica campo');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  console.log('PASS browser: sem rolagem horizontal em 320, 390, 768 e 1440 px');assert.deepEqual(errors,[]);console.log('PASS browser: nenhum erro JavaScript');
  await page.route('**/api.php',route=>route.abort());await page.locator('#telefone').fill('69999990008');await button.click();await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('Conexão interrompida'));assert.equal(await page.locator('#telefone').inputValue(),'69999990008');assert.equal(await button.isEnabled(),true);
  console.log('PASS browser: falha de rede preserva campos e permite nova tentativa');
  console.log('RESULT: 6 browser checks passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
