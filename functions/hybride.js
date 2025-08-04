const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = 'https://jcbbuiowjrwteafkruio.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration des tables
const TABLES_CONFIG = {
  'coworking': {
    table: 'coworking',
    motsCles: ['coworking', 'espace de travail', 'bureau', 'travailler'],
    colonnes: ['nom', 'ville', 'prix', 'adresse']
  },
  'a_voir': {
    table: 'a_voir',
    motsCles: ['voir', 'visiter', 'lieu', 'lieux', 'attraction'],
    colonnes: ['nom', 'ville']
  },
  'restaurant': {
    table: 'restaurants',
    motsCles: ['restaurant', 'resto', 'manger'],
    colonnes: ['nom', 'ville', 'type_cuisine', 'adresse']
  }
};

const VILLES = ['paris', 'lyon', 'marseille', 'toulouse', 'nice', 'nantes'];

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    const { question } = JSON.parse(event.body);
    
    if (!question) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Question requise' })
      };
    }

    // 1. Analyser la question
    const analyse = analyserQuestion(question);
    let reponseComplete = '';
    
    if (analyse.necessite_bdd) {
      // 2. Chercher dans Supabase
      const donnees = await rechercherSupabase(analyse);
      
      // 3. Construire prompt enrichi
      let prompt = `Question: ${question}\n\n`;
      
      if (donnees.length > 0) {
        prompt += `Données de nos bases:\n`;
        donnees.forEach((item, i) => {
          prompt += `${i+1}. ${Object.values(item).join(' - ')}\n`;
        });
        prompt += `\nRéponds en utilisant ces données réelles et ajoute tes conseils d'expert.`;
      } else {
        prompt += `Aucune donnée trouvée dans nos bases. Réponds avec tes connaissances générales.`;
      }
      
      // 4. Appeler OpenAI
      reponseComplete = await appellerOpenAI(prompt);
      
    } else {
      // Question générale
      reponseComplete = await appellerOpenAI(question);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reponse: reponseComplete })
    };
    
  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Fonctions utilitaires
function analyserQuestion(question) {
  const questionLower = question.toLowerCase();
  let tables_detectees = [];
  let ville = null;
  let necessite_bdd = false;
  
  // Détecter les tables
  for (const [key, config] of Object.entries(TABLES_CONFIG)) {
    if (config.motsCles.some(mot => questionLower.includes(mot))) {
      tables_detectees.push(key);
      necessite_bdd = true;
    }
  }
  
  // Détecter la ville
  const villeDetectee = VILLES.find(v => questionLower.includes(v));
  if (villeDetectee) ville = villeDetectee;
  
  // Si ville mentionnée sans table, ajouter coworking par défaut
  if (ville && tables_detectees.length === 0) {
    tables_detectees.push('coworking');
    necessite_bdd = true;
  }
  
  return { necessite_bdd, tables_detectees, ville };
}

async function rechercherSupabase(analyse) {
  const { tables_detectees, ville } = analyse;
  let tousResultats = [];
  
  for (const tableKey of tables_detectees) {
    const config = TABLES_CONFIG[tableKey];
    
    try {
      let query = supabase
        .from(config.table)
        .select(config.colonnes.join(', '))
        .limit(5);
      
      if (ville) {
        query = query.ilike('ville', `%${ville}%`);
      }
      
      const { data, error } = await query;
      
      if (!error && data) {
        tousResultats = tousResultats.concat(data);
      }
    } catch (error) {
      console.error(`Erreur table ${tableKey}:`, error);
    }
  }
  
  return tousResultats;
}

async function appellerOpenAI(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Tu es Léo, assistant expert en coworkings, lieux à visiter et restaurants. Tu donnes des conseils pratiques.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error('Erreur OpenAI: ' + (data.error?.message || 'Erreur inconnue'));
  }
  
  return data.choices[0].message.content;
}
