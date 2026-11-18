// carrega variaveis de ambiente
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// valida chaves do supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[supabase] erro: credenciais nao configuradas no .env');
}

// cria conexao com supabase
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
