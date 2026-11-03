(function(){
  "use strict";
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- VSL player ---------- */
  var vslWrap = document.getElementById('hero-vsl');
  var vslVideo = document.getElementById('vsl-video');
  var vslPlay = document.getElementById('vsl-play');
  if (vslWrap && vslVideo && vslPlay){
    function playVsl(){
      vslVideo.controls = true;
      vslVideo.play();
      vslWrap.classList.add('is-playing');
    }
    vslPlay.addEventListener('click', playVsl);
    vslVideo.addEventListener('click', function(){ if (vslVideo.paused) playVsl(); });
    vslVideo.addEventListener('pause', function(){ vslWrap.classList.remove('is-playing'); });
    vslVideo.addEventListener('play', function(){
      vslWrap.classList.add('is-playing');
      pauseTestiVideos(null);
    });
    vslVideo.addEventListener('ended', function(){ vslWrap.classList.remove('is-playing'); vslVideo.controls = false; });
  }

  /* ---------- Depoimentos em vídeo (carrossel rotativo) ---------- */
  var testiTrack = document.getElementById('testi-track');
  function testiCards(){
    return testiTrack ? Array.prototype.slice.call(testiTrack.querySelectorAll('.testi-card')) : [];
  }
  function pauseTestiVideos(except){
    testiCards().forEach(function(card){
      var video = card.querySelector('video');
      if (!video || video === except) return;
      video.pause();
      video.controls = false;
      card.classList.remove('is-playing');
    });
  }
  function syncTestiMarquee(){
    if (!testiTrack) return;
    var playing = testiTrack.querySelector('.testi-card.is-playing');
    testiTrack.classList.toggle('is-paused', !!playing);
  }
  function playTestiCard(card){
    if (!card) return;
    var video = card.querySelector('video');
    if (!video) return;
    pauseTestiVideos(video);
    if (vslVideo && !vslVideo.paused) vslVideo.pause();
    video.controls = true;
    video.play();
    card.classList.add('is-playing');
    syncTestiMarquee();
  }
  if (testiTrack){
    if (!reduceMotion){
      testiCards().forEach(function(card){
        var clone = card.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('video').forEach(function(v){ v.removeAttribute('id'); });
        testiTrack.appendChild(clone);
      });
    }
    testiTrack.addEventListener('click', function(e){
      var play = e.target.closest('.vsl-play');
      var videoEl = e.target.closest('video');
      var card = (play || videoEl) && (play || videoEl).closest('.testi-card');
      if (!card) return;
      var video = card.querySelector('video');
      if (play || (videoEl && video && video.paused)){
        e.preventDefault();
        playTestiCard(card);
      }
    });
    testiTrack.addEventListener('play', function(e){
      var video = e.target;
      if (!video || video.tagName !== 'VIDEO') return;
      pauseTestiVideos(video);
      var card = video.closest('.testi-card');
      if (card) card.classList.add('is-playing');
      syncTestiMarquee();
    }, true);
    testiTrack.addEventListener('pause', function(e){
      var video = e.target;
      if (!video || video.tagName !== 'VIDEO') return;
      var card = video.closest('.testi-card');
      if (card) card.classList.remove('is-playing');
      syncTestiMarquee();
    }, true);
    testiTrack.addEventListener('ended', function(e){
      var video = e.target;
      if (!video || video.tagName !== 'VIDEO') return;
      video.controls = false;
      var card = video.closest('.testi-card');
      if (card) card.classList.remove('is-playing');
      syncTestiMarquee();
    }, true);
  }

  /* ---------- Reusable scroll-tied scene ---------- */
  function initScene(opts){
    var hero = document.getElementById(opts.heroId);
    var video = document.getElementById(opts.videoId);
    var loader = document.getElementById(opts.loaderId);
    if (!hero || !video) return;

    var duration = 0, ready = false, target = 0, ticking = false;
    if (video.readyState >= 1 && video.duration) duration = video.duration;

    function markReady(){
      if (ready) return;
      ready = true;
      duration = video.duration || 0;
      video.classList.add('is-ready');
      if (loader) loader.classList.add('is-gone');
      onScroll();
    }
    video.addEventListener('loadedmetadata', function(){ duration = video.duration; });
    video.addEventListener('canplaythrough', markReady);
    setTimeout(markReady, 6000);

    function onScroll(){
      var rect = hero.getBoundingClientRect();
      var scrollable = hero.offsetHeight - window.innerHeight;
      var p = scrollable > 0 ? -rect.top / scrollable : 0;
      target = Math.min(1, Math.max(0, p));
      if (document.hidden) apply();
      else if (!ticking){ ticking = true; requestAnimationFrame(apply); }
    }
    function apply(){
      ticking = false;
      if (duration) video.currentTime = target * duration;
      if (opts.onProgress) opts.onProgress(target);
    }
    window.addEventListener('scroll', onScroll, { passive:true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  var sceneHeadlines = document.querySelectorAll('#sc-scene .sc-headline');
  var hudNum = document.getElementById('hud-num');
  var hudFill = document.getElementById('hud-fill');

  function setStage(headlines, p, thresholds){
    var stage = 0;
    for (var i=0;i<thresholds.length;i++){ if (p >= thresholds[i]) stage = i+1; }
    headlines.forEach(function(h){
      var s = parseInt(h.getAttribute('data-stage'),10);
      h.classList.toggle('is-active', s === stage);
    });
  }

  initScene({
    heroId:'sc-scene', videoId:'sc-video-1', loaderId:'sc-loader-1',
    onProgress:function(p){
      setStage(sceneHeadlines, p, [0.32, 0.66]);
      var pct = Math.round(p*100);
      if (hudNum) hudNum.textContent = pct + '%';
      if (hudFill) hudFill.style.width = pct + '%';
    }
  });

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (reduceMotion){
    revealEls.forEach(function(el){ el.style.transition = 'none'; el.classList.add('is-visible'); });
  } else if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold:.18, rootMargin:'0px 0px -60px 0px' });
    revealEls.forEach(function(el){ io.observe(el); });
  } else {
    revealEls.forEach(function(el){ el.classList.add('is-visible'); });
  }

  /* ---------- Service tabs ---------- */
  var tabBtns = document.querySelectorAll('.tab-btn');
  var tabPanels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      var target = btn.getAttribute('data-tab');
      tabBtns.forEach(function(b){ b.classList.toggle('is-active', b === btn); });
      tabPanels.forEach(function(p){ p.classList.toggle('is-active', p.getAttribute('data-panel') === target); });
    });
  });

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(function(item){
    var btn = item.querySelector('.faq-q');
    var ans = item.querySelector('.faq-a');
    btn.addEventListener('click', function(){
      var isOpen = item.classList.contains('is-open');
      document.querySelectorAll('.faq-item.is-open').forEach(function(o){
        o.classList.remove('is-open');
        o.querySelector('.faq-a').style.maxHeight = null;
      });
      if (!isOpen){
        item.classList.add('is-open');
        ans.style.maxHeight = ans.scrollHeight + 'px';
      }
    });
  });
})();


/* ---------- Melhorias novas ---------- */
(function(){
  "use strict";
  // Menu: rolagem suave até a seção, respeitando quem prefere menos movimento.
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('href').slice(1);
      var el = id && document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
  });
  // Contadores: os números do topo sobem até o valor quando aparecem na tela.
  var nums = document.querySelectorAll('.hero-stat-num');
  if (!calm && 'IntersectionObserver' in window){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(en){
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var el = en.target, txt = el.getAttribute('data-final') || el.textContent;
        var m = /^([\d.]+)(.*)$/.exec(txt);
        if (!m) return;
        var alvo = parseFloat(m[1].replace(/\./g, '')), suf = m[2], t0 = performance.now();
        (function passo(t){
          var p = Math.min(1, (t - t0) / 1400), v = Math.round(alvo * (1 - Math.pow(1 - p, 3)));
          el.textContent = v.toLocaleString('pt-BR') + suf;
          if (p < 1) requestAnimationFrame(passo);
        })(t0);
      });
    }, { threshold: .6 });
    nums.forEach(function(n){ n.setAttribute('data-final', n.textContent); io.observe(n); });
  }
  // Menu fixo: ganha sombra depois que a página rola.
  var nav = document.querySelector('.nav');
  if (nav) window.addEventListener('scroll', function(){ nav.classList.toggle('is-stuck', window.scrollY > 10); }, { passive: true });
})();
