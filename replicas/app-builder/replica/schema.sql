-- Schema do app-builder (Postgres / Supabase). Primeira migration.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  credits_balance integer not null default 50 check (credits_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects (user_id);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  forked_from_job_id uuid references jobs(id) on delete set null,
  title text not null default 'Novo app' check (char_length(title) between 1 and 120),
  app_type text not null default 'web'
    check (app_type in ('web', 'landing', 'brainstorm')),
  status text not null default 'idle'
    check (status in ('idle', 'working', 'error', 'paused')),
  current_version_id uuid, -- fk adicionada depois de file_versions
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs (user_id, updated_at desc);
create index on jobs (project_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  client_id text not null, -- barra envio duplicado
  role text not null check (role in ('user', 'assistant', 'tool')),
  mode text not null default 'build' check (mode in ('build', 'plan')),
  content jsonb not null, -- blocos: texto, passos de ferramenta, anexos
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  unique (job_id, client_id)
);
create index on messages (job_id, created_at);

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  number integer not null,
  files jsonb not null, -- {"index.html": "...", "app.js": "..."}
  byte_size integer not null check (byte_size <= 5000000),
  created_at timestamptz not null default now(),
  unique (job_id, number)
);
create index on file_versions (message_id);

alter table jobs add constraint jobs_current_version_fk
  foreign key (current_version_id) references file_versions(id) on delete set null;

create table deployments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  version_id uuid not null references file_versions(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  custom_domain text unique,
  status text not null default 'live' check (status in ('live', 'offline')),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on deployments (version_id);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  delta integer not null,
  reason text not null check (reason in ('signup_bonus', 'agent_usage', 'purchase', 'refund', 'adjustment')),
  created_at timestamptz not null default now()
);
create index on credit_ledger (user_id, created_at desc);
create index on credit_ledger (job_id);
create index on credit_ledger (message_id);

-- Row level security: cada usuário vê só o que é dele.
alter table profiles enable row level security;
alter table projects enable row level security;
alter table jobs enable row level security;
alter table messages enable row level security;
alter table file_versions enable row level security;
alter table deployments enable row level security;
alter table credit_ledger enable row level security;

create policy own_profile on profiles for select using (id = auth.uid());
create policy own_projects on projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_jobs on jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_messages on messages for select
  using (exists (select 1 from jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy own_versions on file_versions for select
  using (exists (select 1 from jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy own_deployments on deployments for select
  using (exists (select 1 from jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy own_ledger on credit_ledger for select using (user_id = auth.uid());
-- Escritas em messages, file_versions, deployments, credit_ledger e no saldo
-- acontecem só no servidor (service role), dentro das rotas da API.
-- O app publicado (/p/:slug) é lido pelo servidor, não pelo navegador.
