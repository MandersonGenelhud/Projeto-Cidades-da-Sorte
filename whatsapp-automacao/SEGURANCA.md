# Segurança do Migra Hub

Nenhum sistema é impossível de invadir. O objetivo é tornar a invasão muito difícil, perceber rápido quando alguém tenta e conseguir voltar ao normal sem perder dados. Este arquivo diz o que já está no sistema, o que fazer na operação e o que vem depois.

## 1. O que já está no sistema

| Proteção | Como funciona |
| --- | --- |
| Senhas | Guardadas só como hash scrypt com sal, nunca em texto. |
| Verificação em duas etapas (2FA) | **Obrigatória para todos.** No primeiro acesso, o sistema só deixa configurar o app autenticador (código de 6 números, padrão TOTP/RFC 6238). |
| Cadastro de vendedor | A pessoa se cadastra pelo link, mas só entra depois que o administrador libera na aba Equipe. O pedido avisa os administradores no WhatsApp. Senha com no mínimo 8 caracteres, com letras e números. |
| Portal dos parceiros | Senha com no mínimo 8 caracteres, com letras e números. O parceiro vê só o nome, o serviço e a situação das indicações dele, nunca o telefone do cliente. Os dados de recebimento (Pix ou conta no Paraguai) aparecem só para o administrador. |
| Pré-cadastro público | No máximo 8 envios por hora do mesmo IP. Exige autorização de contato (LGPD). Indicar a si mesmo não gera comissão, e vale o primeiro indicador. |
| Orçamentos | Cada vendedor vê só os próprios orçamentos; o administrador vê todos. A criação fica registrada nos acessos (quem fez, número, cliente, valor). |
| Limite de tentativas | 5 senhas erradas no mesmo login, ou 20 no mesmo IP, bloqueiam por 15 minutos. Vale também para o portal dos parceiros. O bloqueio avisa os administradores no WhatsApp. |
| Aviso de acesso novo | Entrada de um IP novo avisa os administradores no WhatsApp. |
| Sessões | Duram 7 dias e o cookie é assinado (HMAC), HttpOnly e Secure no HTTPS. É possível sair de todos os aparelhos ou derrubar o acesso de todo mundo. Trocar a senha derruba os outros acessos. |
| Registro de acessos | Configurações → Segurança mostra quem entrou, senhas erradas, bloqueios, IP e aparelho. |
| Cabeçalhos HTTP | Proteção contra iframe de terceiros, contra adivinhação de tipo de arquivo e HSTS no HTTPS. O IP do cliente só vem do proxy local, então ninguém consegue falsificar o IP para fugir do limite. |
| Backup | Um por dia, cifrado com AES-256-GCM (arquivo alterado não abre), 30 dias guardados e cópia extra opcional fora do disco. A chave fica em `data/backup.key`. |
| Links públicos | Ficha, termo, etapas, orçamento e recibo usam um token HMAC por link, que não dá para adivinhar. |
| Dependências | `npm audit` com 0 vulnerabilidades conhecidas em 30/10/2026. |
| Segredos | `data/` (banco, chaves, sessão do WhatsApp) fica fora do Git. Chaves de API não voltam para a tela depois de salvas. |

Para restaurar um backup: `node src/backup.js restaurar data/backups/<arquivo>.mhb`. O comando gera `data/db.restaurado.json`. Depois, desligue o sistema e troque esse arquivo pelo `db.json`.

## 2. Operação (o que mais evita invasão)

1. Ligue a verificação em duas etapas em todas as contas importantes:
   - Migra Hub (todos os administradores);
   - Gmail;
   - Hostinger;
   - Meta (Facebook e Instagram);
   - banco;
   - GitHub.
2. Use uma senha diferente em cada lugar, guardada num gerenciador de senhas (Bitwarden, por exemplo). Nunca mande senha por WhatsApp ou chat. Senha repetida é a causa mais comum de invasão.
3. O e-mail é a chave de todas as contas: proteja-o primeiro. Confira também se ninguém criou encaminhamento automático ou filtro escondendo alertas.
4. Guarde a chave do backup fora do computador. Configure a pasta extra num Google Drive ou OneDrive. Uma vez por mês, teste abrir um backup.
5. Na VPS:
   - entre por SSH só com chave (sem senha) e não use o usuário root;
   - mantenha o firewall aberto apenas nas portas 22, 80 e 443;
   - deixe as atualizações automáticas ligadas (`unattended-upgrades`);
   - ligue a 2FA no painel da Hostinger;
   - ligue os snapshots da VPS.
6. Uma pessoa sai da equipe: desative o usuário dela e use "Derrubar todos os acessos" se ela era administradora.
7. Suspeita de invasão:
   - derrube todos os acessos;
   - troque as senhas;
   - confira o registro de acessos;
   - restaure o backup se algo foi apagado;
   - faça um boletim de ocorrência.

   Se dados pessoais de clientes vazaram, a LGPD manda avisar a ANPD e os titulares (Resolução CD/ANPD nº 15/2024).

## 3. Próximos passos (ferramentas abertas do GitHub)

Estas ferramentas complementam o radar de cibersegurança. Antes de adotar, confira a versão, a origem e os avisos de segurança: um repositório popular também pode ser comprometido, como aconteceu com o Trivy em março de 2026.

| Ferramenta | Para quê | Quando |
| --- | --- | --- |
| [Cloudflare](https://www.cloudflare.com/) (DNS + proxy, plano grátis) | Esconder o IP da VPS, bloquear ataques e robôs, limitar requisições. | Ao publicar na VPS. |
| [Tailscale](https://github.com/tailscale/tailscale) ou [Headscale](https://github.com/juanfont/headscale) | Deixar o painel administrativo e o SSH visíveis só para aparelhos da equipe, fora da internet aberta. | Quando houver mais administradores. |
| [CrowdSec](https://github.com/crowdsecurity/crowdsec) ou [Fail2ban](https://github.com/fail2ban/fail2ban) | Banir automaticamente IPs que forçam login no SSH ou no site. | Na VPS. |
| [Gitleaks](https://github.com/gitleaks/gitleaks) / [Betterleaks](https://github.com/betterleaks/betterleaks) | Impedir que uma senha ou token vá para o GitHub. | No fluxo de commits. |
| [OSV-Scanner](https://github.com/google/osv-scanner) e Dependabot | Avisar de bibliotecas com falha conhecida. | Contínuo, no GitHub. |
| [Semgrep CE](https://github.com/semgrep/semgrep) | Achar padrões de código inseguro. | A cada mudança grande. |
| [ZAP](https://github.com/zaproxy/zaproxy) | Testar o painel rodando, como um invasor faria. | Antes de cada versão grande, em ambiente de teste. |
| [restic](https://github.com/restic/restic) ou [Borg](https://github.com/borgbackup/borg) | Backup da VPS inteira para fora (outro provedor), com retenção. | Na VPS. |
| [Wazuh](https://github.com/wazuh/wazuh) | Monitorar logs e integridade dos servidores. | Quando houver vários servidores. |
| [Keycloak](https://github.com/keycloak/keycloak) / [Authentik](https://github.com/goauthentik/authentik) | Login único com chave de acesso (passkey) para várias plataformas da Migra. | Quando houver CRM, site e outros sistemas juntos. |
| [OWASP ASVS](https://github.com/OWASP/ASVS) | Lista de requisitos para conferir cada sistema novo. | Em todo projeto novo. |

## 4. Regras para todo sistema novo da Migra

- Login com 2FA, limite de tentativas e registro de acessos desde o primeiro dia.
- Cada usuário vê só o que é dele: a regra fica no servidor, não só na tela.
- Segredos fora do código (arquivo `.env` ou cofre) e fora do Git.
- Backup automático criptografado, com cópia fora e restauração testada.
- Dados guardados só quando necessários (LGPD). Documentos de clientes nunca ficam com link público permanente.
- Dependências atualizadas e verificadas, testes automáticos e revisão de cada mudança antes de publicar.
