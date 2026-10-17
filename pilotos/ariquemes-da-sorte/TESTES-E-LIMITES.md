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
- [ ] Nenhuma chamada a APIs, sem localStorage/cookies e sem envio de dados; **confirmar que a única requisição externa prevista no HTML é a imagem pública da logo oficial**.
- [ ] Títulos, ordem de headings e foco são compreensíveis em leitor de tela.
- [ ] Logo oficial carregada do domínio e texto alternativo correto; obter arquivo local antes de qualquer deploy para reduzir dependência de produção.
- [ ] Todos os dados de categorias são rotulados demonstrativos.
- [ ] `noindex` presente; publicação permanece proibida sem aprovação.

## Achados e riscos conhecidos

| Severidade | Item | Tratamento |
|---|---|---|
| Bloqueador | Domínio oficial identificado, mas diretório-fonte e backend não localizados | Confirmar origem antes de integrar |
| Médio | Logo oficial acessível por URL, mas não incorporada localmente | Obter arquivo autorizado, manter fallback e validar dimensões |
| Bloqueador | Regulação de promoções e regras de participação não revisadas | Sem premiações, valores, cotas, checkout ou promessas |
| Bloqueador | Site oficial contém cadastro real; destino do POST e política não auditados | Nenhuma coleta ou integração no laboratório; examinar política/dados separadamente |
| Médio | Ilustração cinematográfica é substituta abstrata | Trocar somente por mídia real autorizada |
| Médio | QA visual/teclado/performance ainda não executado | Revisão posterior em ambiente de teste |
| Médio | Agentes em markdown não equivalem a agentes executados | Validar ambiente compatível e registrar logs de execução |

## Condições para aprovar uma próxima etapa

- Evidências dos testes com falhas documentadas e corrigidas.
- Aprovação explícita da direção visual e da logo.
- Origem verificada do código funcional e definição de ambiente preview.
- Validação do modelo promocional e de privacidade antes de qualquer cadastro real.
- Sem merge, DNS, deploy, alteração de banco ou pagamentos como efeito deste PR.
