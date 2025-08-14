const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Dictionnaire de normalisation des noms de villes ÉLARGI
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
  "barcelona": "barcelona",
  "amsterdam": "amsterdam",
  "lisbonne": "lisbon",
  "lisbon": "lisbon",
  "milan": "milan",
  "milano": "milan",
  "lyon": "lyon",
  "marseille": "marseille",
  "nice": "nice",
  "toulouse": "toulouse",
  "bordeaux": "bordeaux",
  "lille": "lille",
  "nantes": "nantes",
  "strasbourg": "strasbourg",
  "montpellier": "montpellier"
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
    
    console.log("Question reçue:", question);
    
    // 1. Extraction et normalisation AMÉLIORÉE de la ville
    const patterns = [
      /(?:coworking|espace|bureau|travail).*?(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+)/i,
      /(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+).*?(?:coworking|espace|bureau|travail)/i,
      /(?:trouve|cherche|recherche).*?(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+)/i,
      /([a-zA-ZÀ-ÿ\s-]+)(?:\s+coworking|\s+espace|\s+bureau)/i
    ];
    
    let villeBrute = "";
    for (const pattern of patterns) {
      const match = question.match(pattern);
      if (match && match[1]) {
        villeBrute = match[1].trim().toLowerCase();
        break;
      }
    }
    
    // Nettoyage plus agressif
    villeBrute = villeBrute
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    
    const villeNormalisee = VILLE_NORMALISATION[villeBrute] || villeBrute;
    
    console.log("Ville extraite:", villeBrute, "→ Normalisée:", villeNormalisee);
    
    // 2. Recherche dans Supabase AMÉLIORÉE avec timeout de 8 secondes
    let supabaseData = [];
    let supabaseSuccess = false;
    
    if (villeNormalisee && villeNormalisee.length > 2) {
      try {
        console.log("Tentative de connexion à Supabase...");
        
        // Test de connexion simple d'abord
        const connectionTest = supabase
          .from('coworking')
          .select('count', { count: 'exact', head: true });
          
        await withTimeout(connectionTest, 3000, "Test de connexion Supabase timeout");
        console.log("Connexion Supabase OK");
        
        // Requête principale avec plusieurs stratégies
        const searchQueries = [
          // Recherche exacte sur le nom
          supabase
            .from('coworking')
            .select('name, visit, date')
            .ilike('name', `%${villeNormalisee}%`)
            .limit(3),
          
          // Recherche dans le champ visit
          supabase
            .from('coworking')
            .select('name, visit, date')
            .ilike('visit', `%${villeNormalisee}%`)
            .limit(3),
            
          // Recherche combinée
          supabase
            .from('coworking')
            .select('name, visit, date')
            .or(`name.ilike.%${villeNormalisee}%,visit.ilike.%${villeNormalisee}%`)
            .limit(5)
        ];
        
        // Essayer les requêtes une par une
        for (let i = 0; i < searchQueries.length; i++) {
          try {
            console.log(`Essai requête Supabase ${i + 1}...`);
            const { data, error } = await withTimeout(
              searchQueries[i], 
              5000, 
              `Requête Supabase ${i + 1} timeout`
            );
            
            if (error) {
              console.error(`Erreur Supabase requête ${i + 1}:`, error);
              continue;
            }
            
            if (data && data.length > 0) {
              supabaseData = data;
              supabaseSuccess = true;
              console.log(`Succès requête ${i + 1} - Résultats trouvés:`, data.length);
              break;
            }
          } catch (queryError) {
            console.log(`Erreur requête ${i + 1}:`, queryError.message);
          }
        }
        
      } catch (supabaseError) {
        console.error("Erreur générale Supabase:", supabaseError.message);
      }
    } else {
      console.log("Ville non détectée ou trop courte pour Supabase");
    }

    // 3. Si Supabase a répondu avec des résultats
    if (supabaseSuccess && supabaseData.length > 0) {
      console.log("Génération de réponse depuis Supabase...");
      
      const supabaseInfo = supabaseData.map((item, i) => 
        `${i+1}. **${item.name}** - ${item.visit || 'Adresse non spécifiée'} - ${item.date || 'Prix sur demande'}`
      ).join('\n');
      
      const prompt = `L'utilisateur cherche: "${question}". 
      Voici des coworkings de notre base exclusive:

      ${supabaseInfo}

      Réponds en français avec:
      - Un titre "🏢 Coworkings trouvés dans notre base:"
      - Liste les résultats avec leurs caractéristiques principales
      - Mentionne que ce sont des partenaires exclusifs
      Format: structuré avec puces, max 150 mots, ton professionnel`;
      
      try {
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
                content: 'Tu es Léo, expert en coworkings. Utilise exclusivement les données fournies. Sois précis et professionnel.'
              },
              { role: 'user', content: prompt }
            ],
            max_tokens: 500,
            temperature: 0.2
          })
        });
        
        const aiData = await aiRes.json();
        let reply = aiData.choices?.[0]?.message?.content || 'Je ne trouve pas de réponse.';
        
        // Ajout du badge "Source: Notre base"
        reply += "\n\n🔒 **Source**: Notre base de coworkings partenaires exclusifs";
        
        return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
      } catch (aiError) {
        console.error("Erreur OpenAI:", aiError);
        // Fallback sans IA
        let manualReply = "🏢 **Coworkings trouvés dans notre base:**\n\n";
        supabaseData.forEach((item, i) => {
          manualReply += `${i+1}. **${item.name}**\n   📍 ${item.visit || 'Adresse non spécifiée'}\n   💰 ${item.date || 'Prix sur demande'}\n\n`;
        });
        manualReply += "🔒 **Source**: Notre base de coworkings partenaires exclusifs";
        
        return { statusCode: 200, headers, body: JSON.stringify({ reponse: manualReply }) };
      }
    }
    
    // 4. Fallback - Recherche internet (si pas de résultats Supabase)
    console.log("Aucun résultat Supabase - Recherche internet...");
    const searchQuery = `coworking ${villeNormalisee || question}`;
    const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(searchQuery)}&hl=fr&gl=fr`;
    
    try {
      const apiResponse = await fetch(apiUrl);
      const searchData = await apiResponse.json();
      
      let internetResults = "🌍 **Coworkings trouvés sur internet :**\n\n";
      
      if (searchData.organic_results?.length > 0) {
        searchData.organic_results.slice(0, 3).forEach((result, idx) => {
          internetResults += `${idx + 1}. **${result.title}**\n`;
          internetResults += `   🔗 ${result.link}\n`;
          if (result.snippet) internetResults += `   📝 ${result.snippet}\n`;
          internetResults += '\n';
        });
        internetResults += "\n💡 **Info**: Ces résultats viennent de sources externes. Notre base grandit chaque jour !";
      } else {
        internetResults = "❌ Aucun coworking trouvé pour cette recherche. Essayez avec une autre ville !";
      }
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: internetResults }) };
      
    } catch (internetError) {
      console.error('Erreur recherche internet:', internetError);
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          reponse: "❌ Impossible d'accéder aux données pour le moment. Notre équipe enrichit constamment notre base de coworkings !" 
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
