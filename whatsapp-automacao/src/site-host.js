// Domínio próprio do site público da Migra (ex.: www.migraparaguai.com): no domínio do site só aparecem
// as páginas públicas. O painel, o login e a API da equipe NÃO existem nesse endereço (404).
import fs from 'node:fs';

export const siteHostsFrom = (env = process.env) => new Set(String(env.SITE_HOSTS || '').split(/[,\s]+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')).filter(Boolean));

export const hostOf = (req) => String(req.get?.('host') || req.headers?.host || '').toLowerCase().replace(/:\d+$/, '');

// O que o domínio do site pode mostrar (tudo o mais dá 404).
export const SITE_ALLOW = [
  /^\/$/,
  /^\/(marcas|migra|motors|school|imoveis|parceiros|indicacao)(\/.*)?$/,
  /^\/site\/[\w.-]+$/,
  /^\/img\/[\w.-]+$/,
  /^\/brand\/[\w.-]+$/,
  /^\/r\/[\w-]+$/,
  /^\/(robots\.txt|sitemap\.xml|privacidade\.html|favicon\.ico)$/,
  /^\/api\/public\/[\w/-]+$/,
  /^\/api\/affiliate\/[\w/-]+$/,
];
export const siteAllows = (method, path) => {
  if (!SITE_ALLOW.some((re) => re.test(path))) return false;
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && /^\/api\/(public|affiliate)\//.test(path);
};

/** Middleware: no domínio do site entrega a página inicial e bloqueia o resto. */
export function siteGuard({ hosts, homeFile, render = (html, origin) => html.replaceAll('{{ORIGIN}}', origin) }) {
  const home = () => fs.readFileSync(homeFile, 'utf8');
  return (req, res, next) => {
    if (!hosts.size || !hosts.has(hostOf(req))) return next();
    req.isSiteHost = true;
    if (!siteAllows(req.method, req.path)) return res.status(404).type('text/plain').send('Página não encontrada');
    if (req.path === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      const origin = `https://${hostOf(req)}`;
      return res.type('html').send(render(home(), origin));
    }
    next();
  };
}
