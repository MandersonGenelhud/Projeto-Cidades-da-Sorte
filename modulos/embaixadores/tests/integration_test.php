<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/ReferralService.php';

// TESTE ISOLADO: MariaDB/MySQL descartável da CI. Nunca apontar ao banco real.
// O schema é criado pelo workflow antes de executar este teste.
$pdo = new PDO(
    getenv('ADS_TEST_DSN') ?: 'mysql:host=127.0.0.1;port=3306;dbname=ariquemes_test;charset=utf8mb4',
    getenv('ADS_TEST_USER') ?: 'root',
    getenv('ADS_TEST_PASSWORD') ?: 'senha-apenas-local',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
);
$service = new ReferralService($pdo, str_repeat('k', 40));
function check(bool $ok, string $why): void {
    if (!$ok) { throw new RuntimeException('Falhou: ' . $why); }
}
function phone(int $i): string { return sprintf('(69) 9%08d', $i); }
function token(int $i): string { return str_repeat('v', 40) . $i; }

$john = $service->registerVerifiedPerson(phone(1), 'Joao', null);
check($john['new_signup'] && !$john['counted_referral'], 'João cadastrado sem padrinho');
$johnId = $john['person_id'];
check($service->recordFirstTouch(token(1), $john['code'], 'whatsapp'), 'convite de João rastreado');
$maria = $service->registerVerifiedPerson(phone(2), 'Maria', token(1));
check($maria['new_signup'] && $maria['counted_referral'], 'Maria indicada por João');
$mariaId = $maria['person_id'];
$dup = $service->registerVerifiedPerson(phone(2), 'Maria em outro navegador', token(999));
check(!$dup['new_signup'] && !$dup['counted_referral'] && $dup['person_id'] === $mariaId, 'bloqueia cadastro duplicado');

check($service->recordFirstTouch(token(3), $maria['code'], 'instagram'), 'convite de Maria');
$carlos = $service->registerVerifiedPerson(phone(3), 'Carlos', token(3));
check($carlos['counted_referral'], 'Carlos indicado por Maria');
$carlosId = $carlos['person_id'];

$pdo->exec("INSERT INTO ads_campaigns(campaign_key, commission_bps, commission_budget_cents, enabled, legal_approved)
    VALUES ('campanha-demo', 500, 100000, 1, 1)");
$cash = $service->createPendingOrder('demo-carlos', $carlosId, 'campanha-demo', 10000, 0);
check($cash['commission_cents'] === 500, 'Carlos comprou com dinheiro: Maria ganha 5 reais');
check($service->walletSummary($mariaId)['available_for_purchase_cents'] === 0, 'comissão pendente não é saldo');
$service->confirmPaidOrder('demo-carlos');
check($service->walletSummary($mariaId)['available_for_purchase_cents'] === 500, 'crédito confirmado de Maria');

check((int)$service->dashboard($johnId)['paid_sales']['commission_cents'] === 0, 'João não recebe sobre compra do neto Carlos');
check((int)$service->dashboard($mariaId)['paid_sales']['commission_cents'] === 500, 'Maria recebe por Carlos');

$credit = $service->createPendingOrder('demo-maria', $mariaId, 'campanha-demo', 0, 500);
check($credit['commission_cents'] === 25, 'Maria compra com comissão e João ganha 25 centavos');
check($service->walletSummary($mariaId)['available_for_purchase_cents'] === 0, 'crédito reservado não pode ser usado duas vezes');
try {
    $service->createPendingOrder('demo-maria-outro', $mariaId, 'campanha-demo', 0, 500);
    throw new RuntimeException('Aceitou o mesmo crédito duas vezes');
} catch (DomainException $expected) {
    check($expected->getMessage() === 'Crédito de comissão insuficiente', 'bloqueio de gasto duplicado');
}

$service->confirmPaidOrder('demo-maria');
$service->confirmPaidOrder('demo-maria'); // webhook duplicado, idempotente
check($service->walletSummary($mariaId)['confirmed_balance_cents'] === 0, 'saldo da compra de Maria consumido');
check($service->walletSummary($johnId)['available_for_purchase_cents'] === 25, 'João recebeu comissão direta por compra com créditos de Maria');
check((int)$service->dashboard($johnId)['paid_sales']['commission_cents'] === 25, 'João recebe 25 centavos uma única vez');
check((int)$service->dashboard($mariaId)['paid_sales']['commission_cents'] === 500, 'Maria não ganhou auto-comissão');

$refunded = $service->walletSummary($mariaId);
$service->reverseOrder('demo-carlos', true);
check($service->walletSummary($mariaId)['confirmed_balance_cents'] === -500, 'estorno de Carlos cria débito de Maria porque crédito foi gasto');
check($service->walletSummary($mariaId)['available_for_purchase_cents'] === 0, 'não reutiliza débito da carteira');
check($service->walletSummary($johnId)['available_for_purchase_cents'] === 25, 'compra já realizada por Maria permanece válida até ser estornada');
$service->reverseOrder('demo-maria', true);
$service->reverseOrder('demo-maria', true); // idempotente
check($service->walletSummary($mariaId)['confirmed_balance_cents'] === 0, 'restituição dos créditos da Maria após estorno');
check($service->walletSummary($johnId)['confirmed_balance_cents'] === 0, 'comissão de João estornada');

$service->releaseDirectReferral($johnId, $mariaId);
$afterRelease = $service->createPendingOrder('demo-maria-livre', $mariaId, 'campanha-demo', 2000, 0);
check($afterRelease['commission_cents'] === 0, 'compra após liberação não remunera João');
$service->confirmPaidOrder('demo-maria-livre');
check($service->walletSummary($johnId)['available_for_purchase_cents'] === 0, 'João sem ganhos novos após liberação');
echo "OK — integração: um nível, fundador->embaixador, reinvestimento, dupla compra, estorno e liberação\n";
