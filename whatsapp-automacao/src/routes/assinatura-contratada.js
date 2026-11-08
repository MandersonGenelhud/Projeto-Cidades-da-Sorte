// Assinatura da empresa (CONTRATADA) nos contratos: a própria pessoa cadastra a imagem da assinatura e autoriza o uso (nunca é desenhada nem imitada).
// Dois responsáveis: o 1º (ex.: Eliezer, responsável do escritório) e o 2º (ex.: Marcos, a ser cadastrado depois). Só aparece no contrato quem estiver
// cadastrado, autorizado e ligado. A imagem fica em data/ (0600, fora do Git).
// Isolado do server.js: o servidor chama makeContractorSigner(ctx), usa .contractorSigns() nos PDFs e liga as rotas com .register(app).
import fs from 'node:fs';
import path from 'node:path';

/** ctx: { store, dataDir, needAdmin, httpError, securityEvent, notifyAdmins, onChange } */
export function makeContractorSigner(ctx) {
  const { store, dataDir, needAdmin, httpError, securityEvent, notifyAdmins, onChange = () => {} } = ctx;
  // slot 1 mantém os nomes antigos (rota, arquivo e ajuste) para não quebrar o que já estava cadastrado.
  const SLOTS = [
    { n: 1, key: 'contractSigner', file: 'contract-signer.jpg', base: '/api/contract-signer', label: 'Responsável do escritório (1º)' },
    { n: 2, key: 'contractSigner2', file: 'contract-signer-2.jpg', base: '/api/contract-signer/2', label: 'Segundo responsável (2º)' },
  ];
  const fileOf = (s) => path.join(dataDir, s.file);
  const confOf = (s) => store.settings[s.key] || {};

  function signOf(s) {
    const c = confOf(s);
    if (!c.enabled || !c.authorizedAt || !c.name || !fs.existsSync(fileOf(s))) return null;
    return { image: fs.readFileSync(fileOf(s)), name: c.name, role: c.role || '', authorizedAt: c.authorizedAt };
  }
  /** Todos os que vão no contrato, na ordem (1º, 2º). */
  const contractorSigns = () => SLOTS.map(signOf).filter(Boolean);
  /** Compatibilidade: só o 1º. */
  const contractorSign = () => signOf(SLOTS[0]);
  const metaOf = (s) => {
    const c = confOf(s);
    return { slot: s.n, label: s.label, enabled: Boolean(c.enabled), name: c.name || '', role: c.role || '', hasImage: fs.existsSync(fileOf(s)), authorizedBy: c.authorizedBy || '', authorizedAt: c.authorizedAt || null, active: Boolean(signOf(s)) };
  };
  const signerMeta = () => metaOf(SLOTS[0]);
  const allMeta = () => SLOTS.map(metaOf);

  function registerSlot(app, s) {
    app.get(s.base, (req, res) => { needAdmin(req); res.json(metaOf(s)); });
    app.get(`${s.base}/image`, (req, res) => {
      needAdmin(req);
      if (!fs.existsSync(fileOf(s))) throw httpError(404, 'Nenhuma assinatura cadastrada');
      res.type('image/jpeg').set('Cache-Control', 'no-store').send(fs.readFileSync(fileOf(s)));
    });
    app.put(s.base, (req, res) => {
      needAdmin(req);
      const b = req.body || {};
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const role = String(b.role || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (name.split(' ').length < 2) throw httpError(400, 'Informe o nome completo de quem assina pela empresa');
      const cur = confOf(s);
      let newImage = false;
      if (b.image) {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image));
        const buf = m ? Buffer.from(m[1], 'base64') : null;
        if (!buf || buf.length < 1500 || buf.length > 600_000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw httpError(400, 'Envie a imagem da assinatura em JPEG (até 600 KB).');
        fs.writeFileSync(fileOf(s), buf, { mode: 0o600 });
        newImage = true;
      }
      if (!fs.existsSync(fileOf(s))) throw httpError(400, 'Cadastre primeiro a imagem da assinatura.');
      const enabled = b.enabled !== false;
      const authorizeNow = b.authorize === true;
      // Nova imagem ou novo nome exigem a confirmação de que a própria pessoa autoriza o uso da assinatura.
      if (enabled && (newImage || name !== cur.name || !cur.authorizedAt) && !authorizeNow) throw httpError(400, 'Marque a confirmação: a pessoa que assina autoriza o uso da própria assinatura nos contratos.');
      const authorizedAt = authorizeNow ? new Date().toISOString() : cur.authorizedAt || null;
      store.data.settings[s.key] = { enabled, name, role, authorizedBy: authorizeNow ? req.user.name : cur.authorizedBy || '', authorizedAt };
      store.save();
      securityEvent('assinatura_contratada', req.user, req, `${s.label}: ${enabled ? 'ligada' : 'desligada'} para ${name}${newImage ? ' (imagem nova)' : ''}`);
      notifyAdmins(`✍️ *Assinatura da empresa nos contratos ${enabled ? 'ligada' : 'desligada'}*\n👤 ${name} (${s.label})${newImage ? ' (imagem nova)' : ''}\nFeito por: ${req.user.name}\n🕒 ${new Date().toLocaleString('pt-BR')}\n\nSe não foi você, desligue em Equipe → Assinatura da empresa nos contratos.`);
      try { onChange(); } catch { /* o contrato é refeito de novo na próxima emissão */ }
      res.json(metaOf(s));
    });
    app.delete(s.base, (req, res) => {
      needAdmin(req);
      try { fs.rmSync(fileOf(s), { force: true }); } catch { /* já não existia */ }
      store.data.settings[s.key] = { enabled: false, name: confOf(s).name || '', role: confOf(s).role || '', authorizedBy: '', authorizedAt: null };
      store.save();
      securityEvent('assinatura_contratada', req.user, req, `${s.label}: removida`);
      try { onChange(); } catch { /* idem */ }
      res.json(metaOf(s));
    });
  }

  function registerRoutes(app) {
    // As rotas do 2º ficam antes das do 1º (a do 1º é prefixo da outra).
    app.get('/api/contract-signers', (req, res) => { needAdmin(req); res.json(allMeta()); });
    [...SLOTS].reverse().forEach((s) => registerSlot(app, s));
  }
  return { contractorSign, contractorSigns, signerMeta, allMeta, register: (app) => registerRoutes(app) };
}
