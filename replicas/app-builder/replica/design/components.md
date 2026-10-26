# Design system do app-builder

## Direção

**Assunto:** uma bancada onde uma pessoa sem conhecimento técnico descreve um app em
português e vê ele sendo montado. Uso longo, com atenção dividida entre a conversa e
o resultado.

**Princípios**
1. **O app gerado é o protagonista.** A interface ao redor é calma: cinza-esverdeado,
   sem gradiente e sem sombra em painel parado. Sombra só no que flutua (menus, modais, toasts).
2. **Um único momento ousado:** o estado "trabalhando". Quando o agente constrói, uma
   linha âmbar percorre o topo do preview e cada arquivo escrito aparece como uma etiqueta
   no chat. É a única animação que não responde a um clique.
3. **Cor carrega significado.** Petróleo (`accent`) é ação e seleção. Âmbar (`working`)
   é só "o agente está trabalhando". Vermelho e verde são erro e sucesso. Nenhuma cor é decoração.
4. **Palavras simples.** "Publicar", não "deploy". "Versão", não "commit". A mesma ação tem
   o mesmo nome do botão ao aviso ("Publicar" → "Publicado").

**O que evitamos de propósito:** a cara do Emergent; fundo creme com terracota; preto com
verde-limão; kit de cartões iguais com a mesma sombra; rótulos em CAIXA ALTA; "→" no fim de botões.

**Tipografia:** Onest (licença OFL, Google Fonts) para toda a interface: legível em
tamanho pequeno, acentos do português bem desenhados, menos genérica que Inter.
JetBrains Mono (OFL) só onde o conteúdo é código: caminhos de arquivo e o visualizador de código.

**Ícones:** Lucide (ISC), traço de 1,5 px, 16 e 20 px.

**Tokens:** `tokens.json` (claro) e `tokens.dark.json` (escuro) → `python3 build_tokens.py`
gera `tokens.css` (tema do Tailwind v4) e `tokens.plain.css`. Contraste checado com
`contrast.py`: 0 falhas AA nos dois temas.

## Layout

```
┌──────────┬──────────────────────┬──────────────────────────────────┐
│ sidebar  │ chat (440, arrasta)  │ preview / código                  │
│ 264      │                      │ ┌ barra: Preview | Código   ↗  ⟳ ┐│
│ + Novo   │ mensagens            │ │                                ││
│ jobs     │                      │ │   iframe do app gerado         ││
│          │                      │ │                                ││
│ créditos │ [composer]           │ └────────────────────────────────┘│
└──────────┴──────────────────────┴──────────────────────────────────┘
```
Abaixo de 1100 px a sidebar vira gaveta. Abaixo de 768 px chat e preview viram abas.
Tudo alinhado à esquerda; só a home centraliza o composer.

## Componentes

```
Button
  variants  primary (accent), secondary (surface + border), ghost, danger
  sizes     sm 32px, md 40px
  states    default, hover (fundo 6% mais escuro), active, focus-visible (anel 2px accent, offset 2px), disabled (50%), loading (spinner no lugar do ícone, texto mantido)
  tokens    radius md, text sm/600
  a11y      <button> de verdade; loading usa aria-busy
  used on   todas
```

```
Composer
  variants  hero (home: 3 linhas mín., fundo surface, raio lg), dock (chat: 1–8 linhas, cresce)
  parts     textarea, anexar (clipe), chave de modo, enviar
  states    vazio (enviar desabilitado), digitando, enviando, bloqueado (sem créditos: texto explica e oferece recarregar), arrastando arquivo (borda accent tracejada)
  keys      Enter envia, Shift+Enter quebra linha
  a11y      textarea com label "Descreva o seu app"; anexos listados com botão de remover
  used on   S02, S04
```

```
ModeToggle
  variants  Construir | Planejar
  states    selecionado (fundo surface, texto text), não selecionado (texto muted), focus-visible
  a11y      radiogroup com setas do teclado
  used on   S02, S04
```

```
AppTypePicker
  variants  App completo, Página de apresentação, Conversar a ideia, Site de sorteio (template)
  states    selecionado (borda accent + accent-soft), hover, focus
  a11y      radiogroup
  used on   S02
```

```
ChatMessage
  variants  user (alinhado à direita, surface-2), agent (sem balão, texto direto), step (linha compacta: ícone + "Escreveu index.html" em mono), error (danger-soft + ação "Tentar de novo")
  states    streaming (cursor piscando no fim), concluída
  a11y      lista com role="log" aria-live="polite" para os passos
  used on   S04
```

```
FileChip
  variants  criado (+), editado (lápis), apagado (risco)
  tokens    mono xs, surface-2, radius sm
  used on   S04 (dentro de step), S06
```

```
PreviewFrame
  parts     barra (abas Preview | Código, endereço, abrir em nova aba, recarregar, desktop/celular), iframe sandbox
  states    vazio ("O seu app aparece aqui"), carregando, trabalhando (linha âmbar no topo), pronto, erro (mensagem + "Pedir para o agente corrigir")
  used on   S05
```

```
JobListItem
  parts     título, status, tempo relativo, menu (renomear, duplicar, apagar)
  states    ativo (accent-soft), hover, trabalhando (ponto âmbar), erro (ponto vermelho), menu aberto
  a11y      link; menu por botão com aria-haspopup
  used on   S02, S12
```

```
StatusBadge
  variants  Pronto (success), Trabalhando (working, ponto pulsando), Erro (danger), Publicado (accent), Rascunho (muted)
  tokens    xs/500, pill, fundo *-soft
  used on   S03, S09, S12
```

```
CreditMeter
  parts     saldo, barra fina, "Recarregar"
  states    normal, baixo (< 10%: working), zerado (danger + composer bloqueado)
  used on   sidebar
```

```
Modal
  variants  publicar, confirmar exclusão
  states    aberto, enviando, erro
  a11y      <dialog>, foco preso, Esc fecha, foco volta ao botão de origem
  tokens    surface, radius lg, shadow pop
  used on   S09, S12
```

```
Toast
  variants  sucesso, erro
  behavior  4 s, pausa no hover, um de cada vez
  a11y      role="status" (sucesso) / role="alert" (erro)
```

```
Input / Select
  sizes     md 40px
  states    default (border-input), focus (anel accent), erro (borda danger + mensagem abaixo), disabled
  a11y      <label> sempre visível; erro ligado por aria-describedby
```

## Textos-base (voz: direto, gentil, sem jargão)

| lugar | texto |
| --- | --- |
| home, título | O que você quer criar hoje? |
| composer, placeholder | Ex.: um site de sorteio para Campinas com cadastro de participantes e contagem regressiva |
| botão enviar | Criar app |
| modo | Construir / Planejar |
| preview vazio | O seu app aparece aqui assim que o agente terminar a primeira versão. |
| trabalhando | Montando o seu app… |
| erro do agente | A última etapa falhou e o app não foi alterado. |
| publicar | Publicar → aviso "Publicado em sorteio-campinas.<domínio>" |
| sem créditos | Seus créditos acabaram. O app fica salvo; recarregue para continuar. |
