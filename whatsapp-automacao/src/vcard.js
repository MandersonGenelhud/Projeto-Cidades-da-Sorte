// Contatos em vCard (.vcf): o arquivo que o iPhone, o Android e o Google Contatos importam direto para a agenda do celular.
const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').trim();

/** contacts: [{ name, phone, tags? }] → texto .vcf (vCard 3.0). Telefone só com dígitos e "+" na frente; sem telefone válido, o contato é ignorado. */
export function contactsToVcf(contacts) {
  const out = [];
  for (const c of contacts || []) {
    const digits = String(c?.phone ?? '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    const name = clean(c.name) || `+${digits}`;
    out.push(['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, `N:${name};;;;`, `TEL;TYPE=CELL:+${digits}`, ...(c.tags?.length ? [`CATEGORIES:${c.tags.map(clean).join(',')}`] : []), 'END:VCARD'].join('\r\n'));
  }
  return `${out.join('\r\n')}\r\n`;
}
