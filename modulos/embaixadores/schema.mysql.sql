-- Laboratório de indicação direta | MySQL 8 / MariaDB com colunas geradas
-- NÃO executar diretamente no banco publicado. Fazer backup, revisar schema real e testar migração.
CREATE TABLE ads_people (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_alias VARCHAR(80) NOT NULL,
  phone_digest BINARY(32) NOT NULL,
  referral_code CHAR(12) NOT NULL,
  verified_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_phone_digest (phone_digest),
  UNIQUE KEY uq_referral_code (referral_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_touches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  visitor_digest BINARY(32) NOT NULL,
  ambassador_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('whatsapp','instagram','outros','desconhecido') NOT NULL DEFAULT 'desconhecido',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_first_touch_browser (visitor_digest),
  KEY idx_touch_ambassador (ambassador_id, created_at),
  CONSTRAINT fk_touch_ambassador FOREIGN KEY (ambassador_id) REFERENCES ads_people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ads_referrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ambassador_id BIGINT UNSIGNED NOT NULL,
  referred_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('whatsapp','instagram','outros','desconhecido') NOT NULL DEFAULT 'desconhecido',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  ended_by BIGINT UNSIGNED NULL,
  active_referred_id BIGINT UNSIGNED GENERATED ALWAYS AS
    (CASE WHEN ended_at IS NULL THEN referred_id ELSE NULL END) STORED,
  UNIQUE KEY uq_one_active_ambassador (active_referred_id),
  KEY idx_ambassador_active (ambassador_id, ended_at, started_at),
  CONSTRAINT chk_no_self_ref CHECK (ambassador_id <> referred_id),
  CONSTRAINT fk_ref_ambassador FOREIGN KEY (ambassador_id) REFERENCES ads_people(id),
  CONSTRAINT fk_ref_referred FOREIGN KEY (referred_id) REFERENCES ads_people(id),
  CONSTRAINT fk_ref_ended_by FOREIGN KEY (ended_by) REFERENCES ads_people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ads_share_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ambassador_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('whatsapp','instagram','outros') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_share_ambassador_date (ambassador_id, created_at),
  CONSTRAINT fk_share_ambassador FOREIGN KEY (ambassador_id) REFERENCES ads_people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ads_campaigns (
  campaign_key VARCHAR(64) NOT NULL PRIMARY KEY,
  commission_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  commission_budget_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  committed_commission_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  legal_approved BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (commission_bps <= 10000),
  CHECK (committed_commission_cents <= commission_budget_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ads_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  external_order_key VARCHAR(100) NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  campaign_key VARCHAR(64) NOT NULL,
  cash_cents BIGINT UNSIGNED NOT NULL,
  credit_cents BIGINT UNSIGNED NOT NULL,
  total_cents BIGINT UNSIGNED NOT NULL,
  referral_id BIGINT UNSIGNED NULL,
  beneficiary_id BIGINT UNSIGNED NULL,
  commission_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  state ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  UNIQUE KEY uq_external_order (external_order_key),
  KEY idx_buyer_state (buyer_id, state),
  KEY idx_referral_state (referral_id, state),
  KEY idx_beneficiary_state (beneficiary_id, state),
  CONSTRAINT fk_order_buyer FOREIGN KEY (buyer_id) REFERENCES ads_people(id),
  CONSTRAINT fk_order_campaign FOREIGN KEY (campaign_key) REFERENCES ads_campaigns(campaign_key),
  CONSTRAINT fk_order_referral FOREIGN KEY (referral_id) REFERENCES ads_referrals(id),
  CONSTRAINT fk_order_beneficiary FOREIGN KEY (beneficiary_id) REFERENCES ads_people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ads_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  event_name VARCHAR(50) NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_subject_date (subject_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
