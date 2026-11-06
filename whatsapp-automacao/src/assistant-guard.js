// Trava de segurança da Maria e da Ana: elas só CRIAM (cadastro novo, orçamento, contrato) e ENVIAM. Nunca excluem nem alteram
// nada que já existe na plataforma. Quando alguém pede isso, nada é feito e o Marcos é avisado: quem pediu, o número dele e qual
// cliente/contrato era o alvo.
//
// Este arquivo só RECONHECE o pedido (texto → { kind, object }). O aviso e o registro ficam em src/maria.js.
import { fold1 as fold } from './ana-dates.js';

// Excluir / cancelar / apagar.
const DELETE = /\b(exclua|exclui|excluir|exclusao|apague|apaga|apagar|delete|deleta|deletar|remova|remove|remover|elimine|elimina|eliminar|limpe|limpar|descarte|descartar|cancele|cancela|cancelar|desative|desativa|desativar|anule|anula|anular)\b/;
// Alterar / corrigir / mudar / mexer no que já existe (inclui dar baixa, transferir e marcar como pago).
const MARK = /\b(marque|marca|marcar)\b.{0,40}\bcomo\b/;
const CHANGE = /\b(altere|altera|alterar|mude|muda|mudar|corrija|corrige|corrigir|atualize|atualiza|atualizar|edite|edita|editar|troque|troca|trocar|substitua|substituir|modifique|modifica|modificar|ajuste|ajusta|ajustar|transfira|transfere|transferir|renomeie|renomear|reabra|reabrir|reative|reativar|aumente|diminua|reduza|desconte|mova|mover|junte|unir|una|mescle|mesclar|marque como|marca como|de baixa|dar baixa|da baixa|passe .{0,25} para o vendedor)\b/;

// O que é "da empresa" (nunca pode ser excluído/alterado por elas). Para a Ana só vale o que é da empresa: a agenda e as finanças pessoais
// da própria pessoa (cancelar um compromisso, "desfaz") continuam funcionando.
const COMPANY = ['cliente', 'clientes', 'cadastro', 'cadastros', 'contrato', 'contratos', 'venda', 'vendas', 'orcamento', 'orcamentos', 'lead', 'leads', 'prospecto', 'prospectos', 'usuario', 'usuarios', 'vendedor', 'vendedores', 'comissao', 'comissoes', 'documento', 'documentos', 'conversa', 'conversas', 'ficha', 'fichas', 'saque', 'saques', 'imovel', 'imoveis', 'veiculo', 'veiculos'];
const MARIA_ONLY = ['lancamento', 'lancamentos', 'caixa', 'pagamento', 'pagamentos', 'boleto', 'recibo', 'telefone', 'cpf', 'rg', 'endereco', 'email', 'valor', 'preco', 'pacote', 'parcela', 'parcelas', 'cobranca', 'cobrancas', 'nome do cliente', 'portfolio'];
const objRe = (list) => new RegExp(`\\b(${list.join('|')})\\b`);
const OBJ_ANA = objRe(COMPANY);
const OBJ_MARIA = objRe([...COMPANY, ...MARIA_ONLY]);
// Perguntas sobre COMO fazer não são pedidos ("como excluo um cliente?"): quem responde é o bate-papo.
const QUESTION = /^(como|qual|quais|posso|quando|onde|por que|porque|o que|quem|existe|da para|dá para)\b/;

const SINGULAR = { comissoes: 'comissao', imoveis: 'imovel', cobrancas: 'cobranca', pacotes: 'pacote', valores: 'valor', precos: 'preco', emails: 'email', telefones: 'telefone', enderecos: 'endereco' };

/**
 * Pedido de excluir ou alterar algo da empresa? → { kind: 'excluir'|'alterar', object } ; senão null.
 * scope 'maria' (assistente da empresa) ou 'ana' (assistente pessoal: só os objetos da empresa contam).
 */
export function detectChange(text, scope = 'maria') {
  const n = fold(text).replace(/\s+/g, ' ').trim();
  if (!n || QUESTION.test(n)) return null;
  const del = DELETE.test(n);
  const chg = CHANGE.test(n) || MARK.test(n);
  if (!del && !chg) return null;
  const m = n.match(scope === 'ana' ? OBJ_ANA : OBJ_MARIA);
  if (!m) return null;
  return { kind: del ? 'excluir' : 'alterar', object: SINGULAR[m[1]] || m[1].replace(/s$/, '') };
}

export const OBJECT_LABEL = { cliente: 'o cliente', cadastro: 'o cadastro', contrato: 'o contrato', venda: 'a venda', orcamento: 'o orçamento', lead: 'o prospecto', prospecto: 'o prospecto', usuario: 'o usuário', vendedor: 'o vendedor', comissao: 'a comissão', documento: 'o documento', conversa: 'a conversa', ficha: 'a ficha', saque: 'o saque', imovel: 'o imóvel', veiculo: 'o veículo', lancamento: 'o lançamento', caixa: 'o caixa', pagamento: 'o pagamento', boleto: 'o boleto', recibo: 'o recibo', telefone: 'o telefone', cpf: 'o CPF', rg: 'o RG', endereco: 'o endereço', email: 'o e-mail', valor: 'o valor', preco: 'o preço', pacote: 'o pacote', parcela: 'a parcela', cobranca: 'a cobrança', portfolio: 'o portfólio' };
