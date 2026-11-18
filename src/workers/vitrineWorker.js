// carrega variaveis de ambiente
require('dotenv').config();

const amqp = require('amqplib');
const supabase = require('../config/supabase');
const { EXCHANGE_NAME, QUEUES } = require('../config/rabbitmq');

// inicia consumidor de vitrine
async function startVitrineWorker() {
  const url = process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
  try {
    // conecta no broker
    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();

    // configura prefetch
    await channel.prefetch(1);

    // declara exchange e fila duravel
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUES.VITRINE, { durable: true });
    await channel.bindQueue(QUEUES.VITRINE, EXCHANGE_NAME, '');

    console.log(`[vitrine] escutando fila: ${QUEUES.VITRINE}`);

    // consome mensagens com ack manual
    channel.consume(QUEUES.VITRINE, async (msg) => {
      if (!msg) return;

      try {
        const evento = JSON.parse(msg.content.toString());
        console.log(`[vitrine] verificando disponibilidade: produto ${evento.produtoId} | saldo: ${evento.saldoAtual}`);

        // esgota produto quando saldo zera
        if (Number(evento.saldoAtual) === 0) {
          const { error } = await supabase
            .from('produtos')
            .update({ disponivel: false })
            .eq('id', evento.produtoId);

          if (error) {
            console.error('[vitrine] erro ao marcar indisponivel:', error.message);
            channel.nack(msg, false, true);
            return;
          }

          console.log(`[vitrine] produto ${evento.produtoId} marcado como indisponivel`);
        }
        // reativa produto na vitrine em caso de entrada com saldo positivo
        else if (evento.tipo === 'ENTRADA' && Number(evento.saldoAtual) > 0) {
          const { error } = await supabase
            .from('produtos')
            .update({ disponivel: true })
            .eq('id', evento.produtoId);

          if (error) {
            console.error('[vitrine] erro ao marcar disponivel:', error.message);
            channel.nack(msg, false, true);
            return;
          }

          console.log(`[vitrine] produto ${evento.produtoId} marcado como disponivel`);
        } else {
          console.log(`[vitrine] sem alteracao necessaria para produto ${evento.produtoId}`);
        }

        // confirma mensagem apos sucesso
        channel.ack(msg);
      } catch (err) {
        console.error('[vitrine] erro inesperado:', err.message);
        channel.nack(msg, false, false);
      }
    }, { noAck: false });
  } catch (err) {
    console.error('[vitrine] erro ao iniciar worker:', err.message);
    process.exit(1);
  }
}

startVitrineWorker();

