# Plano de QA, segurança e aceitação

## Estado da execução

**Feito via conector GitHub:** leitura de README do projeto, verificação de ausência de `package.json` na raiz, leitura das referências PR FS Brasil #17/Pattern Kit, escrita apenas na branch isolada; após commits, conferir arquivos e diff da branch.

**Não executado neste estágio:** teste em navegador real; medição de Core Web Vitals; leitores de tela; teste de Copilot carregando agentes; hospedagem de preview; revisão jurídica de promoções; acesso à aplicação real ou ao ambiente Hostinger. Não apresentar nenhum destes como aprovado.

## Checklist para executar no navegador

- [ ] `index.html` abre localmente sem dependências.
- [ ] Botões alternam Bento/Cinematográfica e atualizam `aria-pressed`.
- [ ] Variante não selecionada não participa do fluxo de tabulação.
- [ ] CTA "Conhecer o conceito" leva à seção correta, em cada variante.
- [ ] Botões de pré-cadastro exibem aviso, sem requisições de rede.
- [ ] FAQ abre e fecha com teclado.
- [ ] `Tab`, `Shift+Tab`, `Enter`, `Espaço`, `Escape` nos controles pertinentes.
- [ ] Não há overflow horizontal em 320, 360, 390, 768, 1024, 1440 px.
- [ ] Texto e elementos interativos têm contraste suficiente (medir WCAG).
- [ ] `prefers-reduced-motion: reduce` suprime animações/transições.
- [ ] Sem requisições a APIs, sem localStorage/cookies e sem envio de dados.
- [ ] Títulos, ordem de headings e foco são compreensíveis em leitor de tela.
- [ ] Logo permanece placeholder até receber arquivo original; não afirmar marca homologada.
- [ ] Todos os dados de categorias são rotulados demonstrativos.
- [ ] `noindex` presente; publicação permanece proibida sem aprovação.

## Achados e riscos conhecidos

| Severidade | Item | Tratamento |
|---|---|---|
| Bloqueador | Código e URL do site publicado não identificados | Confirmar origem antes de integrar |
| Bloqueador | Logo original indisponível | Reservar espaço, solicitar asset |
| Bloqueador | Regulação de promoções e regras de participação não revisadas | Sem premiações, valores, cotas, checkout ou promessas |
| Bloqueador | Nenhum backend ou privacidade de cadastro definido | Nenhuma coleta de dados no teste |
| Médio | Ilustração cinematográfica é substituta abstrata | Trocar somente por mídia real autorizada |
| Médio | QA visual/teclado/performance ainda não executado | Revisão posterior em ambiente de teste |
| Médio | Agentes em markdown não equivalem a agentes executados | Validar ambiente compatível e registrar logs de execução |

## Condições para aprovar uma próxima etapa

- Evidências dos testes com falhas documentadas e corrigidas.
- Aprovação explícita da direção visual e da logo.
- Origem verificada do código funcional e definição de ambiente preview.
- Validação do modelo promocional e de privacidade antes de qualquer cadastro real.
- Sem merge, DNS, deploy, alteração de banco ou pagamentos como efeito deste PR.
