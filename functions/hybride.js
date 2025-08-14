const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Variables d'environnement
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// Initialisation Supabase
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
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Question requise' })
      };
    }
    
    console.log(`🔍 Recherche: "${question}"`);
    
    // Extraire la ville
    const villeMatch = question.match(/(?:à|in|dans|en)\s+([^.!?]+)/i);
    const ville = villeMatch ? villeMatch[1].trim().toLowerCase() : question.toLowerCase();
    
    console.log(`📍 Ville: "${ville}"`);
    
    // ÉTAPE 1: SUPABASE D'ABORD
    try {
      console.log('🔍 Test connexion Supabase...');
      const { data, error } = await supabase
        .from('coworking')
        .select('*')
        .ilike('ville', `%${ville}%`)
        .limit(5);
      
      if (error) {
        console.error('❌ Erreur Supabase:', error);
        throw new Error('Supabase failed');
      }
      
      if (data && data.length > 0) {
        console.log(`✅ SUPABASE OK: ${data.length} résultats`);
        
        const reponse = `🏢 **Coworkings trouvés dans notre base :**

${data.map((item, i) => `${i+1}. **${item.name}** - ${item.ville || ville}
   📍 ${item.adresse || 'Adresse disponible'}
   💰 ${item.prix || 'Prix sur demande'}`).join('\n\n')}

🔒 *Source: Base Worktripp exclusive*`;
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            reponse,
            source: 'database',
            count: data.length
          })
        };
      }
      
    } catch (dbError) {
      console.log(`⚠️ Supabase indisponible: ${dbError.message}`);
    }
    
    // ÉTAPE 2: INTERNET EN FALLBACK
    console.log('🌐 Passage à internet...');
    
    try {
      const query = `coworking ${ville}`;
      const url = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(query)}&num=5`;
      
      const response = await fetch(url);
      const searchData = await response.json();
      
      if (searchData.organic_results?.length > 0) {
        console.log(`✅ INTERNET OK: ${searchData.organic_results.length} résultats`);
        
        const reponse = `🌐 **Coworkings trouvés sur internet :**

${searchData.organic_results.slice(0, 3).map((item, i) => `${i+1}. **${item.title}**
   🔗 ${item.link}
   📄 ${item.snippet?.slice(0, 100) || 'Description disponible'}...`).join('\n\n')}

💡 *Notre base s'enrichit quotidiennement !*`;
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            reponse,
            source: 'internet',
            count: searchData.organic_results.length
          })
        };
      }
      
    } catch (webError) {
      console.error(`❌ Internet failed: ${webError.message}`);
    }
    
    // FALLBACK FINAL
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        reponse: `Désolé, je n'ai trouvé aucun coworking à ${ville} pour le moment. Notre équipe ajoute de nouveaux espaces chaque jour ! 
        
💡 Essayez avec une autre ville ou reformulez votre recherche.`,
        source: 'fallback'
      })
    };
    
  } catch (error) {
    console.error('❌ Erreur globale:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
