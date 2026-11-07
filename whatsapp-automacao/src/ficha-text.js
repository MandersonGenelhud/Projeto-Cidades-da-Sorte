// A ficha de dados em TEXTO: muita gente tem medo de tocar num link, então o pedido sempre vai também escrito, para a pessoa
// preencher e responder por conta própria, e o link vai logo depois, sozinho, para quem preferir ir mais rápido.

/** Os dados que o contrato precisa, em texto. E-mail é opcional; dependentes entram na cláusula própria do contrato. */
export const FICHA_CAMPOS = `DADOS PARA O CONTRATO
Nome completo:
CPF:
RG:
Nacionalidade:
Estado civil:
Telefone:
Email (se quiser):
Endereço (rua, número, bairro, cidade e estado):
Dependentes (se houver: nome completo, parentesco e idade; se não tiver, escreva "nenhum"):`;

/** Texto do pedido, para copiar e mandar ao cliente (ou para a Maria mandar). */
export function fichaPedido({ nome = '', contrato = false } = {}) {
  const oi = nome ? `Oi, ${String(nome).split(' ')[0]}! ` : 'Oi! ';
  return `${oi}Para gerar ${contrato ? 'o seu contrato' : 'a sua reserva'}, preencha estes dados e me mande de volta por aqui, escrito mesmo:\n\n${FICHA_CAMPOS}\n\nSe preferir ir mais rápido, é só tocar no link que mando logo abaixo e preencher (uns 2 minutos, o CEP completa o endereço). Qualquer dúvida, me chama. 😊`;
}

/** As duas mensagens: o pedido por escrito e, logo depois, o link sozinho (fácil de tocar e de encaminhar). */
export const fichaMensagens = (url, opts = {}) => [fichaPedido(opts), url];
