<?php
declare(strict_types=1);

final class ReferralRules
{
    public static function channel(string $channel): string
    {
        $channel = strtolower(trim($channel));
        return in_array($channel, ['whatsapp', 'instagram', 'outros'], true)
            ? $channel : 'desconhecido';
    }

    /** Número completo com DDI +55, DDD e 9 dígitos de celular. OTP é obrigatório externamente. */
    public static function normalizeBrazilianMobile(string $raw): string
    {
        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        if (strlen($digits) === 11) {
            $digits = '55' . $digits;
        }
        if (!preg_match('/^55[1-9][0-9]{10}$/', $digits)) {
            throw new InvalidArgumentException('Número de WhatsApp inválido');
        }
        return '+' . $digits;
    }

    /** Os hashes exigem chave estável privada fora do repositório. */
    public static function digest(string $namespace, string $input, string $pepper): string
    {
        if (strlen($pepper) < 32) {
            throw new RuntimeException('Configure uma chave HMAC secreta com ao menos 32 bytes');
        }
        return hash_hmac('sha256', $namespace . ':' . $input, $pepper, true);
    }

    public static function commissionCents(int $grossCents, int $basisPoints): int
    {
        if ($grossCents < 0 || $basisPoints < 0 || $basisPoints > 10000) {
            throw new InvalidArgumentException('Valor ou percentual inválido');
        }
        if ($grossCents > intdiv(PHP_INT_MAX - 5000, max(1, $basisPoints))) {
            throw new OverflowException('Valor excede o intervalo calculável');
        }
        // 5% = 500 pontos-base. Arredondamento para centavo mais próximo.
        return intdiv($grossCents * $basisPoints + 5000, 10000);
    }

    public static function channelLabel(string $channel): string
    {
        return match ($channel) {
            'whatsapp' => 'WhatsApp',
            'instagram' => 'Instagram',
            'outros' => 'Outros',
            default => 'Desconhecido',
        };
    }
    /**
     * Apenas o indicador direto da conta COMPRADORA pode receber.
     * A conta pode, simultaneamente, ser embaixadora de outras pessoas.
     * A origem da compra (dinheiro ou créditos) não muda seu beneficiário.
     * Não consultar avós, genealogia ou qualquer indicação indireta.
     */
    public static function directPurchase(int $buyerId, ?int $directAmbassadorId, int $totalCents, int $commissionBps): array
    {
        if ($buyerId < 1 || ($directAmbassadorId !== null && $directAmbassadorId < 1)) {
            throw new InvalidArgumentException('IDs inválidos');
        }
        if ($directAmbassadorId === null || $directAmbassadorId === $buyerId) {
            return ['beneficiary_id' => null, 'commission_cents' => 0];
        }
        return [
            'beneficiary_id' => $directAmbassadorId,
            'commission_cents' => self::commissionCents($totalCents, $commissionBps),
        ];
    }

}
