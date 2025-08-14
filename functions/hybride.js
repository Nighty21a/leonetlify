const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

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
    
    // 1. Recherche améliorée dans Supabase
    let supabaseData = [];
    try {
      // Extraction avancée du lieu
      const cityMatch = question.match(/(?:à|in|at|near|près de|nearby|dans|à)\s+([^.!?]+)/i);
      let city = cityMatch ? cityMatch[1].trim() : question;
      city = city.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");  // Nettoyage
      
      console.log("Recherche Supabase pour:", city);
      
      // Requête étendue (nom ET ville)
      const { data, error } = await supabase
        .from('coworking')
        .select('name,visit,date')
        .or(`visit.ilike.%${city}%,name.ilike.%${city}%`)
        .limit(5);
      
      if (error) console.error('Erreur Supabase:', error.message);
      if (data) supabaseData = data;
      
    } catch (supabaseError) {
      console.error('Erreur Supabase:', supabaseError);
    }

    // 2. Si résultats dans Supabase
    if (supabaseData.length > 0) {
      console.log("Résultats trouvés dans Supabase:", supabaseData.length);
      const supabaseInfo = supabaseData.map((item, i) => 
        `${i+1}. ${item.name} (${item.visit}) - ${item.date || 'Prix sur demande'}`
      ).join('\n');
      
      const prompt = `L'utilisateur cherche: "${question}". 
      Voici des coworkings correspondants de notre base:

      ${supabaseInfo}

      Réponds en français avec:
      - Un titre "🏢 Coworkings trouvés dans notre base:"
      - Liste les 3 meilleurs résultats avec leurs caractéristiques
      - Termine par un conseil personnalisé
      Format: liste à puces, max 120 mots`;
      
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { 
              role: 'system', 
              content: 'Tu es Léo, expert en coworkings. Tes réponses sont concises, utiles et basées exclusivement sur les données fournies.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 400,
          temperature: 0.3
        })
      });
      
      const aiData = await aiRes.json();
      const reply = aiData.choices?.[0]?.message?.content || 'Je ne trouve pas de réponse.';
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
    }
    
    // 3. Fallback - Recherche internet
    console.log("Aucun résultat dans Supabase, recherche internet...");
    const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(question)}&hl=fr&gl=fr`;
    const apiResponse = await fetch(apiUrl);
    const searchData = await apiResponse.json();
    
    let internetResults = "🌍 Voici ce que j'ai trouvé sur internet :\n\n";
    
    if (searchData.organic_results?.length > 0) {
      searchData.organic_results.slice(0, 3).forEach((result, idx) => {
        internetResults += `${idx + 1}. **${result.title}**\n`;
        internetResults += `   ${result.link}\n`;
        if (result.snippet) internetResults += `   ${result.snippet}\n`;
        internetResults += '\n';
      });
      internetResults += "\n💡 Conseil: Ces résultats viennent de sources externes.";
    } else {
      internetResults = "Je n'ai trouvé aucun résultat pertinent sur internet.";
    }
    
    return { statusCode: 200, headers, body: JSON.stringify({ reponse: internetResults }) };
    
  } catch (err) {
    console.error('Erreur globale:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Erreur interne: ' + err.message }) 
    };
  }
};
