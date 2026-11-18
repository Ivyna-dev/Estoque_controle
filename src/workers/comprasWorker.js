// carrega variaveis de ambiente
require('dotenv').config();

const amqp = require('amqplib');
const supabase = require('../config/supabase');
const { EXCHANGE_NAME, QUEUES } = require('../config/rabbitmq');

// inicia consumidor de compras
async function startComprasWorker() {
  const url = process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
  try {
    // conecta no broker
    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();

    // configura prefetch
    await channel.prefetch(1);

    // declara exchange e fila duravel
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUES.COMPRAS, { durable: true });
    await channel.bindQueue(QUEUES.COMPRAS, EXCHANGE_NAME, '');

    console.log(`[compras] escutando fila: ${QUEUES.COMPRAS}`);

    // consome mensagens com ack manual
    channel.consume(QUEUES.COMPRAS, async (msg) => {
      if (!msg) return;

      try {
        const evento = JSON.parse(msg.content.toString());
        console.log(`[compras] analisando estoque do produto: ${evento.produtoId} (${evento.nomeProduto})`);

        // verifica nivel critico de estoque
        if (Number(evento.saldoAtual) <= Number(evento.estoqueMinimo)) {
          // grava alerta no supabase
          const { error } = await supabase
            .from('alertas_reposicao')
            .insert([
              {
                produto_id: evento.produtoId,
                saldo_atual: evento.saldoAtual,
                estoque_minimo: evento.estoqueMinimo,
                status: 'PENDENTE',
                criado_em: new Date().toISOString()
              }
            ]);

          if (error) {
            console.error('[compras] erro ao gravar alerta no supabase:', error.message);
            channel.nack(msg, false, true);
            return;
          }

          // exibe log estruturado simulando notificacao
          console.log(`[ALERTA DE COMPRAS] notificacao enviada: produto "${evento.nomeProduto}" (id: ${evento.produtoId}) abaixo do minimo! saldo: ${evento.saldoAtual} | minimo: ${evento.estoqueMinimo}`);
        } else {
          console.log(`[compras] saldo seguro: ${evento.saldoAtual} (minimo: ${evento.estoqueMinimo})`);
        }

        // confirma mensagem apos processar
        channel.ack(msg);
      } catch (err) {
        console.error('[compras] erro inesperado:', err.message);
        channel.nack(msg, false, false);
      }
    }, { noAck: false });
  } catch (err) {
    console.error('[compras] erro ao iniciar worker:', err.message);
    process.exit(1);
  }
}

startComprasWorker();

