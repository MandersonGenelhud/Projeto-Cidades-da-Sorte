# Migra Devocional → Migra Hub (contagem de usuários)

O aplicativo Migra Devocional avisa o Migra Hub a cada cadastro novo. O Hub mostra o total, os novos por dia e os últimos cadastros (com e-mail e telefone mascarados) em **Outras empresas → Migra Devocional**.

## 1. Gerar a chave (no painel)
Outras empresas → Migra Devocional → "Ligar o aplicativo ao Migra Hub" → **Gerar chave**. Ela aparece uma vez só. Quem cuida do aplicativo guarda a chave como segredo ou variável de ambiente, por exemplo `MIGRA_HUB_KEY`. Nunca mande a chave por conversa ou e-mail. Se ela vazar, clique em "Trocar a chave".

## 2. Enviar cada cadastro (no aplicativo, do lado do servidor)
```
POST https://ENDERECO-DO-HUB/api/integrations/devocional/users
Authorization: Bearer <MIGRA_HUB_KEY>
Content-Type: application/json

{"id":"id-do-usuario-no-app","name":"Nome","email":"pessoa@exemplo.com","phone":"+5545999990000","plan":"gratuito","createdAt":"2026-11-05T10:00:00Z"}
```
- Precisa de pelo menos um entre `id`, `email` ou `phone`. Mandar o mesmo `id` de novo atualiza em vez de duplicar.
- Usuário que saiu do app: mande `{"id":"...","deleted":true}`.
- Cadastros antigos de uma vez: `{"users":[{...},{...}]}`, até 500 por envio.
- Resposta: `{"added":1,"updated":0,"skipped":0,"total":123}`.

Faça a chamada do lado do servidor do aplicativo (função de backend, Edge Function, webhook). Nunca coloque a chave no código que roda no celular ou no navegador do usuário.
