// PASTA DO CLIENTE dentro do contrato: os documentos dele (passaporte, RG/CNH, certidões, antecedentes, foto, comprovantes, contrato assinado)
// ficam guardados no contrato. Na RENOVAÇÃO não é preciso pedir tudo de novo: a pasta do contrato novo mostra os documentos dos contratos
// anteriores do mesmo cliente (mesmo telefone ou mesmo nome).
// Dado sensível. Proteções:
//  - só vê quem pode ver o contrato (administrador, ou o vendedor dele);
//  - só PDF e imagem, conferidos pelo conteúdo do arquivo (não pelo nome);
//  - no máximo 15 MB por arquivo e 60 por contrato;
//  - arquivo em data/client-docs (fora do Git, pasta 0700, arquivo 0600, nome aleatório);
//  - download sempre como anexo, nunca aberto como página;
//  - cada envio, download e exclusão fica registrado; só administrador exclui.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DOC_KINDS = {
  passaporte: 'Passaporte', rg_cnh: 'RG ou CNH', certidao_nascimento: 'Certidão de nascimento', certidao_casamento: 'Certidão de casamento',
  antecedentes: 'Antecedentes criminais', foto: 'Foto', comprovante: 'Comprovante (endereço, renda, pagamento)', contrato_assinado: 'Contrato assinado',
  documento_paraguai: 'Documento emitido no Paraguai (cédula, radicação, RUC)', outro: 'Outro',
};
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 60;
const last9 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>"\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Tipo REAL do arquivo pelos primeiros bytes. Só PDF, JPEG, PNG e WEBP passam. */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Contratos do MESMO cliente (telefone igual, ou nome igual sem telefone), fora o próprio. */
export function sameClientSales(sale, all) {
  const ph = last9(sale?.client?.phone);
  const nm = fold(sale?.client?.nome);
  return all.filter((s) => s.id !== sale.id && ((ph && last9(s.client?.phone) === ph) || (!ph && nm && fold(s.client?.nome) === nm)));
}

/** ctx: { store, sales, dataDir, httpError, securityEvent, upload (multer .single('file') em memória) } */
export function registerPastaClienteRoutes(app, ctx) {
  const { store, sales, httpError } = ctx;
  const root = path.join(ctx.dataDir, 'client-docs');
  const docsOf = (saleId) => ((store.data.clientDocs ||= {})[saleId] ||= []);
  const saleFor = (req) => {
    const s = sales.get(req.params.id);
    if (!s || !sales.canSee(req.user, s)) throw httpError(404, 'Contrato não encontrado');
    return s;
  };
  const fileOf = (saleId, d) => path.join(root, saleId.replace(/[^A-Za-z0-9_-]/g, ''), d.file);
  const pub = (d) => ({ id: d.id, name: d.name, kind: d.kind, kindLabel: DOC_KINDS[d.kind] || 'Outro', mime: d.mime, size: d.size, at: d.at, by: d.by, note: d.note || '' });

  app.get('/api/sales/:id/docs', (req, res) => {
    const s = saleFor(req);
    const anteriores = sameClientSales(s, sales.list).filter((x) => sales.canSee(req.user, x))
      .map((x) => ({ saleId: x.id, number: x.number, createdAt: x.createdAt, docs: (store.data.clientDocs?.[x.id] || []).map(pub) }))
      .filter((x) => x.docs.length);
    res.json({ kinds: DOC_KINDS, docs: docsOf(s.id).map(pub), anteriores });
  });

  app.post('/api/sales/:id/docs', ctx.upload, (req, res) => {
    const s = saleFor(req);
    if (!req.file?.buffer?.length) throw httpError(400, 'Escolha um arquivo.');
    if (req.file.size > MAX_BYTES) throw httpError(413, 'Arquivo grande demais (máximo 15 MB).');
    const mime = sniffType(req.file.buffer);
    if (!mime) throw httpError(415, 'Só PDF ou foto (JPG, PNG, WEBP).');
    const list = docsOf(s.id);
    if (list.length >= MAX_FILES) throw httpError(409, `Esta pasta já tem ${MAX_FILES} arquivos.`);
    const dir = path.join(root, s.id.replace(/[^A-Za-z0-9_-]/g, ''));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomBytes(8).toString('hex');
    const file = `${id}.${EXT[mime]}`;
    fs.writeFileSync(path.join(dir, file), req.file.buffer, { mode: 0o600 });
    const kind = DOC_KINDS[req.body?.kind] ? req.body.kind : 'outro';
    const d = { id, file, name: clip(req.body?.name || req.file.originalname || DOC_KINDS[kind], 80) || DOC_KINDS[kind], kind, mime, size: req.file.size, at: new Date().toISOString(), by: req.user?.name || '', note: clip(req.body?.note, 200) };
    list.push(d);
    store.save();
    ctx.securityEvent?.('pasta_cliente_envio', req.user, req, `${s.number} · ${DOC_KINDS[kind]} (${d.name})`);
    res.json(pub(d));
  });

  // Baixar: do próprio contrato ou de um contrato anterior do mesmo cliente (renovação).
  app.get('/api/sales/:id/docs/:docId', (req, res) => {
    const s = saleFor(req);
    const pool = [s, ...sameClientSales(s, sales.list).filter((x) => sales.canSee(req.user, x))];
    let found = null; let owner = null;
    for (const x of pool) { const d = (store.data.clientDocs?.[x.id] || []).find((y) => y.id === req.params.docId); if (d) { found = d; owner = x; break; } }
    if (!found) throw httpError(404, 'Documento não encontrado');
    const f = fileOf(owner.id, found);
    if (!fs.existsSync(f)) throw httpError(404, 'O arquivo não está mais no servidor');
    ctx.securityEvent?.('pasta_cliente_download', req.user, req, `${owner.number} · ${found.name}`);
    res.set({ 'Content-Type': found.mime, 'Content-Disposition': `attachment; filename="${found.name.replace(/[^\w .-]/g, '_')}.${EXT[found.mime] || 'bin'}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.send(fs.readFileSync(f));
  });

  app.delete('/api/sales/:id/docs/:docId', (req, res) => {
    const s = saleFor(req);
    if (req.user?.role !== 'admin') throw httpError(403, 'Só o administrador exclui documentos da pasta.');
    const list = docsOf(s.id);
    const i = list.findIndex((d) => d.id === req.params.docId);
    if (i < 0) throw httpError(404, 'Documento não encontrado');
    const [d] = list.splice(i, 1);
    try { fs.unlinkSync(fileOf(s.id, d)); } catch { /* já não existia */ }
    store.save();
    ctx.securityEvent?.('pasta_cliente_exclusao', req.user, req, `${s.number} · ${d.name}`);
    res.json({ ok: true });
  });

  /** Para a Maria: os documentos guardados de um cliente (por contrato), sem os arquivos. */
  return {
    summaryFor(saleIds) {
      return saleIds.map((id) => ({ id, docs: (store.data.clientDocs?.[id] || []).map(pub) })).filter((x) => x.docs.length);
    },
  };
}
