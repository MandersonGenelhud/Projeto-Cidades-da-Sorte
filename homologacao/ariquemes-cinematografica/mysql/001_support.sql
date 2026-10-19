-- Somente homologação, com inscrições interrompidas durante a migração.
-- Pré-requisito: tabelas legadas InnoDB e índices únicos para phone/founder_number.
-- DDL no MySQL faz commit implícito: este arquivo não é uma migração atômica.
CREATE TABLE IF NOT EXISTS prelaunch_sequences (
 sequence_key VARCHAR(32) NOT NULL PRIMARY KEY,
 last_number INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS prelaunch_rate_limits (
 client_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 bucket BIGINT UNSIGNED NOT NULL,
 attempts BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(client_hash,bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO prelaunch_sequences(sequence_key,last_number) VALUES('founder',0);
-- MAX somente na preparação, com inscrições paradas. As requisições usam UPDATE transacional.
UPDATE prelaunch_sequences
SET last_number=GREATEST(last_number,(SELECT COALESCE(MAX(founder_number),0) FROM prelaunch_leads))
WHERE sequence_key='founder';
