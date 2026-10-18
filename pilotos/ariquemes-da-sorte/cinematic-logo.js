/* Ariquemes da Sorte: parallax sutil com logo original; não coleta dados. */
(()=>{'use strict';
const stage=document.querySelector('[data-ads-cine-stage]');
if(!stage)return;
const mark=stage.querySelector('.ads-cine-mark'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let visible=false,scheduled=false;
function render(){
 scheduled=false;
 if(!visible||reduced.matches||document.hidden){['--mark-y','--mark-z','--mark-up'].forEach(x=>mark.style.removeProperty(x));return;}
 const r=stage.getBoundingClientRect(),p=Math.max(0,Math.min(1,(innerHeight-r.top)/(innerHeight+r.height)));
 mark.style.setProperty('--mark-y',((p-.5)*33).toFixed(1)+'deg');
 mark.style.setProperty('--mark-z',((p-.5)*9).toFixed(1)+'deg');
 mark.style.setProperty('--mark-up',((.5-p)*28).toFixed(1)+'px');
}
function tick(){if(!scheduled){scheduled=true;requestAnimationFrame(render)}}
if('IntersectionObserver' in window)new IntersectionObserver(es=>{visible=es.some(e=>e.isIntersecting);tick()},{threshold:0.02}).observe(stage);else visible=true;
addEventListener('scroll',tick,{passive:true});addEventListener('resize',tick,{passive:true});
document.addEventListener('visibilitychange',tick);reduced.addEventListener?.('change',tick);
document.querySelector('#show-cine')?.addEventListener('click',()=>requestAnimationFrame(tick));
tick();
})();
