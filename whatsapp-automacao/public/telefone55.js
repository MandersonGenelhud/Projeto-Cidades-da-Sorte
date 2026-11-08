// Campos de telefone/WhatsApp de clientes já vêm com o +55 do Brasil: o cliente ou o vendedor só completa DDD e número.
// Quem for de outro país digita o "+" e o código dele (o +55 sai sozinho). Sem "+", 10 ou 11 dígitos ganham o +55 ao sair do campo.
(() => {
  const SEL = 'input[type="tel"], input[name="phone"], input[name="whatsapp"], input[name="telefone"]';
  const mine = (el) => el instanceof HTMLInputElement && el.matches(SEL) && !el.readOnly && !el.disabled && !el.hasAttribute('data-no55');
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!mine(el) || el.value.trim()) return;
    el.value = '+55 ';
    requestAnimationFrame(() => { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* alguns tipos não têm seleção */ } });
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!mine(el)) return;
    // Digitou "+" e outro país depois do +55: tira o +55 que veio de enfeite.
    if (/^\+55\s*\+/.test(el.value)) el.value = el.value.replace(/^\+55\s*/, '');
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!mine(el)) return;
    const v = el.value.trim();
    if (v === '+55') { el.value = ''; return; } // não preencheu: deixa vazio (campo obrigatório avisa)
    const d = v.replace(/\D/g, '');
    if (v && !v.startsWith('+') && /^0?\d{10,11}$/.test(d)) el.value = `+55 ${d.replace(/^0/, '')}`; // só DDD + número
  });
})();
