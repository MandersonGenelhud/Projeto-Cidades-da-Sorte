// Segunda trava contra pedidos forjados por outros sites (CSRF). O cookie de sessão já é SameSite=Lax;
// aqui, qualquer pedido que MUDA algo e traz a sessão só passa se vier do próprio endereço do sistema.
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const hostFromUrl = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

/** true = bloquear. Só olha pedidos que mudam dados, com cookie de sessão e com "Origin" (todo navegador manda). */
export function crossSiteBlocked(req, { cookieName, allowedHosts = [] } = {}) {
  if (SAFE.has(String(req.method || 'GET').toUpperCase())) return false;
  const h = req.headers || {};
  if (!String(h.cookie || '').includes(`${cookieName}=`)) return false; // sem sessão: nada a proteger aqui (webhooks, chaves de integração)
  const own = new Set([String(h.host || '').toLowerCase(), ...allowedHosts.map((x) => String(x || '').toLowerCase())].filter(Boolean));
  if (h.origin) return h.origin === 'null' || !own.has(hostFromUrl(h.origin));
  if (h.referer) return !own.has(hostFromUrl(h.referer));
  return h['sec-fetch-site'] === 'cross-site';
}
