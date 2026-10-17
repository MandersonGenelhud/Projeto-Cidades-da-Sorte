<?php
declare(strict_types=1);

require_once __DIR__ . '/Rules.php';

/**
 * Serviço de domínio para ser usado DENTRO do backend autenticado.
 * NÃO há endpoint HTTP público, OTP de demonstração ou recebimento direto de
 * eventos de pagamento. O chamador DEVE autenticar, verificar telefone,
 * validar assinatura do gateway e proteger requisições contra CSRF/IDOR.
 */
final class ReferralService
{
    public function __construct(private PDO $pdo, private string $secret)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        if (strlen($secret) < 32) {
            throw new RuntimeException('HMAC pepper ausente/curto');
        }
    }

    private function transact(callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $answer = $fn();
            $this->pdo->commit();
            return $answer;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function rows(string $sql, array $args = []): array
    {
        $s = $this->pdo->prepare($sql);
        $s->execute($args);
        return $s->fetchAll(PDO::FETCH_ASSOC);
    }

    private function one(string $sql, array $args = []): ?array
    {
        return $this->rows($sql, $args)[0] ?? null;
    }

    private function run(string $sql, array $args = []): int
    {
        $s = $this->pdo->prepare($sql);
        $s->execute($args);
        return $s->rowCount();
    }

    private function audit(?int $actor, ?int $subject, string $event, array $meta = []): void
    {
        $this->run(
            'INSERT INTO ads_audit (actor_id, subject_id, event_name, metadata_json) VALUES (?,?,?,?)',
            [$actor, $subject, $event, json_encode($meta, JSON_THROW_ON_ERROR)]
        );
    }

    /**
     * Primeiro clique reconhecido por navegador. $visitorToken deve vir de
     * cookie assinado, Secure + HttpOnly, emitido pelo backend. Não é identidade.
     */
    public function recordFirstTouch(string $visitorToken, string $code, string $channel): bool
    {
        if (strlen($visitorToken) < 32 || strlen($visitorToken) > 256) {
            throw new InvalidArgumentException('Token de visita inválido');
        }
        $ref = $this->one('SELECT id FROM ads_people WHERE referral_code=?', [$code]);
        if ($ref === null) {
            return false;
        }
        $digest = ReferralRules::digest('visit', $visitorToken, $this->secret);
        return $this->run(
            'INSERT IGNORE INTO ads_touches (visitor_digest, ambassador_id, channel) VALUES (?,?,?)',
            [$digest, (int)$ref['id'], ReferralRules::channel($channel)]
        ) === 1;
    }

    /**
     * Chamar SOMENTE após confirmação real do WhatsApp pelo provedor do backend.
     * O parâmetro é uma identidade já verificada, NÃO um booleano enviado pelo cliente.
     * A conta já existente retorna sem nova indicação nem troca de padrinho.
     */
    public function registerVerifiedPerson(
        string $verifiedPhoneE164,
        string $publicAlias,
        ?string $serverVisitorToken
    ): array {
        $phone = ReferralRules::normalizeBrazilianMobile($verifiedPhoneE164);
        $hash = ReferralRules::digest('whatsapp', $phone, $this->secret);
        $alias = trim($publicAlias);
        if ($alias === '' || strlen($alias) > 160) {
            throw new InvalidArgumentException('Alias inválido');
        }
        return $this->transact(function () use ($hash, $alias, $serverVisitorToken): array {
            $known = $this->one('SELECT id, referral_code FROM ads_people WHERE phone_digest=? FOR UPDATE', [$hash]);
            if ($known !== null) {
                return ['person_id' => (int)$known['id'], 'code' => $known['referral_code'], 'new_signup' => false, 'counted_referral' => false];
            }
            $code = strtoupper(bin2hex(random_bytes(6)));
            $this->run(
                'INSERT INTO ads_people (phone_digest, public_alias, referral_code, verified_at) VALUES (?,?,?,UTC_TIMESTAMP())',
                [$hash, $alias, $code]
            );
            $personId = (int)$this->pdo->lastInsertId();
            $counted = false;
            if ($serverVisitorToken !== null && strlen($serverVisitorToken) >= 32) {
                $visitorDigest = ReferralRules::digest('visit', $serverVisitorToken, $this->secret);
                $touch = $this->one(
                    'SELECT ambassador_id, channel FROM ads_touches WHERE visitor_digest=? AND created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY',
                    [$visitorDigest]
                );
                if ($touch !== null && (int)$touch['ambassador_id'] !== $personId) {
                    $this->run(
                        'INSERT INTO ads_referrals (ambassador_id, referred_id, channel) VALUES (?,?,?)',
                        [(int)$touch['ambassador_id'], $personId, $touch['channel']]
                    );
                    $counted = true;
                    $this->audit((int)$touch['ambassador_id'], $personId, 'cadastro_indicado', ['channel' => $touch['channel']]);
                }
            }
            $this->audit($personId, $personId, 'cadastro_verificado');
            return ['person_id' => $personId, 'code' => $code, 'new_signup' => true, 'counted_referral' => $counted];
        });
    }

    /** Conta início de compartilhamento, nunca destinatários reais alcançados. */
    public function recordShareAction(int $authenticatedAmbassadorId, string $channel): void
    {
        $channel = ReferralRules::channel($channel);
        if ($channel === 'desconhecido') {
            $channel = 'outros';
        }
        // Integrador deve adicionar rate limit por usuário e janela de tempo.
        $this->run(
            'INSERT INTO ads_share_actions (ambassador_id, channel) VALUES (?,?)',
            [$authenticatedAmbassadorId, $channel]
        );
    }

    /**
     * Desvincula sem apagar cadastro, histórico, comissões, nem ordens pendentes.
     * $authenticatedAmbassadorId vem exclusivamente da sessão validada.
     */
    public function releaseDirectReferral(int $authenticatedAmbassadorId, int $referredId): void
    {
        $this->transact(function () use ($authenticatedAmbassadorId, $referredId): void {
            $changed = $this->run(
                'UPDATE ads_referrals SET ended_at=UTC_TIMESTAMP(), ended_by=? WHERE ambassador_id=? AND referred_id=? AND ended_at IS NULL',
                [$authenticatedAmbassadorId, $authenticatedAmbassadorId, $referredId]
            );
            if ($changed !== 1) {
                throw new DomainException('Este indicado não está vinculado ao seu perfil');
            }
            $this->audit($authenticatedAmbassadorId, $referredId, 'vinculo_liberado');
        });
    }

    /**
     * Novo vínculo somente após liberação e confirmação do PRÓPRIO indicado.
     * Usar ID da sessão autenticada da pessoa convidada, não ID recebido do front.
     */
    public function acceptInvitationAfterRelease(
        int $authenticatedReferredId,
        string $newAmbassadorCode,
        string $channel
    ): void {
        $this->transact(function () use ($authenticatedReferredId, $newAmbassadorCode, $channel): void {
            $person = $this->one('SELECT id FROM ads_people WHERE id=? FOR UPDATE', [$authenticatedReferredId]);
            if ($person === null) {
                throw new DomainException('Participante inválido');
            }
            $active = $this->one(
                'SELECT id FROM ads_referrals WHERE referred_id=? AND ended_at IS NULL FOR UPDATE',
                [$authenticatedReferredId]
            );
            if ($active !== null) {
                throw new DomainException('Libere o vínculo atual antes de aceitar outro convite');
            }
            $newAmbassador = $this->one('SELECT id FROM ads_people WHERE referral_code=?', [$newAmbassadorCode]);
            if ($newAmbassador === null || (int)$newAmbassador['id'] === $authenticatedReferredId) {
                throw new DomainException('Convite inválido ou autoindicação');
            }
            $this->run(
                'INSERT INTO ads_referrals (ambassador_id, referred_id, channel) VALUES (?,?,?)',
                [(int)$newAmbassador['id'], $authenticatedReferredId, ReferralRules::channel($channel)]
            );
            $this->audit($authenticatedReferredId, $authenticatedReferredId, 'novo_vinculo_aceito', ['ambassador_id' => (int)$newAmbassador['id']]);
        });
    }

    /**
     * Cria ordem pendente ANTES da cobrança, captura o indicador vigente e
     * reserva verba de comissão dentro do orçamento aprovado da campanha.
     * Somente backend de checkout autenticado pode invocar.
     */
    public function createPendingOrder(
        string $externalOrderKey, int $authenticatedBuyerId,
        string $campaignKey, int $cashCents, int $creditCents
    ): array {
        if ($externalOrderKey === '' || strlen($externalOrderKey) > 100 ||
            $cashCents < 0 || $creditCents < 0 ||
            $cashCents > PHP_INT_MAX - $creditCents || $cashCents + $creditCents === 0) {
            throw new InvalidArgumentException('Pedido ou valores inválidos');
        }
        return $this->transact(function () use (
            $externalOrderKey, $authenticatedBuyerId, $campaignKey, $cashCents, $creditCents
        ): array {
            $existing = $this->one('SELECT * FROM ads_orders WHERE external_order_key=? FOR UPDATE', [$externalOrderKey]);
            if ($existing !== null) {
                if ((int)$existing['buyer_id'] !== $authenticatedBuyerId ||
                    $existing['campaign_key'] !== $campaignKey ||
                    (int)$existing['cash_cents'] !== $cashCents ||
                    (int)$existing['credit_cents'] !== $creditCents) {
                    throw new DomainException('Chave de idempotência reutilizada com outro pedido');
                }
                return ['order_id' => (int)$existing['id'], 'state' => $existing['state'], 'commission_cents' => (int)$existing['commission_cents']];
            }
            $campaign = $this->one(
                'SELECT * FROM ads_campaigns WHERE campaign_key=? FOR UPDATE',
                [$campaignKey]
            );
            if ($campaign === null || !(bool)$campaign['enabled'] || !(bool)$campaign['legal_approved']) {
                throw new DomainException('Operação desativada. Exige aprovação regulatória e administrativa');
            }
            $buyer = $this->one('SELECT id FROM ads_people WHERE id=?', [$authenticatedBuyerId]);
            if ($buyer === null) {
                throw new DomainException('Comprador não encontrado');
            }
            $ref = $this->one(
                'SELECT id, ambassador_id FROM ads_referrals WHERE referred_id=? AND ended_at IS NULL FOR UPDATE',
                [$authenticatedBuyerId]
            );
            $gross = $cashCents + $creditCents;
            $commission = $ref === null ? 0 : ReferralRules::commissionCents($gross, (int)$campaign['commission_bps']);
            $left = (int)$campaign['commission_budget_cents'] - (int)$campaign['committed_commission_cents'];
            if ($left < $commission) {
                throw new DomainException('Orçamento de comissão insuficiente; interromper checkout antes da cobrança');
            }
            $this->run(
                'UPDATE ads_campaigns SET committed_commission_cents=committed_commission_cents+? WHERE campaign_key=?',
                [$commission, $campaignKey]
            );
            $this->run(
                'INSERT INTO ads_orders (external_order_key, buyer_id, campaign_key, cash_cents, credit_cents, total_cents, referral_id, beneficiary_id, commission_cents) VALUES (?,?,?,?,?,?,?,?,?)',
                [$externalOrderKey, $authenticatedBuyerId, $campaignKey, $cashCents, $creditCents, $gross,
                 $ref === null ? null : (int)$ref['id'], $ref === null ? null : (int)$ref['ambassador_id'], $commission]
            );
            return ['order_id' => (int)$this->pdo->lastInsertId(), 'state' => 'pending', 'commission_cents' => $commission];
        });
    }

    /** Somente após verificação de assinatura, titularidade e valor pelo gateway. */
    public function confirmPaidOrder(string $verifiedExternalOrderKey): void
    {
        $this->transact(function () use ($verifiedExternalOrderKey): void {
            $order = $this->one('SELECT id, state, buyer_id FROM ads_orders WHERE external_order_key=? FOR UPDATE', [$verifiedExternalOrderKey]);
            if ($order === null) {
                throw new DomainException('Pedido inexistente');
            }
            if ($order['state'] === 'paid') {
                return;
            }
            if ($order['state'] !== 'pending') {
                throw new DomainException('Transição de pagamento inválida');
            }
            $this->run("UPDATE ads_orders SET state='paid', paid_at=UTC_TIMESTAMP() WHERE id=?", [(int)$order['id']]);
            $this->audit(null, (int)$order['buyer_id'], 'compra_confirmada', ['order_id' => (int)$order['id']]);
        });
    }

    /**
     * Cancelamentos e reembolsos estornam a reserva. Eventual saldo já sacado
     * demanda rotina financeira externa de compensação (não implementada).
     */
    public function reverseOrder(string $verifiedExternalOrderKey, bool $providerConfirmsRefund): void
    {
        $this->transact(function () use ($verifiedExternalOrderKey, $providerConfirmsRefund): void {
            $order = $this->one('SELECT * FROM ads_orders WHERE external_order_key=? FOR UPDATE', [$verifiedExternalOrderKey]);
            if ($order === null) {
                throw new DomainException('Pedido não encontrado');
            }
            if (in_array($order['state'], ['cancelled', 'refunded'], true)) {
                return;
            }
            if ($order['state'] === 'paid' && !$providerConfirmsRefund) {
                throw new DomainException('Reembolso não confirmado pelo provedor');
            }
            $state = $order['state'] === 'paid' ? 'refunded' : 'cancelled';
            $this->run('UPDATE ads_orders SET state=? WHERE id=?', [$state, (int)$order['id']]);
            $this->run(
                'UPDATE ads_campaigns SET committed_commission_cents=committed_commission_cents-? WHERE campaign_key=?',
                [(int)$order['commission_cents'], $order['campaign_key']]
            );
            $this->audit(null, (int)$order['buyer_id'], 'pedido_revertido', ['order_id' => (int)$order['id'], 'state' => $state]);
        });
    }

    /**
     * Relatório filtrado pelo usuário autenticado; nunca retorna telefone, CPF,
     * nome completo, cookie, hash, nem detalhes pessoais de quem se cadastrou.
     */
    public function dashboard(int $authenticatedAmbassadorId): array
    {
        $ref = $this->one(
            'SELECT COUNT(*) AS total, SUM(ended_at IS NULL) AS active FROM ads_referrals WHERE ambassador_id=?',
            [$authenticatedAmbassadorId]
        ) ?? ['total' => 0, 'active' => 0];
        $sales = $this->one(
            "SELECT COUNT(*) AS purchases, COUNT(DISTINCT buyer_id) AS buyers,
             COALESCE(SUM(total_cents),0) AS gross_cents,
             COALESCE(SUM(cash_cents),0) AS fresh_cash_cents,
             COALESCE(SUM(credit_cents),0) AS reinvested_credit_cents,
             COALESCE(SUM(commission_cents),0) AS commission_cents
             FROM ads_orders WHERE beneficiary_id=? AND state='paid'",
            [$authenticatedAmbassadorId]
        );
        $channels = $this->rows(
            "SELECT r.channel, COUNT(DISTINCT r.referred_id) AS valid_signups,
                COUNT(DISTINCT IF(o.state='paid', o.buyer_id, NULL)) AS buyers,
                COALESCE(SUM(IF(o.state='paid', o.total_cents, 0)),0) AS sales_cents
             FROM ads_referrals r
             LEFT JOIN ads_orders o ON o.referral_id=r.id
             WHERE r.ambassador_id=? AND r.ended_at IS NULL
             GROUP BY r.channel ORDER BY valid_signups DESC",
            [$authenticatedAmbassadorId]
        );
        $actions = $this->one('SELECT COUNT(*) AS shares FROM ads_share_actions WHERE ambassador_id=?', [$authenticatedAmbassadorId]);
        $clicks = $this->one('SELECT COUNT(*) AS clicks FROM ads_touches WHERE ambassador_id=?', [$authenticatedAmbassadorId]);
        $people = $this->rows(
            "SELECT r.referred_id, r.channel, r.started_at,
               COUNT(IF(o.state='paid',1,NULL)) AS purchases,
               COALESCE(SUM(IF(o.state='paid',o.total_cents,0)),0) AS sales_cents
             FROM ads_referrals r LEFT JOIN ads_orders o ON o.referral_id=r.id
             WHERE r.ambassador_id=? AND r.ended_at IS NULL
             GROUP BY r.referred_id, r.channel, r.started_at
             ORDER BY r.started_at DESC LIMIT 100",
            [$authenticatedAmbassadorId]
        );
        $privatePeople = array_map(function (array $p): array {
            return [
                'alias' => 'Indicado #' . strtoupper(substr(bin2hex(ReferralRules::digest('alias', (string)$p['referred_id'], $this->secret)), 0, 6)),
                'internal_id' => (int)$p['referred_id'], // apenas para ação autenticada "Liberar"; NÃO expor em links públicos
                'channel' => $p['channel'],
                'joined_at' => $p['started_at'],
                'purchases' => (int)$p['purchases'],
                'sales_cents' => (int)$p['sales_cents'],
            ];
        }, $people);
        return [
            'referrals' => ['total_historical' => (int)$ref['total'], 'active' => (int)$ref['active']],
            'share_actions_started' => (int)($actions['shares'] ?? 0),
            'unique_browser_visits_estimated' => (int)($clicks['clicks'] ?? 0),
            'paid_sales' => $sales,
            'channels' => $channels,
            'indicated' => $privatePeople,
            'measurement_note' => 'Compartilhar e clicar não provam contato único, entrega ou identidade; cadastro exige verificação.',
        ];
    }
    /**
     * Comissões separadas por sorteio/campanha, sem expor custo, imposto, margem
     * nem orçamento interno. Pendente = reserva, não crédito disponível.
     */
    public function commissionsByCampaign(int $authenticatedAmbassadorId): array
    {
        return $this->rows(
            "SELECT campaign_key,
                COUNT(DISTINCT IF(state='paid', buyer_id, NULL)) AS confirmed_buyers,
                COUNT(IF(state='paid',1,NULL)) AS confirmed_orders,
                COALESCE(SUM(IF(state='paid', total_cents, 0)),0) AS confirmed_sales_cents,
                COALESCE(SUM(IF(state='paid', cash_cents, 0)),0) AS external_cash_cents,
                COALESCE(SUM(IF(state='paid', credit_cents, 0)),0) AS credit_reused_cents,
                COALESCE(SUM(IF(state='paid', commission_cents, 0)),0) AS confirmed_commission_cents,
                COALESCE(SUM(IF(state='pending', commission_cents, 0)),0) AS pending_commission_cents
             FROM ads_orders WHERE beneficiary_id=?
             GROUP BY campaign_key ORDER BY campaign_key",
            [$authenticatedAmbassadorId]
        );
    }

    /**
     * Ranking de um nível: (1) cadastros ativos; (2) compradores únicos;
     * (3) vendas diretas confirmadas. Aliases pseudônimos, sem PII.
     * Período/filtros podem ser adicionados no integrador depois de validado.
     */
    public function leaderboards(): array
    {
        $queries = [
            'cadastros' => "SELECT ambassador_id AS person_id, COUNT(DISTINCT referred_id) AS score
                FROM ads_referrals WHERE ended_at IS NULL
                GROUP BY ambassador_id ORDER BY score DESC, ambassador_id LIMIT 20",
            'compradores' => "SELECT beneficiary_id AS person_id, COUNT(DISTINCT buyer_id) AS score
                FROM ads_orders WHERE state='paid' AND beneficiary_id IS NOT NULL
                GROUP BY beneficiary_id ORDER BY score DESC, beneficiary_id LIMIT 20",
            'vendas' => "SELECT beneficiary_id AS person_id, COALESCE(SUM(total_cents),0) AS score
                FROM ads_orders WHERE state='paid' AND beneficiary_id IS NOT NULL
                GROUP BY beneficiary_id ORDER BY score DESC, beneficiary_id LIMIT 20"
        ];
        $out = [];
        foreach ($queries as $label => $sql) {
            $out[$label] = array_map(function (array $row): array {
                return [
                    'alias' => 'Embaixador #' . strtoupper(substr(bin2hex(ReferralRules::digest('leaderboard', (string)$row['person_id'], $this->secret)), 0, 6)),
                    'score' => (int)$row['score'],
                ];
            }, $this->rows($sql));
        }
        return $out;
    }

}
