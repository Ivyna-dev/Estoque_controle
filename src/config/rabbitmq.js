// carrega variaveis de ambiente
require('dotenv').config();

const amqp = require('amqplib');

// nomes da exchange e das filas
const EXCHANGE_NAME = 'estoque.eventos';
const QUEUES = {
  AUDITORIA: 'fila.auditoria',
  COMPRAS: 'fila.compras',
  VITRINE: 'fila.vitrine'
};

let connection = null;
let channel = null;

// conecta no rabbitmq
async function connectRabbitMQ() {
  const url = process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
  try {
    connection = await amqp.connect(url);
    channel = await connection.createChannel();

    // lida com fechamento de conexao
    connection.on('close', () => {
      console.warn('[rabbitmq] conexao encerrada');
      connection = null;
      channel = null;
    });

    // configura exchange e filas
    await setupRabbitMQ(channel);

    console.log('[rabbitmq] conectado com sucesso');
    return { connection, channel };
  } catch (error) {
    console.error('[rabbitmq] erro ao conectar:', error.message);
    throw error;
  }
}

// configura exchange e filas duraveis
async function setupRabbitMQ(ch) {
  // declara exchange fanout duravel
  await ch.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });

  // declara e vincula as tres filas
  const filas = [QUEUES.AUDITORIA, QUEUES.COMPRAS, QUEUES.VITRINE];
  for (const fila of filas) {
    await ch.assertQueue(fila, { durable: true });
    await ch.bindQueue(fila, EXCHANGE_NAME, '');
  }
}

// publica evento na exchange com persistencia
async function publishEvent(event) {
  try {
    if (!channel) {
      await connectRabbitMQ();
    }

    const payload = Buffer.from(JSON.stringify(event));
    const published = channel.publish(EXCHANGE_NAME, '', payload, {
      persistent: true
    });

    if (published) {
      console.log(`[rabbitmq] evento publicado: ${event.eventoId} | tipo: ${event.tipo} | produto: ${event.produtoId}`);
    }
    return published;
  } catch (error) {
    console.error('[rabbitmq] erro ao publicar evento:', error.message);
    throw error;
  }
}

module.exports = {
  connectRabbitMQ,
  setupRabbitMQ,
  publishEvent,
  EXCHANGE_NAME,
  QUEUES
};

