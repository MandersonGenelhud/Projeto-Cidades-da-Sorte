(function () {
  "use strict";
  var burger = document.getElementById('g-burger');
  var links = document.getElementById('g-links');
  if (!burger || !links) return;
  function setOpen(open) {
    links.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Fechar o menu' : 'Abrir o menu');
  }
  burger.addEventListener('click', function () { setOpen(!links.classList.contains('is-open')); });
  links.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
})();
