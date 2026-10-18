<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/Rules.php';

function eq(mixed $actual, mixed $expected, string $why): void
{
    if ($actual !== $expected) {
        fwrite(STDERR, "FALHA: $why. Obtido: " . var_export($actual, true) . "\n");
        exit(1);
    }
}
function reject(callable $callback, string $why): void
{
    try { $callback(); } catch (InvalidArgumentException|RuntimeException|OverflowException $ok) { return; }
    fwrite(STDERR, "FALHA: deveria rejeitar $why\n");
    exit(1);
}
eq(ReferralRules::channel(' INSTAGRAM '), 'instagram', 'canal normalizado');
eq(ReferralRules::channel('facebook'), 'desconhecido', 'canal não suportado');
eq(ReferralRules::normalizeBrazilianMobile('(69) 99999-9999'), '+5569999999999', 'mobile brasileiro');
eq(ReferralRules::normalizeBrazilianMobile('+55 69 99999-9999'), '+5569999999999', 'mobile com DDI');
reject(fn()=>ReferralRules::normalizeBrazilianMobile('123'), 'telefone inválido');
eq(ReferralRules::commissionCents(2000, 500), 100, '5% de R$20');
eq(ReferralRules::commissionCents(1000, 500), 50, 'recompra R$10 em créditos');
eq(ReferralRules::commissionCents(1, 500), 0, 'arredondamento inferior a centavo');
eq(ReferralRules::commissionCents(10, 500), 1, 'arredondamento meio centavo');
eq(ReferralRules::commissionCents(20000, 0), 0, 'percentual zero');
reject(fn()=>ReferralRules::commissionCents(100, 10001), 'percentual acima de 100%');
reject(fn()=>ReferralRules::commissionCents(-1, 500), 'valor negativo');
reject(fn()=>ReferralRules::commissionCents(PHP_INT_MAX, 500), 'overflow');
$secret = str_repeat('s', 36);
$a = ReferralRules::digest('whatsapp', '+5569999999999', $secret);
$b = ReferralRules::digest('whatsapp', '+5569999999999', $secret);
$c = ReferralRules::digest('visit', '+5569999999999', $secret);
eq(strlen($a), 32, 'digest HMAC binário');
eq($a, $b, 'unificação de identidade entre navegadores');
if ($a === $c) { exit(1); }
reject(fn()=>ReferralRules::digest('whatsapp', '123', 'segredo-fraco'), 'pepper fraco');
eq(ReferralRules::directPurchase(3, 2, 10000, 500), ['beneficiary_id' => 2, 'commission_cents' => 500], 'Carlos paga Maria, não João');
eq(ReferralRules::directPurchase(2, 1, 500, 500), ['beneficiary_id' => 1, 'commission_cents' => 25], 'Maria embaixadora recompra com créditos e remunera João');
eq(ReferralRules::directPurchase(2, 1, 2000, 500), ['beneficiary_id' => 1, 'commission_cents' => 100], 'Maria paga em dinheiro e remunera João igualmente');
eq(ReferralRules::directPurchase(2, null, 500, 500), ['beneficiary_id' => null, 'commission_cents' => 0], 'sem padrinho não tem comissão');
eq(ReferralRules::directPurchase(2, 2, 500, 500), ['beneficiary_id' => null, 'commission_cents' => 0], 'não existe auto-comissão');
echo "OK — 21 verificações básicas de regras. Integração com MySQL/OTP/webhooks requer homologação.\n";
