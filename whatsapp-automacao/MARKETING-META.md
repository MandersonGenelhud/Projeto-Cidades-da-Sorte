# Anúncios na Meta e leads: o que dá para ligar ao sistema

Estudo a partir dos prints do sistema antigo (Distribuição de Leads, Leads Quiz, Cadastro no site, Leads do grupo).
Nada aqui foi ligado ainda: são os caminhos, o que cada um exige e o que depende da Meta.

## O que o sistema antigo faz
- **Formulário instantâneo do Facebook:** o lead preenche, cai na lista, o rodízio escolhe o consultor e o lead abre o WhatsApp.
- **Leads Quiz / Cadastro no site:** quiz e formulário do site vão para o WhatsApp do Marcos e ficam registrados.
- **Leads do grupo:** 3.610 pessoas do ManyChat (comentou, recebeu o link, entrou no grupo), só 3 "no grupo".

## Caminho recomendado: anúncio que abre direto o WhatsApp do Marcos
1. **Anúncio "Click-to-WhatsApp"** (Facebook e Instagram): o botão abre uma conversa com o número principal. É o único funil, como combinado.
2. **O que o nosso sistema já faz:** recebe a mensagem, a IA atende, guarda de qual anúncio veio (campo "Veio do anúncio" no prospecto) e encaminha ao vendedor.
3. **O que falta decidir:** quem cria e paga os anúncios (a conta de anúncios e o cartão são de vocês, em Meta Business). Eu não entro nessas contas: o Claude Code como gerenciador do Instagram que você citou precisa ser feito por você no caminho oficial da Meta.

## Formulário instantâneo (Lead Ads) dentro do nosso sistema
- A Meta entrega o lead por webhook (`leadgen`). Exige: aplicativo Meta aprovado, permissões de página e a revisão da Meta. Dá para fazer, mas leva dias de aprovação e é um passo à parte.
- Mais simples para começar: o formulário abre o WhatsApp (item acima) e dispensa a integração.

## Quiz
- O quiz do sistema antigo continua no site deles. Para trazer: o quiz do nosso site manda o lead para o mesmo WhatsApp (já existe o formulário `/api/public/lead`).

## Grupos do WhatsApp
- **Feito:** aba "Grupos do WhatsApp" lê os grupos em que o número principal está (o Marcos é administrador) e mostra quantos já foram atendidos e quantos não.
- **Não dá:** pegar grupos de "contato" de outra conta sem estar conectado a ela. Só os grupos em que o número conectado está.
- **ManyChat (3.610):** a lista vem do sistema deles; entra pela cópia (Retomar contatos) e o envio só com a sua aprovação, no limite diário.

## Riscos a ter em mente
- O Instagram está bloqueado: nada de envio em massa até o desbloqueio (pedir pelo caminho oficial).
- Mensagem automática para quem não pediu aumenta o risco de bloqueio do número principal. Por isso o envio é limitado e com aprovação.
