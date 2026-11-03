// Reuniões gravadas: biblioteca de links (Drive, YouTube, Meet) com título, data e assunto. Não guarda vídeo, só o endereço.
import { uid } from './utils.js';

const URL_OK = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export class Recordings {
  constructor({ store }) { this.store = store; store.data.recordings ||= []; }
  list({ q = '' } = {}) {
    const n = String(q).toLowerCase();
    return this.store.data.recordings.filter((r) => !n || `${r.title} ${r.topic} ${r.notes}`.toLowerCase().includes(n)).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  }
  #clean(b, base = {}) {
    const r = { ...base };
    if (b.title !== undefined) r.title = clip(b.title, 120);
    if (b.topic !== undefined) r.topic = clip(b.topic, 80);
    if (b.notes !== undefined) r.notes = clip(b.notes, 600);
    if (b.date !== undefined) { const d = String(b.date || '').trim(); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Data inválida'); r.date = d; }
    if (b.link !== undefined) { const l = String(b.link || '').trim(); if (!URL_OK.test(l)) throw new Error('Cole o endereço da gravação (precisa começar com https://)'); r.link = l; }
    if (!r.title) throw new Error('Dê um título à gravação');
    return r;
  }
  add(b, by = '') {
    const r = this.#clean(b, { id: uid(), title: '', topic: '', notes: '', date: '', link: '', createdAt: new Date().toISOString(), createdBy: by });
    this.store.data.recordings.push(r); this.store.save(); return r;
  }
  update(id, b) {
    const i = this.store.data.recordings.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Gravação não encontrada');
    this.store.data.recordings[i] = this.#clean(b, this.store.data.recordings[i]); this.store.save(); return this.store.data.recordings[i];
  }
  remove(id) {
    const r = this.store.data.recordings.find((x) => x.id === id);
    if (!r) throw new Error('Gravação não encontrada');
    this.store.data.recordings = this.store.data.recordings.filter((x) => x.id !== id); this.store.save(); return r;
  }
}
