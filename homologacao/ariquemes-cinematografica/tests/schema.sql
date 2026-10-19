CREATE TABLE prelaunch_leads(id INTEGER PRIMARY KEY AUTOINCREMENT,founder_number INTEGER NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,email TEXT,referral_code TEXT NOT NULL UNIQUE,referred_by INTEGER,consent_whatsapp INTEGER NOT NULL,consent_text TEXT,source TEXT,utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE prelaunch_company_votes(id INTEGER PRIMARY KEY AUTOINCREMENT,lead_id INTEGER NOT NULL,company_name TEXT NOT NULL,company_key TEXT NOT NULL, UNIQUE(lead_id,company_key));
CREATE TABLE prelaunch_sequences(sequence_key TEXT PRIMARY KEY,last_number INTEGER NOT NULL);
INSERT INTO prelaunch_sequences VALUES('founder',0);
CREATE TABLE prelaunch_rate_limits(client_hash TEXT NOT NULL,bucket INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(client_hash,bucket));
