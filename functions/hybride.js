const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Variables d'environnement
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
    
    // 1. Recherche dans Supabase avec extraction intelligente de la ville
    let supabaseData = [];
    let city = '';
    
    try {
      // Extraction avancée du nom de ville (supporte les noms composés)
      const cityMatch = question.match(/(?:à|in|at|near|près de|nearby)\s+([\w\s-]+)/i);
      city = cityMatch ? cityMatch[1].trim() : '';
      
      let query = supabase
        .from('coworking')
        .select('name, visit, date');
      
      if (city) {
        // Recherche insensible à la casse et avec similarité
        query = query.ilike('visit', `%${city}%`);
      }
      
      const { data, error } = await query.limit(5);  // Augmenté à 5 résultats
      
      if (error) {
        console.error('Supabase error:', error.message);
      } else if (data && data.length > 0) {
        supabaseData = data;
      }
    } catch (supabaseError) {
      console.error('Supabase processing error:', supabaseError);
    }

    // 2. Si Supabase a des résultats
    if (supabaseData.length > 0) {
      // Formatage des données pour OpenAI
      const supabaseInfo = supabaseData.map((item, i) => 
        `${i+1}. ${item.name} (${item.visit}) - ${item.date || 'Prix non spécifié'}`
      ).join('\n');
      
      const prompt = `En tant qu'expert mondial en coworkings, réponds à cette question en utilisant 
les données suivantes provenant de notre base de données. Sois précis et utile.

Question: "${question}"

Données de notre base:
${supabaseInfo}

Réponds en français en structurant ta réponse:
- Commence par "🏢 D'après notre base de coworkings:"
- Liste les résultats les plus pertinents
- Ajoute des conseils personnalisés si pertinent
- Termine par "💡 Conseil: [un conseil pratique]"`;
      
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
              content: 'Tu es Léo, expert international en solutions de coworking. Tu travailles pour une plateforme mondiale de réservation de coworkings. Tes réponses sont professionnelles, précises et basées sur les données fournies.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 600,
          temperature: 0.5
        })
      });
      
      const aiData = await aiRes.json();
      const reply = aiData.choices?.[0]?.message?.content || 'Je ne trouve pas de réponse dans notre base.';
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
    }
    
    // 3. Fallback - Recherche internet pour résultats internationaux
    try {
      const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(question)}&hl=fr&gl=fr`;
      const apiResponse = await fetch(apiUrl);
      const searchData = await apiResponse.json();
      
      let internetResults = "🌍 Voici ce que j'ai trouvé sur internet :\n\n";
      
      if (searchData.organic_results && searchData.organic_results.length > 0) {
        // Filtre pour résultats pertinents (évite les annonces)
        const relevantResults = searchData.organic_results
          .filter(result => 
            result.title.toLowerCase().includes('coworking') || 
            result.title.toLowerCase().includes('espace') ||
            result.snippet?.toLowerCase().includes('coworking')
          )
          .slice(0, 5);
        
        if (relevantResults.length > 0) {
          relevantResults.forEach((result, idx) => {
            internetResults += `${idx + 1}. **${result.title}**\n`;
            internetResults += `   ${result.link}\n`;
            if (result.snippet) internetResults += `   ${result.snippet}\n`;
            internetResults += '\n';
          });
        } else {
          internetResults = "Je n'ai trouvé aucun résultat pertinent sur internet pour cette recherche.";
        }
      } else {
        internetResults = "Je n'ai trouvé aucun résultat sur internet pour cette recherche.";
      }
      
      // Ajout d'une note sur les futures mises à jour
      internetResults += "\nℹ️ Notre base de coworkings s'enrichit quotidiennement. Ce lieu sera bientôt disponible!";
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: internetResults }) };
    } catch (internetError) {
      console.error('Erreur recherche internet:', internetError);
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          reponse: "Je n'ai pas pu accéder à internet pour cette recherche internationale. Notre équipe ajoute constamment de nouveaux coworkings à notre base!" 
        }) 
      };
    }
    
  } catch (err) {
    console.error('Erreur globale:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        error: 'Erreur interne: ' + err.message 
      }) 
    };
  }
};
