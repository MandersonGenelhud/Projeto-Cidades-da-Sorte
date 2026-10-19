-- Fixture exclusiva de testes: exige banco ads_hml_* vazio. Não importar em produção.
CREATE TABLE prelaunch_leads (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 founder_number INT UNSIGNED NOT NULL UNIQUE,
 name VARCHAR(190) NOT NULL,
 phone VARCHAR(30) NOT NULL UNIQUE,
 email VARCHAR(190) NULL,
 referral_code VARCHAR(32) NOT NULL UNIQUE,
 referred_by BIGINT UNSIGNED NULL,
 consent_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
 consent_text VARCHAR(500) NULL,
 source VARCHAR(80) NULL,
 utm_source VARCHAR(120) NULL,
 utm_medium VARCHAR(120) NULL,
 utm_campaign VARCHAR(190) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (referred_by) REFERENCES prelaunch_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE prelaunch_company_votes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 lead_id BIGINT UNSIGNED NOT NULL,
 company_name VARCHAR(190) NOT NULL,
 company_key VARCHAR(190) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY lead_company (lead_id,company_key),
 FOREIGN KEY (lead_id) REFERENCES prelaunch_leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
