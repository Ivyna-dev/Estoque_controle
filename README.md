# Controle de Estoque com Mensageria (RabbitMQ + Supabase)

Sistema de gerenciamento e movimentação de estoque assíncrono orientado a eventos (Pub/Sub), desenvolvido com Node.js, Express, Supabase (PostgreSQL) e RabbitMQ.

---

## 1. Arquitetura da Solução

Para garantir alta performance e resiliência na rota crítica de movimentação de estoque (`POST /produtos/:id/movimentar`), os processos secundários foram desacoplados da API síncrona através de mensageria:

```
[ Cliente / Frontend ]
          │ (POST /produtos/:id/movimentar)
          ▼
   [ API Express ] ──(1. Atualiza saldo)──► [ Supabase: produtos ]
          │
          │ (2. Publica evento assíncrono)
          ▼
   [ Exchange: estoque.eventos (fanout, durable) ]
       ├──► [ Fila: fila.auditoria ] ──► [ Worker Auditoria ] ──► [ Supabase: movimentacoes_estoque ]
       ├──► [ Fila: fila.compras ]   ──► [ Worker Compras ]   ──► [ Supabase: alertas_reposicao ]
       └──► [ Fila: fila.vitrine ]   ──► [ Worker Vitrine ]   ──► [ Supabase: produtos (disponivel) ]
```

### Componentes:
- **Produtor (API Express)**: Valida estoque, atualiza saldo no banco e publica o evento imediatamente, respondendo HTTP 200 sem esperar os consumidores.
- **Worker Auditoria (`fila.auditoria`)**: Grava o histórico de movimentações (Kardex) com tratamento de idempotência (`evento_id` único).
- **Worker Compras (`fila.compras`)**: Monitora saldo crítico (`saldoAtual <= estoqueMinimo`) e gera alertas de reposição.
- **Worker Vitrine (`fila.vitrine`)**: Marca produtos com saldo zero como indisponíveis (`disponivel = false`) e reativa se houver entrada com saldo positivo.

---

## 2. Pré-requisitos

- **Node.js** (v18 ou superior)
- **Docker** e **Docker Compose**
- Conta e projeto ativo no **Supabase**

---

## 3. Configuração do Ambiente

### 3.1. Variáveis de Ambiente
Copie o arquivo de exemplo e configure suas credenciais:

```bash
cp .env.example .env
```

Conteúdo esperado no `.env`:
```env
PORT=3000
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua-chave-supabase
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
```

### 3.2. Banco de Dados (Supabase)
Execute o script DDL contido em `sql/01_schema.sql` no SQL Editor do painel do Supabase. Ele cria:
- Colunas `estoque_minimo` e `disponivel` na tabela `produtos`.
- Tabela de histórico `movimentacoes_estoque` com constraint única em `evento_id`.
- Tabela de alertas `alertas_reposicao`.

### 3.3. Subir o RabbitMQ com Docker
Inicie o broker RabbitMQ com painel de gerenciamento habilitado:

```bash
docker compose up -d
```

- **AMQP**: `localhost:5672`
- **Painel de Gestão**: `http://localhost:15672`
- **Usuário**: `admin`
- **Senha**: `admin123`

---

## 4. Como Executar a Aplicação

Abra terminais separados para rodar a API e cada um dos workers:

### Terminal 1 — API Express (Produtor)
```bash
npm start
```

### Terminal 2 — Worker de Auditoria
```bash
npm run worker:auditoria
```

### Terminal 3 — Worker de Compras
```bash
npm run worker:compras
```

### Terminal 4 — Worker de Vitrine
```bash
npm run worker:vitrine
```

---

## 5. Endpoints da API

### 5.1. Listar Produtos
- **GET** `/produtos`

### 5.2. Buscar Produto por ID
- **GET** `/produtos/:id`

### 5.3. Cadastrar Produto
- **POST** `/produtos`
```json
{
  "nome": "Teclado Mecânico RGB",
  "preco": 250.00,
  "quantidade": 10,
  "estoque_minimo": 5
}
```

### 5.4. Atualizar Produto
- **PUT** `/produtos/:id`

### 5.5. Remover Produto
- **DELETE** `/produtos/:id`

### 5.6. Movimentar Estoque (Entrada / Saída)
- **POST** `/produtos/:id/movimentar`

**Exemplo de Entrada (Reposição):**
```json
{
  "tipo": "ENTRADA",
  "quantidade": 5
}
```

**Exemplo de Saída (Venda):**
```json
{
  "tipo": "SAIDA",
  "quantidade": 2
}
```

**Resposta imediata (HTTP 200 OK):**
```json
{
  "mensagem": "movimentacao realizada com sucesso",
  "evento": {
    "eventoId": "550e8400-e29b-41d4-a716-446655440000",
    "produtoId": 1,
    "nomeProduto": "Teclado Mecânico RGB",
    "tipo": "SAIDA",
    "quantidadeMovimentada": 2,
    "saldoAnterior": 6,
    "saldoAtual": 4,
    "estoqueMinimo": 5,
    "timestamp": "2026-11-18T20:00:00.000Z"
  }
}
```

---

## 6. Teste Obrigatório na Apresentação (Prova de Resiliência)

Siga este roteiro passo a passo durante a demonstração para comprovar a resiliência e a persistência de mensagens no RabbitMQ:

### Passo 1: Derrubar o Worker de Compras
No terminal onde o **Worker de Compras** está rodando (`npm run worker:compras`), pressione:
```bash
Ctrl + C
```
O consumidor de compras está agora inativo.

### Passo 2: Realizar 2 vendas na API que atinjam o estoque crítico
Certifique-se de que o produto possui saldo próximo ao estoque mínimo (ex: saldo atual 6, estoque mínimo 5).
Envie duas requisições de venda consecutivas via cURL, Postman ou Thunder Client:

**Venda 1 (reduz saldo para 5 <= mínimo):**
```bash
curl -X POST http://localhost:3000/produtos/1/movimentar \
  -H "Content-Type: application/json" \
  -d '{"tipo": "SAIDA", "quantidade": 1}'
```

**Venda 2 (reduz saldo para 4 <= mínimo):**
```bash
curl -X POST http://localhost:3000/produtos/1/movimentar \
  -H "Content-Type: application/json" \
  -d '{"tipo": "SAIDA", "quantidade": 1}'
```

Observe que a API respondeu **HTTP 200 OK** instantaneamente em ambas as chamadas.

### Passo 3: Visualizar mensagens retidas no Painel do RabbitMQ
1. Abra o navegador em: `http://localhost:15672`
2. Faça login com `admin` / `admin123`.
3. Acesse a aba **Queues** e localize a fila `fila.compras`.
4. Demonstre que a coluna **Ready** exibe o número **2** (as duas mensagens estão salvas e retidas no broker).
5. As filas `fila.auditoria` e `fila.vitrine` continuarão processando normalmente sem serem afetadas.

### Passo 4: Religar o Worker de Compras
No terminal do worker de compras, execute novamente:
```bash
npm run worker:compras
```

### Passo 5: Comprovar consumo e gravação sem perda de dados
1. Observe os logs no terminal do Worker de Compras processando as 2 mensagens acumuladas e emitindo os logs de alerta estruturados:
   ```
   [ALERTA DE COMPRAS] notificacao enviada: produto "Teclado Mecânico RGB" (id: 1) abaixo do minimo! saldo: 5 | minimo: 5
   [ALERTA DE COMPRAS] notificacao enviada: produto "Teclado Mecânico RGB" (id: 1) abaixo do minimo! saldo: 4 | minimo: 5
   ```
2. No painel do RabbitMQ, a fila `fila.compras` voltará para **0 Ready** (mensagens confirmadas com `ack`).
3. No painel do Supabase, consulte a tabela `alertas_reposicao` e comprove que os 2 alertas foram devidamente persistidos sem nenhuma perda de dados.
