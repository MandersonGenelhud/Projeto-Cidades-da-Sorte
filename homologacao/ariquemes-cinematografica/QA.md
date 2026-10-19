# Evidências — 19/10/2026

Execução: tests/run_checks.py com PHP-WASM 8.5.10, PDO SQLite e Chromium 153, em cópias temporárias vazias. Nenhum acesso ao banco real ou publicação.

| Camada | Resultado | Alcance |
|---|---|---|
| Serviço PHP | 19 verificações aprovadas | Cadastro, normalização, duplicata, privacidade, CSRF, validação, sequência, limitação, transação/rollback e erro genérico |
| HTTP | 18 verificações aprovadas | API real em loopback, sessão, CSRF, cabeçalhos, método, JSON, tamanho, host, duplicata e limitação |
| Navegador | 6 verificações aprovadas | Envio real local, duplicata, erro de campo, larguras 320/390/768/1440, ausência de erro JS e falha de rede |

Total: 43 verificações. A checagem de largura não substitui uma auditoria visual completa. Os testes de sequência são sequenciais e não comprovam comportamento concorrente no MySQL. Testes do ambiente Hostinger, consentimento de produção e verificação de titularidade permanecem pendentes.

O teste HTTP revelou que o gerenciador de sessões sobrescrevia Cache-Control; o limitador de cache da sessão foi desativado e o cabeçalho explícito no-store foi verificado novamente. O host IPv6 externo também foi incluído nos casos de rejeição.

## Preparação MySQL adicionada nesta etapa
Mais 11 verificações locais de isolamento aprovadas (modo obrigatório, loopback, nome de banco reservado, validação de porta, DSN e credenciais). Total local atual: 54 verificações com a suíte de navegador incluída.

O workflow preparado executa PHP 8.2 com dois bancos efêmeros (MySQL 8.0 e MariaDB 10.11). A aprovação nativa só deve ser afirmada após consultar o resultado dessa execução no GitHub. A interface HTTP permanece conectada exclusivamente ao SQLite local.
