# Ariquemes da Sorte — pré-cadastro cinematográfico em homologação local

Versão de 19/10/2026. A composição escolhida foi conectada a uma API PHP e a um banco SQLite exclusivamente local. Este pacote não é uma atualização pronta para a hospedagem de produção.

## Entregue e verificado
- Interface cinematográfica, logo e paleta preservadas.
- Gravação de teste confirmada pelo servidor antes de mostrar o retorno.
- Mesmo telefone não cria outro cadastro, não altera o registro anterior e recebe a mesma resposta pública. Nenhum número de fundador ou código de convite é retornado.
- Sessão, CSRF, consultas parametrizadas, limite de corpo e validação no servidor.
- Numeração interna por sequência transacional; falhas revertem a gravação parcial.
- Limite local de cinco tentativas válidas por IP a cada janela fixa de 15 minutos, incluindo duplicatas. Não é uma proteção de produção completa.
- Recuperação de falha de rede, preservação dos campos e indicação acessível de erros.

O aceite de teste NÃO autoriza WhatsApp. Todos os registros de teste têm consent_whatsapp=0. Nenhuma mensagem, cobrança ou sorteio é executado.

## Executar em ambiente local
Requisitos: PHP com PDO SQLite e mbstring; Python 3 para os testes. A execução desta entrega foi verificada em PHP 8.5.10 via PHP-WASM e Chromium 153; PHP/MySQL nativos da Hostinger não foram testados.

A partir desta pasta:

```bash
ADS_LAB_ONLY=1 php init.php
ADS_LAB_ONLY=1 php -S 127.0.0.1:8766 -t public
```

Abra http://127.0.0.1:8766/. Use somente dados fictícios. Abra pelo servidor, não diretamente pelo arquivo HTML. O diretório public é a única raiz pública; data e src devem permanecer fora dela. init.php não apaga um banco existente. O banco e a chave são gerados localmente e não acompanham o ZIP.

## Verificar

```bash
python tests/run_checks.py
```

O executor cria cópias temporárias vazias e não reinicializa um banco existente. Para usar outro executável PHP, defina PHP_BIN. Para incluir os testes de navegador, instale Playwright e Chromium e defina ADS_BROWSER_CHECKS=1, PLAYWRIGHT_MODULE (opcional) e CHROMIUM_PATH. Os testes HTTP usam a porta local 8766, que deve estar livre.

## Antes de conectar a hospedagem
1. Confirmar a versão real do PHP/backend e o esquema MySQL em uma homologação separada, com backup e migração reversível. Nada deste pacote foi aplicado à produção.
2. Adaptar e migrar a sequência sem reutilizar números existentes, testar transações e inscrições simultâneas no MySQL. A sequência atual começa em zero porque o banco de teste é vazio.
3. Definir aceite real, finalidade dos dados, retenção e cancelamento; validar titularidade antes de permitir consulta de número de fundador ou convite.
4. Integrar indicação e UTM do legado: ainda não transportados por esta interface.
5. Configurar HTTPS, sessões seguras, limites distribuídos, limpeza dos registros de limitação, monitoramento e política de backup. Remover dados e textos fictícios somente na versão autorizada para produção.
6. Executar validação ponta a ponta da hospedagem e revisão visual final antes de substituir qualquer página pública.

A presença de validações não representa garantia de inviolabilidade. Não há verificação de posse do telefone nesta homologação; por isso ela não oferece consulta ou recuperação de cadastro.

## Preparação MySQL e preservação no GitHub
Consulte `mysql/README.md`. A suíte local ganhou 11 verificações de isolamento (54 no total ao incluir navegador). Os testes nativos de migração/concorrência são separados e precisam ser executados em MySQL/MariaDB efêmeros; configuração não representa aprovação da hospedagem.
