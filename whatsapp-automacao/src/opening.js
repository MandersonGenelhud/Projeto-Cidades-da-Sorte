// Mensagem de retorno para quem ficou esperando: agradece por aguardar, diz que a demanda está alta mas todos estão sendo atendidos, que o
// contato combinado acabou não acontecendo por imprevistos, e que a Migra está aqui para dar continuidade. Nunca pede desculpas (regra da direção).
// É um texto FIXO (a IA não reescreve), personalizado só com saudação, nome e, se houver, a data que tinha sido combinada.

export const DEFAULT_OPENING = '{saudacao}, {nome}! Agradecemos muito por aguardar o nosso contato. 🙏 Nossa demanda está alta, mas estamos atendendo todos os clientes. Ficou combinado de falarmos no dia {data}, mas acabaram ocorrendo alguns imprevistos. Estamos aqui para dar continuidade ao seu atendimento e proporcionar da melhor forma a sua migração, com a melhor assessoria que hoje existe na fronteira: a Migra.';
export const DEFAULT_OPENING_NO_DATE = '{saudacao}, {nome}! Agradecemos muito por aguardar o nosso contato. 🙏 Nossa demanda está alta, mas estamos atendendo todos os clientes, e o seu retorno acabou ficando pendente por alguns imprevistos. Estamos aqui para dar continuidade ao seu atendimento e proporcionar da melhor forma a sua migração, com a melhor assessoria que hoje existe na fronteira: a Migra.';

export const greetingOf = (now = new Date()) => (now.getHours() < 12 ? 'Bom dia' : now.getHours() < 18 ? 'Boa tarde' : 'Boa noite');
const firstName = (name) => {
  const n = String(name || '').trim().split(/\s+/)[0];
  return n && !/^[+@\d]/.test(n) && n.length > 1 ? n.charAt(0).toUpperCase() + n.slice(1) : '';
};
const brDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

/** Configuração: agent.backlogOpening = { enabled, minHours, template, templateNoDate } (tudo opcional). */
export const openingConfig = (agentCfg) => ({ enabled: true, minHours: 6, repeatDays: 7, ...(agentCfg?.backlogOpening || {}) });

/** Texto pronto para enviar. date = dia combinado (AAAA-MM-DD) ou ''. */
export function buildOpening({ name = '', date = '', now = new Date(), cfg = {} }) {
  const c = openingConfig({ backlogOpening: cfg });
  const withDate = /^\d{4}-\d{2}-\d{2}/.test(String(date || ''));
  const tpl = String((withDate ? c.template : c.templateNoDate) || (withDate ? DEFAULT_OPENING : DEFAULT_OPENING_NO_DATE));
  const nome = firstName(name);
  return tpl
    .replace(/\{saudacao\}, \{nome\}!/g, nome ? `${greetingOf(now)}, ${nome}!` : `${greetingOf(now)}!`)
    .replace(/\{saudacao\}/g, greetingOf(now))
    .replace(/\{nome\}/g, nome)
    .replace(/\{data\}/g, withDate ? brDate(date) : '')
    .replace(/\s{2,}/g, ' ').trim();
}

/** Esta conversa deve receber a mensagem de retorno? (esperou tempo suficiente, ou veio do "recomeçar", e ainda não recebeu há pouco.) */
export function wantsOpening({ item, conv, now = Date.now(), cfg = {} }) {
  const c = openingConfig({ backlogOpening: cfg });
  if (c.enabled === false || !item || item.noOpening) return false;
  if (conv?.openingSentAt && now - conv.openingSentAt < c.repeatDays * 86_400_000) return false;
  if (item.restart) return true;
  return now - Number(item.at || now) >= c.minHours * 3_600_000;
}
