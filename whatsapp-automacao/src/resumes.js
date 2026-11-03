// Banco de currículos: quem pergunta por vaga ou manda currículo fica guardado aqui (com o arquivo),
// sem avisar o Marcos, a equipe ou parceiros. Só o administrador vê. Arquivos ficam em data/curriculos (fora do Git).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX = 15_000_000;
const TYPES = { 'application/pdf': ['pdf', '%PDF'], 'image/jpeg': ['jpg', '\xff\xd8\xff'], 'image/png': ['png', '\x89PNG'], 'image/webp': ['webp', 'RIFF'], 'application/msword': ['doc', '\xd0\xcf\x11\xe0'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx', 'PK\x03\x04'] };
export const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([m, [e]]) => [e, m]));
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const err = (status, message) => Object.assign(new Error(message), { status });
export const THANKS = 'Recebi o seu currículo, obrigado! Ele fica guardado no nosso banco de dados e, se surgir uma vaga, a gente entra em contato.';

export class Resumes {
  constructor({ store, dataDir, download = async () => null, send = async () => {}, remember = () => {}, now = () => Date.now() }) {
    Object.assign(this, { store, download, send, remember, now });
    this.dir = path.join(dataDir, 'curriculos');
    fs.mkdirSync(this.dir, { recursive: true });
    store.data.resumes ||= [];
  }

  get list() {
    return this.store.data.resumes;
  }

  /** A IA identificou alguém interessado em vaga. Um registro por pessoa (telefone ou conversa). */
  register(conv, { nome = '', interesse = '', resumo = '' } = {}) {
    const key = conv.key;
    let r = this.list.find((x) => x.convKey === key);
    if (!r) {
      r = { id: crypto.randomBytes(6).toString('hex'), convKey: key, phone: conv.phone || '', channel: String(key).startsWith('ig:') ? 'instagram' : 'whatsapp', name: clean(nome || conv.name, 100), interest: '', summary: '', status: 'novo', files: [], at: new Date(this.now()).toISOString() };
      this.list.push(r);
    }
    r.name ||= clean(nome, 100);
    if (interesse) r.interest = clean(interesse, 120);
    if (resumo) r.summary = clean(resumo, 600);
    conv.candidate = { at: new Date(this.now()).toISOString(), id: r.id };
    this.store.save();
    return r;
  }

  /** O cliente mandou um arquivo e a conversa é de candidato (nos últimos 30 dias)? */
  wants(msg, conv) {
    if (!msg || msg.isGroup || msg.fromMe || msg.channel === 'instagram') return false;
    const media = msg.hasImage || /pdf|msword|officedocument/i.test(msg.documentMime || '');
    const c = conv?.candidate;
    return Boolean(media && c && this.now() - Date.parse(c.at) < 30 * 86400000);
  }

  async handle(msg, conv) {
    const r = this.list.find((x) => x.id === conv.candidate.id);
    if (!r) return false;
    let buffer;
    try { buffer = await this.download(msg); } catch { buffer = null; }
    if (!buffer) { await this.send(msg.jid, { text: 'Não consegui abrir o arquivo. Pode enviar de novo, em PDF ou foto?' }); return true; }
    const saved = this.attach(r.id, buffer, msg.hasImage ? msg.imageMime || 'image/jpeg' : msg.documentMime, msg.fileName || '');
    const text = saved ? THANKS : 'Esse tipo de arquivo eu não consigo guardar. Pode enviar em PDF, Word ou foto?';
    await this.send(msg.jid, { text });
    this.remember(conv, 'assistant', text);
    return true;
  }

  attach(id, buffer, mime, originalName = '') {
    const r = this.list.find((x) => x.id === id);
    const t = TYPES[String(mime || '').split(';')[0].toLowerCase()];
    if (!r || !t || buffer.length > MAX || !buffer.subarray(0, 8).toString('latin1').startsWith(t[1])) return null;
    const fileId = crypto.randomBytes(6).toString('hex');
    const stored = `${fileId}.${t[0]}`;
    fs.writeFileSync(path.join(this.dir, stored), buffer);
    const f = { id: fileId, name: clean(path.basename(originalName || `curriculo.${t[0]}`), 80), ext: t[0], size: buffer.length, stored, at: new Date(this.now()).toISOString() };
    r.files.push(f);
    if (r.status === 'novo') r.status = 'recebido';
    this.store.save();
    return f;
  }

  filePath(rid, fid) {
    const r = this.list.find((x) => x.id === rid);
    const f = r?.files.find((x) => x.id === fid);
    return f ? { ...f, path: path.join(this.dir, f.stored) } : null;
  }

  update(id, { status, note }) {
    const r = this.list.find((x) => x.id === id);
    if (!r) throw err(404, 'Candidato não encontrado');
    if (status !== undefined) {
      if (!['novo', 'recebido', 'visto', 'chamar', 'arquivado'].includes(status)) throw err(400, 'Situação inválida');
      r.status = status;
    }
    if (note !== undefined) r.note = clean(note, 500);
    this.store.save();
    return r;
  }

  remove(id) {
    const r = this.list.find((x) => x.id === id);
    if (!r) throw err(404, 'Candidato não encontrado');
    for (const f of r.files) fs.rmSync(path.join(this.dir, f.stored), { force: true });
    this.store.data.resumes = this.list.filter((x) => x.id !== id);
    this.store.save();
  }

  csv() {
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    return `﻿${['nome;telefone;canal;interesse;resumo;situacao;arquivos;data', ...this.list.map((r) => [r.name, r.phone, r.channel, r.interest, r.summary, r.status, r.files.length, r.at].map(cell).join(';'))].join('\r\n')}`;
  }
}
