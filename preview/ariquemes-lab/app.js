/* Optional progressive enhancement; no analytics, forms, cookies or API requests. */
(() => {
 'use strict';
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const logo=document.querySelector('.brand-mark img');
 if (logo) {
   const fail=()=>{logo.hidden=true;logo.style.display='none'};
   logo.addEventListener('error',fail,{once:true});
   if(logo.complete && logo.naturalWidth===0) fail();
 }
 const bar=document.querySelector('.reading-bar');
 let raf=0;
 function updateScroll(){
   if (!bar) return;
   const max=document.documentElement.scrollHeight-window.innerHeight;
   bar.style.width=(max>0?Math.min(100,Math.max(0,window.scrollY/max*100)):0)+'%';
 }
 if(bar){
   window.addEventListener('scroll',()=>{if(raf)return;raf=requestAnimationFrame(()=>{updateScroll();raf=0})},{passive:true});
   window.addEventListener('resize',updateScroll,{passive:true}); updateScroll();
 }
 const targets=document.querySelectorAll('.reveal');
 if('IntersectionObserver' in window && !reduced.matches){
   document.documentElement.classList.add('js-ready');
   const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
     if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}
   }),{threshold:.08,rootMargin:'0px 0px -18px 0px'});
   targets.forEach(el=>observer.observe(el));
 } else targets.forEach(el=>el.classList.add('is-visible'));
 const card=document.querySelector('[data-tilt]');
 if(card && !reduced.matches && window.matchMedia('(pointer:fine)').matches){
   const reset=()=>{card.style.transform='rotate(-7deg)'};
   const onMove=e=>{
     const rect=card.getBoundingClientRect();
     const x=(e.clientX-rect.left)/rect.width-.5;
     const y=(e.clientY-rect.top)/rect.height-.5;
     card.style.transform='perspective(850px) rotate(-7deg) rotateX('+(-y*7)+'deg) rotateY('+(x*9)+'deg)';
   };
   card.addEventListener('pointermove',onMove,{passive:true});
   card.addEventListener('pointerleave',reset,{passive:true});
   card.addEventListener('pointercancel',reset,{passive:true});
 }
})();
