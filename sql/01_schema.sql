-- cria extensao para uuid se necessario
create extension if not exists "uuid-ossp";

-- cria tabela de produtos se nao existir
create table if not exists produtos (
  id serial primary key,
  nome varchar(255) not null,
  preco numeric(10, 2) not null default 0,
  quantidade integer not null default 0,
  estoque_minimo integer not null default 5,
  disponivel boolean not null default true,
  criado_em timestamp with time zone default now()
);

-- garante colunas na tabela produtos
alter table produtos add column if not exists estoque_minimo integer default 5;
alter table produtos add column if not exists disponivel boolean default true;

-- cria tabela de movimentacoes para auditoria
create table if not exists movimentacoes_estoque (
  id uuid default gen_random_uuid() primary key,
  evento_id uuid not null unique,
  produto_id integer not null references produtos(id) on delete cascade,
  tipo varchar(10) not null check (tipo in ('ENTRADA', 'SAIDA')),
  quantidade integer not null,
  saldo_anterior integer not null,
  saldo_atual integer not null,
  criado_em timestamp with time zone default now()
);

-- cria tabela de alertas de reposicao para compras
create table if not exists alertas_reposicao (
  id uuid default gen_random_uuid() primary key,
  produto_id integer not null references produtos(id) on delete cascade,
  saldo_atual integer not null,
  estoque_minimo integer not null,
  status varchar(20) not null default 'PENDENTE' check (status in ('PENDENTE', 'RESOLVIDO')),
  criado_em timestamp with time zone default now()
);

-- cria indices para consultas rapidas
create index if not exists idx_movimentacoes_produto_id on movimentacoes_estoque(produto_id);
create index if not exists idx_movimentacoes_evento_id on movimentacoes_estoque(evento_id);
create index if not exists idx_alertas_produto_id on alertas_reposicao(produto_id);
create index if not exists idx_alertas_status on alertas_reposicao(status);

