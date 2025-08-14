const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Variables d'env. définies sur Netlify
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY  = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  try {
    const { question } = JSON.parse(event.body || '{}');
    if (!question) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Question requise' }) };
    }
    // 1) Recherche Supabase (exemple sur table "coworking")
    const { data } = await supabase
      .from('coworking')
      .select('nom,ville,prix,adresse')
      .ilike('ville', `%${question.match(/à\s+(\w+)/)?.[1] || ''}%`)
      .limit(3);

    let prompt = `Question: ${question}\n\n`;
    if (data && data.length) {
      prompt += 'Données Supabase:\n' + data.map((r,i)=>`${i+1}. ${r.nom} – ${r.ville} – ${r.prix} – ${r.adresse}`).join('\n');
      prompt += '\n\nRéponds en utilisant ces données et ajoute tes conseils.';
    }

    // 2) Appel OpenAI
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Tu es Léo, expert en coworkings.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const aiData = await aiRes.json();
    const reply = aiData.choices?.[0]?.message?.content || 'Pas de réponse.';
    
    return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
