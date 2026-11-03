# Relatório do Migra Hub (o que foi feito e onde clicar)

Atualizado em 31/10/2026. Tudo abaixo está no sistema depois de **Atualizar agora**.

## 1. Caixa e Nina (secretária financeira do Marcos)
- **Caixa** (menu Vendas → Caixa): entradas e saídas, por moeda (R$, US$, Gs.), com separação **Empresa / Pessoal / Dízimo**, filtros, histórico e botão **Baixar planilha**.
- **Nina** (WhatsApp do Marcos, conversa "Você"): ele manda áudio ou texto começando com "Nina…".
  - Registrar: "Nina, gastei 50 reais com gasolina".
  - Consultar: "Nina, quanto gastei com gasolina esse mês?".
  - Planilha: "Nina, me manda a planilha".
  - Dízimo: "Nina, quanto devo de dízimo?".
  - Corrigir: depois de registrar, responder "pessoal", "empresa" ou "dízimo".
  - Comprovante: foto com a legenda "Nina" (ela lê e pergunta antes de lançar).
  - Responde em **voz animada** (Gemini) quando ele fala por áudio.
- **Testar sem WhatsApp:** Caixa → ⚙️ Categorias… → 🧪 Testar a Nina agora.

## 2. Equipe e áreas
- **Equipe**: cada pessoa tem os botões 🛂 Documentação · 🏡 Terrenos · 🚗 Veículos. Define quem recebe cada tipo de cliente (IA, Nina, Instagram e indicações de parceiros).
- **WhatsApp de cada vendedor** (na própria Equipe e em Conexões): QR Code, liga/desliga a IA e o **nome da atendente** de cada número (não pode ser "Nina").
- **Corretor, terreno e parceria imobiliária** vão para Gabriel e Diego, nunca para o Marcos. Um único aviso por cliente (sem repetir).

## 3. Visitas e pagamentos
- **Visita presencial com a assessoria**: taxa de reserva de **R$ 150**, paga antes por Pix, **estornada se o cliente fechar**. Cliente da Migra não paga.
- **Mentoria com o Marcos**: **US$ 250 (dólares americanos), nunca estornada**.
- **Aba Visitas → "Avisar quem já pediu visita"**: você confere a lista e a mensagem e clica em Enviar (uma pessoa por vez, uma única vez cada).
- **Comprovante de Pix**: o cliente manda a foto na conversa, a IA lê e dá baixa só se tudo conferir (valor, recebedor, data, transação única, até R$ 5.000). Qualquer dúvida vai para você conferir no extrato.

## 4. VPS e HTTPS (em andamento)
- VPS: Hostinger KVM 4, IP **187.41.108.131**. Domínio: **migraparaguai.tech** (endereço `app.migraparaguai.tech`).
- Falta: criar o registro A `app` → 187.41.108.131, entrar na VPS (`ssh root@187.41.108.131`) e rodar a instalação (`deploy/instalar-vps.sh`).
- Depois: migrar os dados do computador (`deploy/migrar-dados.sh`), ligar o Instagram com `https://app.migraparaguai.tech/webhook/instagram`.
- Atualizar na VPS: `bash deploy/atualizar-vps.sh`. Backup diário automático.
- Passo a passo completo: `deploy/LEIA-ME-VPS.md`.

## 4.1 Novidades: empresas, financiamento e auditoria (02/11/2026)
- **Auditoria** (menu "Auditoria", só Marcos): quem criou, alterou ou excluiu lotes, preços, juros, veículos, alunos, propostas e perfis, com o valor de antes e depois. Não dá para apagar pelo painel.
- **Financiamento de lotes** (menu "Financiamento de lotes"): simulador com entrada que abate o saldo, entrada em várias vezes e juros por faixa de parcelas (quanto mais parcelas, maior o %). **Os juros começam em 0%: o Marcos define as faixas.** Gera a **proposta de reserva em PDF**, que só vale com a reserva paga (antes sai com tarja "sem valor"); exige todos os dados do cliente; relatório de parcelas.
- **Perfis:** vendedor reserva e muda a situação do lote, nunca exclui nem muda preço; **gerente** (botão na Equipe) cadastra mapas, lotes, veículos e alunos e confirma reservas, mas não exclui nem mexe em juros; só o Marcos exclui, muda juros e vê a auditoria.
- **Migra Motors:** estoque de veículos e comparação de financiamento entre bancos, financeiras e consórcios. **As taxas são cadastradas pelo Marcos** (o sistema não inventa taxa).
- **Migra School:** alunos, etapa, nível, frequência de acesso por semana e quem sumiu há 14+ dias.
- **Atendentes (funil)** (menu Vendas, só Marcos): conversas e prospectos separados por pessoa (Marcos, Fran, Eliezer…), número principal e Instagram sem vendedor, com funil conversas → prospecto → contato → proposta → fechamento e de onde veio cada cliente. No computador, uma coluna por pessoa numa tela só; no celular, cartões grandes: toca na pessoa e depois na conversa.
- **Sites por marca** (públicos): `/marcas` (todas as empresas), `/migra` (documentação e migração), `/imoveis`, `/motors` (veículos publicados) e `/school` (idiomas). Quem preenche "Tenho interesse" vira prospecto e cai direto no atendente da área (Documentação, Terrenos ou Veículos, conforme a Equipe), que recebe o aviso no WhatsApp. Limite de 8 pedidos por hora por endereço contra spam.
- **Contratos antigos do Marcos (sem print):** `tools/capturar-sistema/CAPTURAR.bat` abre o navegador, você entra no sistema dele (senha só no navegador), abre a lista de contratos e aperta ENTER: a ferramenta percorre sozinha todas as páginas, lê cada contrato e baixa os PDFs. Depois, em **Contratos antigos → Importar**, envia o `captura.json`. O painel reconhece número, cliente, documento, valor, data, situação, serviço e vendedor, não duplica e mostra o último número de contrato.
- **Retomar contatos** (menu Vendas, só Marcos): importa leads do Instagram/Facebook/site/quiz (planilha ou captura.json), cruza com as conversas do WhatsApp e o CRM e separa quem já falou de quem não. Quem não falou aparece para você aprovar; a primeira mensagem ("Eu vi que você entrou em contato com a gente lá no Instagram…") sai uma por vez, 8h–20h, com limite diário (começa em 15 por dia; o teto é 30) e a taxa de resposta na tela. Grupos de WhatsApp não recebem automático.
- **Captura do sistema inteiro:** o programa de cópia agora percorre todas as telas e clica em "Próxima" nas listas.
- **Painel executivo** (primeira tela do Marcos): cobranças e vencimentos de hoje, da semana, do mês e do ano (vence, recebido, a receber, atrasado), recebido × vendido em 12 meses, o que deve entrar nas próximas 8 semanas, atrasos por faixa e maiores atrasos, vendedores do mês, origem dos clientes, funil e alertas. Visual escuro/futurista, com layout próprio para celular.
- **Módulos (standby):** o administrador desliga telas que não usa (somem do menu, nada é apagado) e liga de volta quando quiser. A tela também mostra o que decidimos sobre cada parte do sistema antigo do Marcos.
- **Visual executivo:** painel e sites sem emojis; ícones próprios da Migra (traço fino) em todas as telas; fundo próprio com curvas de nível e fios dourados que aparece através dos cartões de vidro; paleta sóbria (verde Migra, cinza e um fio dourado).
- **Site da Migra (página inicial)** em domínio próprio, separado do painel: início com as 4 empresas, como funciona, destaques ao vivo (lotes, imóveis, veículos), programa de indicação com as comissões vigentes, perguntas frequentes e WhatsApp. Pronto para buscadores (título, descrição, sitemap, robots). Para ligar: registrar o domínio, apontar o DNS e rodar `deploy/adicionar-site.sh`.
- **Site: identidade e conteúdo editável.** A página inicial usa o verde e o dourado da Migra com títulos serifados. A aba **Site da Migra** (painel) edita título, números de destaque (vazio até confirmar), vídeos de depoimento (YouTube ou .mp4) e perguntas frequentes. A página é montada no servidor (rápida, boa para o Google, com dados estruturados das perguntas).
- **Dois escritórios no mesmo sistema (Paraguai e Paraná).** Cada pessoa tem um escritório; a equipe só vê o do próprio escritório (prospectos, conversas, vendas, orçamentos, cobranças, WhatsApp, ranking, rodízio e áreas). Marcos e Manderson (administrador geral) veem os dois e escolhem no topo. Há também o **administrador do escritório** (cuida da equipe e dos resultados só do escritório dele). Aba **Escritórios**: comparativo lado a lado e IA própria de cada escritório. Cada domínio do site marca o escritório do cliente (`adicionar-site.sh dominio py|pr`).
- **Preço do serviço (revenda da automação).** A aba **Preço do serviço** mede o consumo real da IA (tokens e respostas por escritório) e calcula o custo por resposta, os custos fixos, o suporte e a margem, com planos sugeridos, excedente e texto de proposta. Os preços do Google são digitados por você (nunca ficam no código). Guia completo em `PRECIFICACAO.md`.
- **Cópia completa do sistema do Marcos:** o programa de cópia agora também lê os números das telas, o sino de notificações, as abas (contratos vencidos), as parcelas e os cadastros de clientes. No painel, **Contratos antigos → Levar para Vendas e CRM** transforma os contratos com parcelas em vendas (vencimentos, atrasos e a receber no Painel executivo, sem comissão) e os clientes em prospectos do CRM.
- **Cópia e envio 100% automáticos:** o programa baixado pelo painel copia o sistema antigo (com as fotos e documentos) e já manda tudo para o sistema novo: contratos, clientes, parcelas, arquivos no contrato certo, vendas e CRM. Sem importar nada à mão.
- **Ainda falta:** endereço próprio de cada site (domínio por marca), pacote de documentos e legislação de imigração, painel consolidado por empresa, número de contrato compartilhado com o site do Marcos.

## 5. Pendências suas
1. DNS: registro A `app` → 187.41.108.131 e conferir com `nslookup app.migraparaguai.tech`.
2. Entrar na VPS e me avisar para eu passar o comando de instalação.
3. Total do acordo entre você e o Marcos (R$ 15.000?) e as datas dos dois Pix de R$ 1.000, para lançar no Caixa.
4. Trocar o nome da atendente de clientes (hoje "Nina") por outro, para não confundir com a secretária.
5. Desconectar qualquer outra ferramenta ligada ao Instagram antes de ligar a nossa.

## 6. Regras de segurança
- Nunca mandar senha, códigos, chaves ou tokens por chat. Colar só no painel.
- `data/` (banco, chaves, sessão do WhatsApp, backups) nunca vai para o Git.
- Detalhes em `SEGURANCA.md`.

## 7. Onde está o código
- Repositório MandersonGenelhud/Projeto-Cidades-da-Sorte, branch `claude/whatsapp-automation-tool-247je5`, pasta `whatsapp-automacao/`.
