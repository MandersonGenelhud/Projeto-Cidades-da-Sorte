/* Interactive prototype: content is static, no network requests or storage. */
(() => {
  'use strict';
  const options={
    people:{kicker:'ROTA 01 — GENTE',title:'Tudo começa<br>com pessoas.',body:'Uma proposta para valorizar quem vive, compartilha e constrói a história da cidade todos os dias.',symbol:'✳'},
    business:{kicker:'ROTA 02 — COMÉRCIO',title:'A cidade cresce<br>com quem faz.',body:'A ideia é abrir espaço para contar histórias dos negócios locais com informação honesta e uma experiência fácil de usar.',symbol:'↗'},
    trust:{kicker:'ROTA 03 — CLAREZA',title:'Confiança<br>é essencial.',body:'Quando campanhas reais forem autorizadas, condições, prazos e resultados devem ser explicados de forma acessível e verificável.',symbol:'✓'}
  };
  const stage=document.getElementById('route-stage');
  const title=document.getElementById('route-headline');
  const body=document.getElementById('route-body');
  const kicker=document.getElementById('route-kicker');
  const sigil=document.querySelector('.stage-sigil');
  const buttons=[...document.querySelectorAll('[data-route]')];
  for(const button of buttons)button.addEventListener('click',()=>{
    const key=button.dataset.route;
    if(!Object.hasOwn(options,key)||!stage)return;
    const item=options[key];
    buttons.forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',b===button?'true':'false')});
    stage.dataset.current=key;
    kicker.textContent=item.kicker;title.innerHTML=item.title;body.textContent=item.body;
    sigil.textContent=item.symbol;
  });
})();