// carrega variaveis de ambiente
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const supabase = require('./config/supabase');
const { connectRabbitMQ, publishEvent } = require('./config/rabbitmq');

const app = express();
const PORT = process.env.PORT || 3000;

// habilita json no corpo das requisicoes
app.use(express.json());

// rota de status da api
app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'api-estoque' });
});

// lista todos os produtos
app.get('/produtos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// busca produto por id
app.get('/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'produto nao encontrado' });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// cadastra novo produto
app.post('/produtos', async (req, res) => {
  try {
    const { nome, preco, quantidade, estoque_minimo } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'nome e obrigatorio' });
    }

    const qtd = Number(quantidade) || 0;
    const min = Number(estoque_minimo) || 5;
    const prc = Number(preco) || 0;

    const { data, error } = await supabase
      .from('produtos')
      .insert([
        {
          nome,
          preco: prc,
          quantidade: qtd,
          estoque_minimo: min,
          disponivel: qtd > 0
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// atualiza produto existente
app.put('/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, preco, quantidade, estoque_minimo, disponivel } = req.body;

    const updateData = {};
    if (nome !== undefined) updateData.nome = nome;
    if (preco !== undefined) updateData.preco = Number(preco);
    if (quantidade !== undefined) {
      updateData.quantidade = Number(quantidade);
      if (disponivel === undefined) {
        updateData.disponivel = Number(quantidade) > 0;
      }
    }
    if (estoque_minimo !== undefined) updateData.estoque_minimo = Number(estoque_minimo);
    if (disponivel !== undefined) updateData.disponivel = Boolean(disponivel);

    const { data, error } = await supabase
      .from('produtos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// remove produto
app.delete('/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('produtos')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ mensagem: 'produto removido com sucesso' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// movimenta estoque e publica evento
app.post('/produtos/:id/movimentar', async (req, res) => {
  try {
    const { id } = req.params;
    let { tipo, quantidade, quantidadeMovimentada } = req.body;

    // valida parametros basicos
    const qtdMovimentada = Number(quantidade || quantidadeMovimentada);
    if (!qtdMovimentada || qtdMovimentada <= 0) {
      return res.status(400).json({ error: 'quantidade deve ser maior que zero' });
    }

    const tipoNormalizado = String(tipo || '').toUpperCase().trim();
    if (tipoNormalizado !== 'ENTRADA' && tipoNormalizado !== 'SAIDA') {
      return res.status(400).json({ error: 'tipo deve ser ENTRADA ou SAIDA' });
    }

    // busca produto no supabase
    const { data: produto, error: buscaError } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', id)
      .single();

    if (buscaError || !produto) {
      return res.status(404).json({ error: 'produto nao encontrado' });
    }

    // calcula saldo anterior e novo saldo
    const saldoAnterior = produto.quantidade !== undefined ? Number(produto.quantidade) : Number(produto.estoque || 0);
    const estoqueMinimo = produto.estoque_minimo !== undefined ? Number(produto.estoque_minimo) : 5;

    // valida saldo suficiente para saida
    if (tipoNormalizado === 'SAIDA' && saldoAnterior < qtdMovimentada) {
      return res.status(400).json({
        error: 'saldo insuficiente em estoque',
        saldoAtual: saldoAnterior,
        quantidadeSolicitada: qtdMovimentada
      });
    }

    const saldoAtual = tipoNormalizado === 'ENTRADA'
      ? saldoAnterior + qtdMovimentada
      : saldoAnterior - qtdMovimentada;

    // atualiza saldo no supabase
    const updatePayload = { quantidade: saldoAtual };
    if (produto.estoque !== undefined) {
      updatePayload.estoque = saldoAtual;
    }

    const { error: updateError } = await supabase
      .from('produtos')
      .update(updatePayload)
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({ error: 'erro ao atualizar produto: ' + updateError.message });
    }

    // monta contrato do evento
    const evento = {
      eventoId: crypto.randomUUID(),
      produtoId: Number(produto.id),
      nomeProduto: produto.nome,
      tipo: tipoNormalizado,
      quantidadeMovimentada: qtdMovimentada,
      saldoAnterior,
      saldoAtual,
      estoqueMinimo,
      timestamp: new Date().toISOString()
    };

    // publica evento de forma assincrona
    publishEvent(evento).catch((pubErr) => {
      console.error('[rabbitmq] falha ao publicar evento:', pubErr.message);
    });

    // responde imediatamente com 200 ok
    return res.status(200).json({
      mensagem: 'movimentacao realizada com sucesso',
      evento
    });
  } catch (err) {
    console.error('[api] erro interno:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// inicia servidor e conecta no broker
app.listen(PORT, async () => {
  console.log(`[api] servidor rodando na porta ${PORT}`);
  try {
    // conecta no rabbitmq
    await connectRabbitMQ();
  } catch (err) {
    console.warn('[rabbitmq] aviso: nao foi possivel conectar de imediato:', err.message);
  }
});

