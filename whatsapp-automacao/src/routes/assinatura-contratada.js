// Assinatura da empresa (CONTRATADA) nos contratos: a própria pessoa cadastra a imagem da assinatura e autoriza o uso (nunca é desenhada nem imitada).
// Isolado do server.js: o servidor chama makeContractorSigner(ctx), usa .contractorSign() nos PDFs e liga as rotas com .register(app).
import fs from 'node:fs';
import path from 'node:path';

/** ctx: { store, dataDir, needAdmin, httpError, securityEvent, notifyAdmins } */
export function makeContractorSigner(ctx) {
  const { store, dataDir, needAdmin, httpError, securityEvent, notifyAdmins } = ctx;
// Assinatura da CONTRATADA (ex.: Eliezer) nos contratos: só vale se a própria pessoa cadastrou a imagem da sua assinatura e marcou
// que autoriza. O sistema nunca desenha nem imita assinatura. A imagem fica em data/ (fora do Git).
const signerFile = () => path.join(dataDir, 'contract-signer.jpg');
function contractorSign() {
  const c = store.settings.contractSigner;
  if (!c?.enabled || !c.authorizedAt || !c.name || !fs.existsSync(signerFile())) return null;
  return { image: fs.readFileSync(signerFile()), name: c.name, role: c.role || '', authorizedAt: c.authorizedAt };
}
const signerMeta = () => {
  const c = store.settings.contractSigner || {};
  return { enabled: Boolean(c.enabled), name: c.name || '', role: c.role || '', hasImage: fs.existsSync(signerFile()), authorizedBy: c.authorizedBy || '', authorizedAt: c.authorizedAt || null, active: Boolean(contractorSign()) };
};
function registerRoutes(app) {
app.get('/api/contract-signer', (req, res) => { needAdmin(req); res.json(signerMeta()); });
app.get('/api/contract-signer/image', (req, res) => {
  needAdmin(req);
  if (!fs.existsSync(signerFile())) throw httpError(404, 'Nenhuma assinatura cadastrada');
  res.type('image/jpeg').set('Cache-Control', 'no-store').send(fs.readFileSync(signerFile()));
});
app.put('/api/contract-signer', (req, res) => {
  needAdmin(req);
  const b = req.body || {};
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const role = String(b.role || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name.split(' ').length < 2) throw httpError(400, 'Informe o nome completo de quem assina pela empresa');
  const cur = store.settings.contractSigner || {};
  let newImage = false;
  if (b.image) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image));
    const buf = m ? Buffer.from(m[1], 'base64') : null;
    if (!buf || buf.length < 1500 || buf.length > 600_000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw httpError(400, 'Envie a imagem da assinatura em JPEG (até 600 KB).');
    fs.writeFileSync(signerFile(), buf, { mode: 0o600 });
    newImage = true;
  }
  if (!fs.existsSync(signerFile())) throw httpError(400, 'Cadastre primeiro a imagem da assinatura.');
  const enabled = b.enabled !== false;
  const authorizeNow = b.authorize === true;
  // Nova imagem ou novo nome exigem a confirmação de que a própria pessoa autoriza o uso da assinatura.
  if (enabled && (newImage || name !== cur.name || !cur.authorizedAt) && !authorizeNow) throw httpError(400, 'Marque a confirmação: a pessoa que assina autoriza o uso da própria assinatura nos contratos.');
  const authorizedAt = authorizeNow ? new Date().toISOString() : cur.authorizedAt || null;
  store.data.settings.contractSigner = { enabled, name, role, authorizedBy: authorizeNow ? req.user.name : cur.authorizedBy || '', authorizedAt };
  store.save();
  securityEvent('assinatura_contratada', req.user, req, `${enabled ? 'ligada' : 'desligada'} para ${name}${newImage ? ' (imagem nova)' : ''}`);
  notifyAdmins(`✍️ *Assinatura da empresa nos contratos ${enabled ? 'ligada' : 'desligada'}*\n👤 ${name}${newImage ? ' (imagem nova)' : ''}\nFeito por: ${req.user.name}\n🕒 ${new Date().toLocaleString('pt-BR')}\n\nSe não foi combinado, avise o Marcos.`).catch(() => {});
  res.json(signerMeta());
});
app.delete('/api/contract-signer', (req, res) => {
  needAdmin(req);
  try { fs.rmSync(signerFile(), { force: true }); } catch { /* já não existia */ }
  store.data.settings.contractSigner = { enabled: false, name: store.settings.contractSigner?.name || '', role: store.settings.contractSigner?.role || '', authorizedBy: '', authorizedAt: null };
  store.save();
  securityEvent('assinatura_contratada', req.user, req, 'removida');
  res.json(signerMeta());
});
}
  return { contractorSign, signerMeta, register: (app) => registerRoutes(app) };
}
