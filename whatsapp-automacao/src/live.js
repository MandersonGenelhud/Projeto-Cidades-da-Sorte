// Página de live: o Meet que a equipe já usa, com frase de "em breve" / "ao vivo", botão de entrar e botões dos grupos de WhatsApp.
// O link da sala só aparece na página pública quando o administrador marca "ao vivo".
const STATES = ['off', 'soon', 'live', 'ended'];
const MEET = /^https:\/\/meet\.google\.com\/[a-z0-9-]{6,40}(\?[\w=&%-]*)?$/i;
const GROUP = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}(\?[\w=&%-]*)?$/;
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const DEFAULT_LIVE = {
  status: 'off', title: 'Live da Migra', startsAt: '', meetLink: '', groups: [],
  soonText: 'Vamos entrar ao vivo em breve!', liveText: 'Estamos ao vivo! Entre agora, participe e tire suas dúvidas ao vivo pelo chat.', endedText: 'A live terminou. Obrigado por participar! Entre nos grupos para receber o aviso da próxima.',
  liveSince: null,
};
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export class Live {
  constructor({ store, now = () => new Date() }) { this.store = store; this.now = now; this.store.data.live ||= {}; }
  get cfg() {
    const c = { ...DEFAULT_LIVE, ...this.store.data.live };
    // Uma live "ao vivo" esquecida ligada se encerra sozinha depois de 8 horas.
    if (c.status === 'live' && c.liveSince && this.now() - new Date(c.liveSince) > 8 * 3_600_000) c.status = 'ended';
    return c;
  }
  set(patch = {}) {
    const c = { ...this.store.data.live };
    if (patch.title !== undefined) c.title = clip(patch.title, 100) || DEFAULT_LIVE.title;
    for (const k of ['soonText', 'liveText', 'endedText']) if (patch[k] !== undefined) c[k] = clip(patch[k], 200) || DEFAULT_LIVE[k];
    if (patch.startsAt !== undefined) {
      const v = String(patch.startsAt || '').trim();
      if (v && !(WHEN.test(v) && !Number.isNaN(Date.parse(v)))) throw new Error('Data e hora inválidas');
      c.startsAt = v;
    }
    if (patch.meetLink !== undefined) {
      const v = String(patch.meetLink || '').trim();
      if (v && !MEET.test(v)) throw new Error('Cole o link da sala do Google Meet (começa com https://meet.google.com/)');
      c.meetLink = v;
    }
    if (patch.groups !== undefined) {
      if (!Array.isArray(patch.groups) || patch.groups.length > 10) throw new Error('No máximo 10 grupos');
      c.groups = patch.groups.filter((g) => g && (g.url || g.name)).map((g) => {
        const url = String(g.url || '').trim();
        if (!GROUP.test(url)) throw new Error('O link de cada grupo precisa ser de convite do WhatsApp (https://chat.whatsapp.com/...)');
        return { name: clip(g.name, 60) || 'Grupo da Migra', url };
      });
    }
    if (patch.status !== undefined) {
      if (!STATES.includes(patch.status)) throw new Error('Situação inválida');
      if (patch.status === 'live' && !(c.meetLink || DEFAULT_LIVE.meetLink)) throw new Error('Cole o link do Meet antes de ficar ao vivo');
      c.status = patch.status;
      c.liveSince = patch.status === 'live' ? this.now().toISOString() : null;
    }
    this.store.data.live = c;
    this.store.save();
    return this.cfg;
  }
  /** O que a página pública pode ver: o link do Meet só quando está ao vivo. */
  publicView() {
    const c = this.cfg;
    const text = c.status === 'live' ? c.liveText : c.status === 'soon' ? c.soonText : c.status === 'ended' ? c.endedText : '';
    return { status: c.status, title: c.title, startsAt: c.status === 'soon' || c.status === 'live' ? c.startsAt : '', text, meetLink: c.status === 'live' ? c.meetLink : '', groups: c.groups };
  }
  /** Para a IA: avisa quando há live marcada ou acontecendo. */
  promptInfo(url) {
    const c = this.cfg;
    if (c.status !== 'soon' && c.status !== 'live') return '';
    const when = c.startsAt ? ` (${c.startsAt.slice(8, 10)}/${c.startsAt.slice(5, 7)} às ${c.startsAt.slice(11)})` : '';
    return `# Live da Migra\n${c.status === 'live' ? 'ESTAMOS AO VIVO agora.' : `Haverá uma live em breve${when}.`} Se o cliente perguntar de live, aula ao vivo ou onde tirar dúvidas com a equipe, convide e mande este link da página (nunca o link da sala): ${url}\nNa página ele entra na sala do Meet e pode entrar nos grupos de WhatsApp.`;
  }
}
