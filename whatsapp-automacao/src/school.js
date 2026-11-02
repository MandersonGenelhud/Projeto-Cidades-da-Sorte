// Migra School: alunos de idiomas, etapa em que estão e frequência de acesso.
import crypto from 'node:crypto';

export const STAGES = { matriculado: 'Matriculado', ativo: 'Estudando', trancado: 'Trancado', concluido: 'Concluído', desistente: 'Desistente' };
export const LEVELS = ['Iniciante', 'Básico', 'Intermediário', 'Avançado', 'Fluente'];
const err = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const DAY = 86400000;

export class School {
  constructor({ store }) {
    this.store = store;
    store.data.school ||= { students: [] };
  }

  get students() {
    return this.store.data.school.students;
  }

  student(sid) {
    return this.students.find((s) => s.id === sid) || null;
  }

  save(sid, input) {
    let s = sid ? this.student(sid) : null;
    if (sid && !s) throw err(404, 'Aluno não encontrado');
    const isNew = !s;
    s ||= { id: crypto.randomBytes(6).toString('hex'), enrolledAt: new Date().toISOString(), stage: 'matriculado', level: 'Iniciante', accesses: [], lastAccessAt: null };
    for (const k of ['name', 'phone', 'email', 'language', 'teacher', 'note']) if (input[k] !== undefined) s[k] = text(input[k], k === 'note' ? 600 : 120);
    if (!s.name) throw err(400, 'Informe o nome do aluno');
    if (!s.language) s.language = 'Espanhol';
    if (input.stage !== undefined) {
      if (!STAGES[input.stage]) throw err(400, 'Etapa inválida');
      s.stage = input.stage;
    }
    if (input.level !== undefined) {
      if (!LEVELS.includes(input.level)) throw err(400, 'Nível inválido');
      s.level = input.level;
    }
    s.updatedAt = new Date().toISOString();
    if (isNew) this.students.push(s);
    this.store.save();
    return s;
  }

  remove(sid) {
    this.store.data.school.students = this.students.filter((s) => s.id !== sid);
    this.store.save();
  }

  /** Registra um acesso/aula do aluno (e já passa de "matriculado" para "estudando"). */
  access(sid, at = new Date()) {
    const s = this.student(sid);
    if (!s) throw err(404, 'Aluno não encontrado');
    s.accesses.push(new Date(at).toISOString());
    if (s.accesses.length > 400) s.accesses.splice(0, s.accesses.length - 400);
    s.lastAccessAt = s.accesses.reduce((a, b) => (a > b ? a : b));
    if (s.stage === 'matriculado') s.stage = 'ativo';
    this.store.save();
    return s;
  }

  /** Acessos por semana nas últimas 4 semanas. */
  frequency(s, now = Date.now()) {
    const recent = s.accesses.filter((a) => now - Date.parse(a) <= 28 * DAY).length;
    return Math.round((recent / 4) * 10) / 10;
  }

  list({ stage, q, inactiveDays } = {}, now = Date.now()) {
    const needle = String(q || '').toLowerCase();
    return this.students
      .map((s) => ({ ...s, accesses: undefined, accessCount: s.accesses.length, perWeek: this.frequency(s, now), daysAway: s.lastAccessAt ? Math.floor((now - Date.parse(s.lastAccessAt)) / DAY) : null }))
      .filter((s) => (!stage || s.stage === stage) && (!needle || `${s.name} ${s.phone} ${s.language}`.toLowerCase().includes(needle))
        && (!inactiveDays || (['matriculado', 'ativo'].includes(s.stage) && (s.daysAway === null ? Math.floor((now - Date.parse(s.enrolledAt)) / DAY) : s.daysAway) >= Number(inactiveDays))));
  }

  summary(now = Date.now()) {
    const all = this.list({}, now);
    const count = (key, values) => Object.fromEntries(values.map((v) => [v, all.filter((s) => s[key] === v).length]));
    const studying = all.filter((s) => ['matriculado', 'ativo'].includes(s.stage));
    return {
      total: all.length,
      byStage: count('stage', Object.keys(STAGES)),
      byLevel: count('level', LEVELS),
      studying: studying.length,
      avgPerWeek: studying.length ? Math.round((studying.reduce((a, s) => a + s.perWeek, 0) / studying.length) * 10) / 10 : 0,
      atRisk: this.list({ inactiveDays: 14 }, now).length,
    };
  }
}
