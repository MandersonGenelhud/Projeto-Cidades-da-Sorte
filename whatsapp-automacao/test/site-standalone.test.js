import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStandalone } from '../src/site-standalone.js';

test('página do Grupo Migra em um arquivo só: CSS e JS dentro, endereços completos, sem marcadores soltos', () => {
  const html = '<head><link rel="canonical" href="{{ORIGIN}}/"><link rel="icon" href="/img/grupo-migra-emblema.png"><link rel="stylesheet" href="/site/premium.css"></head><body><img src="/img/marcas/a.webp"><a href="/atendimento?o=site">x</a><a href="#faq">y</a><script src="/site/premium.js" defer></script></body>';
  const out = buildStandalone({ html, css: 'body{color:red}', js: 'var a="</script>";', hub: 'https://hub.exemplo.com/', origin: 'https://site.exemplo.com/pagina' });
  assert.match(out, /<style>\nbody\{color:red\}\n<\/style>/);
  assert.ok(!out.includes('premium.css') && !/src="[^"]*premium\.js"/.test(out));
  assert.match(out, /canonical" href="https:\/\/site\.exemplo\.com\/pagina\/"/);
  assert.match(out, /src="https:\/\/hub\.exemplo\.com\/img\/marcas\/a\.webp"/);
  assert.match(out, /href="https:\/\/hub\.exemplo\.com\/atendimento\?o=site"/);
  assert.match(out, /href="#faq"/, 'âncoras internas ficam como estão');
  assert.ok(!out.includes('{{'));
  assert.ok(!/<script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(out.replace('</script></body>', '')), 'o texto </script> dentro do JS não fecha a tag antes da hora');
});
