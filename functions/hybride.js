const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Dictionnaire de normalisation des noms de villes
const VILLE_NORMALISATION = {
  "londres": "london",
  "paris": "paris",
  "tokyo": "tokyo",
  "dublin": "dublin",
  "new york": "new york",
  "berlin": "berlin",
  "rome": "rome",
  "madrid": "madrid",
  "barcelone": "barcelona",
  "amsterdam": "amsterdam"
  // Ajoutez d'autres mappings ici
};

// Fonction avec timeout pour les requêtes
async function withTimeout(promise, ms, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(reason => {
        clearTimeout(timer);
        reject(reason);
      });
  });
}

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
    
    // 1. Normalisation avancée de la ville
    const villeMatch = question.match(/(?:à|in|at|near|près de|nearby|dans|à)\s+([^.!?]+)/i);
    let villeBrute = villeMatch ? villeMatch[1].trim().toLowerCase() : "";
    
    // Nettoyage et normalisation
    villeBrute = villeBrute.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    const villeNormalisee = VILLE_NORMALISATION[villeBrute] || villeBrute;
    
    console.log("Ville recherchée:", villeBrute, "→ Normalisée:", villeNormalisee);
    
    // 2. Recherche dans Supabase avec timeout de 5 secondes
    let supabaseData = [];
    let supabaseSuccess = false;
    
    try {
      const supabasePromise = supabase
        .from('coworking')
        .select('name, visit, date')
        .or(`visit.ilike.%${villeNormalisee}%,name.ilike.%${villeNormalisee}%`)
        .limit(5);
      
      // Timeout de 5 secondes pour Supabase
      const { data } = await withTimeout(
        supabasePromise, 
        5000, 
        "Supabase timeout - Passage à internet"
      );
      
      if (data && data.length > 0) {
        supabaseData = data;
        supabaseSuccess = true;
        console.log("Résultats Supabase trouvés:", data.length);
      }
    } catch (supabaseError) {
      console.log("Erreur/Timeout Supabase:", supabaseError.message);
    }

    // 3. Si Supabase a répondu avec des résultats
    if (supabaseSuccess && supabaseData.length > 0) {
      const supabaseInfo = supabaseData.map((item, i) => 
        `${i+1}. ${item.name} (${item.visit}) - ${item.date || 'Prix sur demande'}`
      ).join('\n');
      
      const prompt = `L'utilisateur cherche: "${question}". 
      Voici des coworkings correspondants de notre base:

      ${supabaseInfo}

      Réponds en français avec:
      - Un titre "🏢 Coworkings trouvés dans notre base:"
      - Liste les résultats avec leurs caractéristiques
      - Ajoute une note sur les avantages exclusifs
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
              content: 'Tu es Léo, expert en coworkings. Utilise exclusivement les données fournies. Sois précis et concis.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 400,
          temperature: 0.3
        })
      });
      
      const aiData = await aiRes.json();
      let reply = aiData.choices?.[0]?.message?.content || 'Je ne trouve pas de réponse.';
      
      // Ajout du badge "Source: Notre base"
      reply += "\n\n🔒 <em>Source: Notre base de coworkings partenaires</em>";
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
    }
    
    // 4. Fallback - Recherche internet (si timeout ou aucun résultat)
    console.log("Recherche internet déclenchée");
    const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(question)}&hl=fr&gl=fr`;
    
    try {
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
        internetResults += "\n💡 Conseil: Ces résultats viennent de sources externes. Nous ajoutons de nouveaux coworkings chaque jour!";
      } else {
        internetResults = "Je n'ai trouvé aucun résultat pertinent sur internet.";
      }
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: internetResults }) };
    } catch (internetError) {
      console.error('Erreur recherche internet:', internetError);
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          reponse: "Je n'ai pas pu accéder à internet pour cette recherche. Notre équipe ajoute constamment de nouveaux coworkings à notre base!" 
        }) 
      };
    }
    
  } catch (err) {
    console.error('Erreur globale:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Erreur interne: ' + err.message }) 
    };
  }
};
