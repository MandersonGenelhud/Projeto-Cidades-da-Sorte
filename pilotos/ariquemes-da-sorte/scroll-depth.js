/* Ariquemes da Sorte: scroll-depth pilot restricted to visual-only content. */
(()=>{'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if(!('IntersectionObserver' in window)||!('requestAnimationFrame' in window)||reduced.matches)return;
  const selectors=['.bento-hero > *','.bento-grid > *','.cine-hero .cine-content','#view-cine .editorial > *','.steps > *','.faq details'];
  const targets=[...new Set(selectors.flatMap(x=>[...document.querySelectorAll(x)]))];
  if(!targets.length)return;
  const io=new IntersectionObserver(entries=>{entries.forEach(({isIntersecting,target})=>{if(isIntersecting){target.dataset.adsDepth='shown';io.unobserve(target)}});},{threshold:.05,rootMargin:'0px 0px 2% 0px'});
  targets.forEach(el=>{el.classList.add('ads-depth-item');el.dataset.adsDepth='waiting';io.observe(el)});
  let queued=false;
  function update(){queued=false;const hero=document.querySelector('#view-cine:not([hidden]) .cine-hero');if(!hero||reduced.matches){if(hero)hero.style.removeProperty('--ads-scrolldepth');return;}const r=hero.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;const progress=Math.max(-1,Math.min(1,(r.top+r.height/2-innerHeight/2)/innerHeight));hero.style.setProperty('--ads-scrolldepth',(progress*-2).toFixed(2)+'deg');}
  function tick(){if(!queued){queued=true;requestAnimationFrame(update)}}
  addEventListener('scroll',tick,{passive:true});addEventListener('resize',tick,{passive:true});
  document.querySelector('#show-cine')?.addEventListener('click',()=>requestAnimationFrame(tick));
  reduced.addEventListener?.('change',()=>{targets.forEach(el=>el.dataset.adsDepth='shown');tick()});
  document.addEventListener('focusin',e=>{const el=e.target.closest?.('.ads-depth-item');if(el)el.dataset.adsDepth='shown'});
  tick();
})();
