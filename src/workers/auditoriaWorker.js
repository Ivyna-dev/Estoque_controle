// carrega variaveis de ambiente
require('dotenv').config();

const amqp = require('amqplib');
const supabase = require('../config/supabase');
const { EXCHANGE_NAME, QUEUES } = require('../config/rabbitmq');

// inicia consumidor de auditoria
async function startAuditoriaWorker() {
  const url = process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
  try {
    // conecta no broker
    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();

    // configura prefetch
    await channel.prefetch(1);

    // declara exchange e fila duravel
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUES.AUDITORIA, { durable: true });
    await channel.bindQueue(QUEUES.AUDITORIA, EXCHANGE_NAME, '');

    console.log(`[auditoria] escutando fila: ${QUEUES.AUDITORIA}`);

    // consome mensagens com ack manual
    channel.consume(QUEUES.AUDITORIA, async (msg) => {
      if (!msg) return;

      try {
        const evento = JSON.parse(msg.content.toString());
        console.log(`[auditoria] processando evento: ${evento.eventoId} | produto: ${evento.produtoId}`);

        // grava historico imutavel no supabase
        const { error } = await supabase
          .from('movimentacoes_estoque')
          .insert([
            {
              evento_id: evento.eventoId,
              produto_id: evento.produtoId,
              tipo: evento.tipo,
              quantidade: evento.quantidadeMovimentada,
              saldo_anterior: evento.saldoAnterior,
              saldo_atual: evento.saldoAtual,
              criado_em: evento.timestamp || new Date().toISOString()
            }
          ]);

        if (error) {
          // trata duplicidade para garantir idempotencia
          if (error.code === '23505' || (error.message && error.message.includes('unique'))) {
            console.warn(`[auditoria] evento duplicado ignorado: ${evento.eventoId}`);
            channel.ack(msg);
            return;
          }
          console.error('[auditoria] erro ao gravar no supabase:', error.message);
          channel.nack(msg, false, true);
          return;
        }

        console.log(`[auditoria] gravado com sucesso: evento ${evento.eventoId}`);

        // confirma mensagem apos sucesso
        channel.ack(msg);
      } catch (err) {
        console.error('[auditoria] erro inesperado:', err.message);
        channel.nack(msg, false, false);
      }
    }, { noAck: false });
  } catch (err) {
    console.error('[auditoria] erro ao iniciar worker:', err.message);
    process.exit(1);
  }
}

startAuditoriaWorker();

