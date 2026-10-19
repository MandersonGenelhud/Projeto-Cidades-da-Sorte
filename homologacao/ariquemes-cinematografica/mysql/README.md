# Preparação MySQL — homologação exclusiva

Não há conexão HTTP com MySQL neste pacote. A página continua usando SQLite local; estes arquivos validam o serviço e a migração com MySQL/MariaDB em testes CLI/CI. Nenhum segredo, DSN de produção ou credencial da Hostinger acompanha a entrega.

## Escopo
- `001_support.sql` adiciona duas tabelas auxiliares e inicia a sequência a partir da maior numeração já existente, sem reduzir uma sequência previamente reservada.
- As tabelas e cadastros legados não são apagados. A fixture em `tests/mysql_fixture.sql` representa somente o esquema mínimo necessário ao teste.
- `Settings.php` só aceita execução explícita, host loopback e banco com nome `ads_hml_*`. Essa restrição não deve ser removida para “fazer funcionar” na hospedagem.
- A suíte aborta se o banco de teste já tiver qualquer tabela; não existe rotina automática de apagar/restaurar dados.

## Testar nativamente
Em um servidor MySQL/MariaDB efêmero local, com banco vazio `ads_hml_ci` e usuário restrito a esse banco, configure em variáveis de ambiente: `ADS_MYSQL_HOMOLOGATION=1`, `ADS_MYSQL_HOST=127.0.0.1`, `ADS_MYSQL_PORT`, `ADS_MYSQL_DATABASE`, `ADS_MYSQL_USER` e `ADS_MYSQL_PASSWORD`. Não use credenciais ou banco da produção. Execute:

```bash
php tests/mysql_safety.php
php tests/mysql_suite.php
```

A suíte exercita migração idempotente, faixa de fundador, 20 inscrições simultâneas, 12 tentativas simultâneas para o mesmo telefone, rollback e ausência de autorização de contato. Dados fictícios são gerados exclusivamente dentro desse banco. Workers exigem `proc_open`; não são requisições à produção.

## Próximo marco da hospedagem
Mesmo depois da aprovação em CI, conferir o esquema e a versão reais da Hostinger. O SQL exige InnoDB e índices únicos em telefone/número. Parar inscrições na homologação durante migração; MySQL tem commit implícito em DDL. Reversão do código deve preservar as tabelas e a sequência adicionadas; não retomar o alocador legado MAX()+1. Não existe downgrade destrutivo automático.

Antes de qualquer ativação real: backend específico para a hospedagem, HTTPS/sessões, consentimento e cancelamento, verificação de posse para acesso ao cadastro, indicação/UTM, manutenção dos limites e validação ponta a ponta. Nenhum desses passos é substituído pelos testes CLI.

Referência técnica consultada: manual oficial InnoDB (locks e contadores) https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html
