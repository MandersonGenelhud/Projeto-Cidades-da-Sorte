
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','1410551004327752');
fbq('track','PageView');

;

(function(){
  "use strict";
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Formulário → CRM + WhatsApp Marcos ---------- */
  var MARCOS_WA = 'https://wa.me/595987101567';
  var leadForm = document.getElementById('lead-form');
  var leadSubmit = document.getElementById('lead-submit');
  var leadError = document.getElementById('lead-error');
  var leadConsent = document.getElementById('lead-consent');
  function showLeadError(text){
    if (!leadError) return;
    leadError.textContent = text || '';
    leadError.classList.toggle('is-on', !!text);
  }
  function trackContactThen(go){
    try {
      if (typeof fbq === 'function') fbq('track', 'Contact');
    } catch (err) {}
    window.setTimeout(go, 350);
  }
  function openMarcos(name){
    var msg = name
      ? 'Olá, Marcos! Meu nome é ' + name + '. Preenchi o formulário no site e quero falar com um especialista.'
      : 'Olá, Marcos! Quero falar com um especialista da MigraParaguai.';
    window.location.href = MARCOS_WA + '?text=' + encodeURIComponent(msg);
  }
  if (leadForm && leadSubmit){
    leadForm.addEventListener('submit', function(e){
      e.preventDefault();
      showLeadError('');
      if (leadConsent && !leadConsent.checked){
        showLeadError('Marque a autorização para enviar.');
        return;
      }
      var data = new FormData(leadForm);
      if ((data.get('website') || '').toString().trim()){
        openMarcos('');
        return;
      }
      var name = (data.get('name') || '').toString().trim();
      var email = (data.get('email') || '').toString().trim();
      var phone = (data.get('phone') || '').toString().trim();
      if (!name || !email || !phone){
        showLeadError('Preencha nome, e-mail e telefone.');
        return;
      }
      leadSubmit.disabled = true;
      leadSubmit.textContent = 'Enviando...';
      fetch('/api/leads/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, email: email, phone: phone, path: location.pathname, website: '' })
      }).then(function(res){ return res.json().catch(function(){ return {}; }); })
        .then(function(json){
          var nextUrl = (json && json.whatsapp_url)
            ? json.whatsapp_url
            : (MARCOS_WA + '?text=' + encodeURIComponent(
                'Olá, Marcos! Meu nome é ' + name + '. Preenchi o formulário no site e quero falar com um especialista.'
              ));
          trackContactThen(function(){ window.location.href = nextUrl; });
        })
        .catch(function(){
          trackContactThen(function(){ openMarcos(name); });
        })
        .then(function(){
          leadSubmit.disabled = false;
          leadSubmit.textContent = 'Enviar';
        });
    });
  }

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
