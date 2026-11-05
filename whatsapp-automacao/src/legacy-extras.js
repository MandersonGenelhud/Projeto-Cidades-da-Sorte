// O que mais veio da cópia do sistema antigo: modelos de contrato (Migra Paraguai, Migra Med, Migra Brasil, RUC),
// as aulas do curso (viram tutoriais) e a lista de contatos da equipe.
import crypto from 'node:crypto';

const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const err = (status, message) => Object.assign(new Error(message), { status });
const of = (captura, ep) => (captura?.api || []).filter((a) => { try { return new URL(a.url, 'http://x').pathname.replace(/\/+$/, '') === ep; } catch { return false; } }).map((a) => a.json);

/** Troca {{variavel}} pelos valores; devolve o texto e o que ficou faltando. */
export function renderTemplate(content, values = {}) {
  const missing = new Set();
  const text = String(content || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => {
    const v = String(values[k] ?? '').trim();
    if (!v) { missing.add(k); return `[${k.replace(/_/g, ' ').toUpperCase()}]`; }
    return v;
  });
  return { text, missing: [...missing] };
}

export class ContractTemplates {
  constructor({ store }) { this.store = store; store.data.contractTemplates ||= []; }
  get all() { return this.store.data.contractTemplates; }
  list() { return this.all.map(({ content, ...t }) => ({ ...t, size: content.length })); }
  get(key) { const t = this.all.find((x) => x.key === key); if (!t) throw err(404, 'Modelo não encontrado'); return t; }
  render(key, values) { const t = this.get(key); return { ...renderTemplate(t.content, values), name: t.name, version: t.version }; }
  /** Serviço → modelos que o sistema antigo usava para ele. */
  forService(name) { const m = this.store.data.contractTemplateMap || {}; return m[name] || []; }
  importCapture(captura) {
    let added = 0; let updated = 0;
    for (const j of of(captura, '/api/contract-templates')) {
      for (const t of j?.data || []) {
        if (!t?.id || !t.conteudo) continue;
        const data = { key: clip(t.id, 40), name: clip(t.nome, 120), description: clip(t.descricao, 300), category: clip(t.categoria_label || t.categoria, 60), version: clip(t.versao, 20), content: String(t.conteudo).slice(0, 200000), variables: (t.variaveis || []).map((v) => ({ key: clip(v.key, 40), label: clip(v.label, 80) })).filter((v) => v.key), importedAt: new Date().toISOString() };
        const cur = this.all.find((x) => x.key === data.key);
        if (!cur) { this.all.push({ id: crypto.randomBytes(5).toString('hex'), ...data }); added += 1; } else if (cur.version !== data.version || cur.content !== data.content) { Object.assign(cur, data); updated += 1; }
      }
      if (j?.service_template_map && typeof j.service_template_map === 'object') this.store.data.contractTemplateMap = j.service_template_map;
    }
    // Versão de cada modelo aberta separadamente (/api/contract-templates/migra-med etc.).
    for (const a of captura?.api || []) {
      let p; try { p = new URL(a.url, 'http://x').pathname; } catch { continue; }
      const m = p.match(/^\/api\/contract-templates\/([a-z0-9-]+)$/);
      const t = a.json?.data;
      if (!m || !t?.conteudo || this.all.some((x) => x.key === m[1])) continue;
      this.all.push({ id: crypto.randomBytes(5).toString('hex'), key: m[1], name: clip(t.nome, 120), description: clip(t.descricao, 300), category: clip(t.categoria_label || t.categoria, 60), version: clip(t.versao, 20), content: String(t.conteudo).slice(0, 200000), variables: (t.variaveis || []).map((v) => ({ key: clip(v.key, 40), label: clip(v.label, 80) })), importedAt: new Date().toISOString() });
      added += 1;
    }
    if (added || updated) this.store.save();
    return { added, updated };
  }
}

/** Aulas do curso → tutoriais dos vendedores (com o link do vídeo). Não duplica. */
export function importLessons(tutorials, captura) {
  let added = 0;
  const course = of(captura, '/api/curso')[0];
  const lessons = course?.lessons || [];
  const have = new Set(tutorials.all.map((t) => t.seedKey).filter(Boolean));
  for (const l of lessons) {
    const key = `legacy-lesson-${l.id}`;
    if (!l?.title || have.has(key) || l.is_published === false) continue;
    const body = [clip(l.description, 4000), l.video_url ? `Vídeo da aula: ${clip(l.video_url, 500)}` : '', l.duration_minutes ? `Duração: ${l.duration_minutes} min` : ''].filter(Boolean).join('\n\n') || 'Aula do curso da Migra.';
    tutorials.all.push({ id: crypto.randomBytes(6).toString('hex'), seedKey: key, title: `${clip(course?.course?.title || 'Curso', 60)} · ${clip(l.title, 100)}`, audience: 'seller', category: 'Curso', body, hidden: false, auto: false, order: Number(l.sort_order) || 0, createdAt: new Date(Date.now() - (Number(l.sort_order) || 0) * 1000).toISOString(), createdBy: 'Cópia do sistema antigo' });
    added += 1;
  }
  if (added) tutorials.store.save();
  return { added, total: lessons.length };
}

/** Contatos da equipe (nome, cargo, setor, e-mail e telefone), para todos consultarem. */
export function importTeamContacts(store, captura) {
  const rows = of(captura, '/api/team-contacts')[0]?.data || [];
  if (!rows.length) return { total: 0 };
  store.data.teamContacts = rows.filter((r) => r?.full_name).map((r) => ({ name: clip(r.full_name, 120), role: clip(r.role_label || r.role, 60), department: clip(r.department, 60), email: clip(r.email, 120), phone: clip(r.phone, 40), active: r.is_active !== false }));
  store.save();
  return { total: store.data.teamContacts.length };
}
