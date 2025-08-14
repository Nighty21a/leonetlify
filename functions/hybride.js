/**
 * WORKTRIPP - Assistant IA hybride
 * Recherche intelligente: Base de données → Internet → IA générative
 * Version optimisée avec gestion d'erreurs robuste
 */

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// ===== CONFIGURATION ET VALIDATION =====
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY,
  OPENAI_KEY: process.env.OPENAI_API_KEY,
  SERPAPI_KEY: process.env.SERPAPI_KEY,
  TIMEOUTS: {
    database: 4000,    // 4s pour Supabase
    webSearch: 8000,   // 8s pour SerpAPI
    aiGeneration: 10000 // 10s pour OpenAI
  }
};

// Validation complète de la configuration
function validateEnvironment() {
  const missing = [];
  const invalid = [];
  
  if (!CONFIG.SUPABASE_URL) missing.push('SUPABASE_URL');
  else if (!CONFIG.SUPABASE_URL.startsWith('https://')) invalid.push('SUPABASE_URL format invalide');
  
  if (!CONFIG.SUPABASE_KEY) missing.push('SUPABASE_KEY ou SUPABASE_ANON_KEY');
  if (!CONFIG.OPENAI_KEY) missing.push('OPENAI_API_KEY');
  if (!CONFIG.SERPAPI_KEY) missing.push('SERPAPI_KEY');
  
  if (missing.length > 0 || invalid.length > 0) {
    console.error('❌ Configuration invalide:', { missing, invalid });
    return false;
  }
  
  console.log('✅ Configuration validée');
  return true;
}

// Initialisation sécurisée de Supabase
let supabase = null;
if (validateEnvironment()) {
  try {
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-client-info': 'worktripp-assistant' } }
    });
    console.log('✅ Client Supabase initialisé');
  } catch (error) {
    console.error('❌ Échec initialisation Supabase:', error.message);
  }
}

// ===== NORMALISATION DES VILLES =====
const CITY_NORMALIZATION = {
  // France
  "paris": "Paris", "lyon": "Lyon", "marseille": "Marseille", 
  "lille": "Lille", "toulouse": "Toulouse", "bordeaux": "Bordeaux",
  "nice": "Nice", "nantes": "Nantes", "strasbourg": "Strasbourg",
  
  // International
  "london": "London", "londres": "London", "londre": "London",
  "new york": "New York", "newyork": "New York", "ny": "New York",
  "san francisco": "San Francisco", "sf": "San Francisco",
  "los angeles": "Los Angeles", "la": "Los Angeles",
  "berlin": "Berlin", "madrid": "Madrid", "barcelona": "Barcelona",
  "barcelone": "Barcelona", "amsterdam": "Amsterdam", "rome": "Rome",
  "tokyo": "Tokyo", "dublin": "Dublin", "singapore": "Singapore",
  
  // Variations communes
  "tokio": "Tokyo", "singapour": "Singapore", "ny city": "New York"
};

function normalizeCity(rawCity) {
  if (!rawCity || typeof rawCity !== 'string') return '';
  
  const cleaned = rawCity.toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')  // Supprimer caractères spéciaux
    .replace(/\s+/g, ' ');     // Normaliser les espaces
  
  const normalized = CITY_NORMALIZATION[cleaned] || cleaned;
  
  if (normalized !== cleaned) {
    console.log(`🔄 Ville normalisée: "${rawCity}" → "${normalized}"`);
  }
  
  return normalized;
}

// ===== GESTION DES TIMEOUTS =====
class TimeoutManager {
  static async withTimeout(promise, timeoutMs, operationName = 'operation') {
    const controller = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error(`TIMEOUT: ${operationName} (${timeoutMs}ms)`));
      }, timeoutMs);
    });
    
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } catch (error) {
      if (error.message.includes('TIMEOUT')) {
        console.warn(`⏱️ ${operationName} timeout après ${timeoutMs}ms`);
      } else {
        console.error(`❌ ${operationName} erreur:`, error.message);
      }
      throw error;
    }
  }
}

// ===== CIRCUIT BREAKER POUR SUPABASE =====
class DatabaseCircuitBreaker {
  constructor() {
    this.failureCount = 0;
    this.lastFailure = null;
    this.threshold = 3;
    this.resetTimeout = 60000; // 1 minute
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }
  
  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        console.log('🔄 Circuit breaker: HALF_OPEN (test de récupération)');
        return false;
      }
      return true;
    }
    return false;
  }
  
  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    console.log('✅ Circuit breaker: SUCCESS (remise à zéro)');
  }
  
  recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      console.error(`🔴 Circuit breaker: OUVERT après ${this.failureCount} échecs`);
    } else {
      console.warn(`⚠️ Circuit breaker: Échec ${this.failureCount}/${this.threshold}`);
    }
  }
}

const dbCircuitBreaker = new DatabaseCircuitBreaker();

// ===== REQUÊTE SUPABASE ROBUSTE =====
async function queryDatabase(city) {
  if (!supabase) {
    console.error('❌ Supabase non disponible');
    return null;
  }
  
  if (dbCircuitBreaker.isOpen()) {
    console.warn('🔴 Base de données temporairement indisponible (circuit ouvert)');
    return null;
  }
  
  try {
    const normalizedCity = normalizeCity(city);
    console.log(`🔍 Requête DB pour: "${normalizedCity}"`);
    
    // Échapper les caractères spéciaux pour ilike
    const escapedCity = normalizedCity.replace(/[%_\\]/g, '\\$&');
    
    const { data, error } = await supabase
      .from('coworking')
      .select('name, visit, date, prix, adresse, description')
      .or(`name.ilike.%${escapedCity}%,visit.ilike.%${escapedCity}%,ville.ilike.%${escapedCity}%`)
      .limit(8);
    
    if (error) {
      console.error('❌ Erreur Supabase:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      dbCircuitBreaker.recordFailure();
      return null;
    }
    
    console.log(`✅ DB: ${data?.length || 0} résultats trouvés`);
    dbCircuitBreaker.recordSuccess();
    return data || [];
    
  } catch (exception) {
    console.error('❌ Exception DB:', exception.message);
    dbCircuitBreaker.recordFailure();
    return null;
  }
}

// ===== RECHERCHE INTERNET =====
async function searchWeb(city) {
  try {
    const query = `coworking spaces ${city} bureaux partagés`;
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${CONFIG.SERPAPI_KEY}&engine=google&num=6&hl=fr&gl=fr`;
    
    console.log(`🌐 Recherche web: "${query}"`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SerpAPI HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`SerpAPI error: ${data.error}`);
    }
    
    const results = data.organic_results?.slice(0, 5).map(result => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      source: 'web'
    })) || [];
    
    console.log(`✅ Web: ${results.length} résultats trouvés`);
    return results;
    
  } catch (error) {
    console.error('❌ Erreur recherche web:', error.message);
    return [];
  }
}

// ===== GÉNÉRATION IA =====
async function generateResponse(question, results, source) {
  try {
    let prompt = '';
    
    switch (source) {
      case 'database':
        if (results.length > 0) {
          const dbInfo = results.map((item, i) => 
            `${i+1}. **${item.name}** (${item.ville || 'Localisation'}) - ${item.prix || 'Prix sur demande'}`
          ).join('\n');
          
          prompt = `L'utilisateur recherche: "${question}".
Voici des coworkings de notre base partenaire:

${dbInfo}

Réponds en français avec:
- Titre "🏢 Coworkings de notre réseau exclusif :"
- Liste les résultats avec leurs caractéristiques principales
- Mentionne les avantages du réseau partenaire
Format: conversationnel, max 180 mots`;
        }
        break;
        
      case 'web':
        if (results.length > 0) {
          const webInfo = results.slice(0, 4).map((item, i) => 
            `${i+1}. ${item.title}\n   ${item.link}${item.snippet ? `\n   ${item.snippet.slice(0, 100)}...` : ''}`
          ).join('\n\n');
          
          prompt = `L'utilisateur recherche: "${question}".
Résultats internet trouvés:

${webInfo}

Réponds en français avec:
- Titre "🌐 Coworkings trouvés sur internet :"
- Présente les meilleurs résultats
- Encourage à rejoindre notre réseau qui grandit quotidiennement
Format: informatif, max 160 mots`;
        }
        break;
        
      default:
        prompt = `L'utilisateur recherche: "${question}".
Aucun résultat trouvé actuellement.

Réponds en français avec:
- S'excuser aimablement 
- Suggérer de reformuler ou essayer une autre ville
- Encourager car notre base s'enrichit constamment
- Proposer de contacter l'équipe pour des besoins spécifiques
Format: encourageant et professionnel, max 100 mots`;
    }
    
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'Tu es Léo, assistant Worktripp expert en espaces de coworking. Sois précis, amical et professionnel. Aide les nomades digitaux à trouver les meilleurs espaces de travail.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 350,
        temperature: 0.4
      })
    });
    
    if (!aiResponse.ok) {
      throw new Error(`OpenAI HTTP ${aiResponse.status}`);
    }
    
    const aiData = await aiResponse.json();
    let reply = aiData.choices?.[0]?.message?.content || 'Désolé, je ne peux pas générer de réponse actuellement.';
    
    // Ajout du badge source
    switch (source) {
      case 'database':
        reply += "\n\n🔒 *Source: Base Worktripp - Espaces partenaires vérifiés*";
        break;
      case 'web':
        reply += "\n\n🌐 *Source: Recherche internet - Rejoignez notre réseau grandissant !*";
        break;
      default:
        reply += "\n\n💡 *Notre équipe Worktripp ajoute de nouveaux partenaires chaque jour*";
    }
    
    return reply;
    
  } catch (error) {
    console.error('❌ Erreur génération IA:', error.message);
    return "Je rencontre un problème technique momentané. Notre équipe Worktripp travaille constamment pour vous offrir les meilleurs espaces de coworking !";
  }
}

// ===== EXTRACTION DE VILLE =====
function extractCity(question) {
  // Motifs de recherche de ville améliorés
  const patterns = [
    /(?:à|in|at|near|dans|en|sur|vers|around|close to)\s+([^.!?\n,]+)/gi,
    /(?:coworking|espace|bureau|office)\s+(?:à|in|at|dans|en)\s+([^.!?\n,]+)/gi,
    /(?:trouve|cherche|search|find).*?(?:à|in|dans)\s+([^.!?\n,]+)/gi
  ];
  
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match && match[1]) {
      let city = match[1].trim();
      // Nettoyer la ville extraite
      city = city.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
      if (city.length > 1 && city.length < 50) {
        console.log(`📍 Ville extraite: "${city}" via pattern`);
        return city;
      }
    }
  }
  
  // Fallback: utiliser toute la question nettoyée
  const cleaned = question.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ").trim();
  console.log(`📍 Ville fallback: "${cleaned}"`);
  return cleaned;
}

// ===== HANDLER PRINCIPAL =====
exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json'
  };
  
  // Gestion CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  // Validation de la méthode HTTP
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        error: 'Méthode non autorisée',
        allowed: ['POST', 'OPTIONS']
      })
    };
  }
  
  try {
    // Parse et validation du body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'JSON invalide',
          message: parseError.message
        })
      };
    }
    
    const { question, userId } = body;
    
    // Validation de la question
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Question requise',
          received: { question: typeof question, length: question?.length || 0 }
        })
      };
    }
    
    const trimmedQuestion = question.trim();
    console.log(`🚀 Worktripp - Nouvelle requête: "${trimmedQuestion}" (User: ${userId || 'anonyme'})`);
    
    // Extraction de la ville de la question
    const city = extractCity(trimmedQuestion);
    if (!city) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Impossible d\'extraire une ville de votre question',
          suggestion: 'Essayez: "Coworking à Paris" ou "Espaces de travail à Londres"'
        })
      };
    }
    
    console.log(`📍 Recherche pour la ville: "${city}"`);
    
    // ===== STRATÉGIE DE RECHERCHE HYBRIDE =====
    
    // ÉTAPE 1: Tentative base de données (priorité)
    let dbResults = null;
    let dbSuccess = false;
    
    try {
      dbResults = await TimeoutManager.withTimeout(
        queryDatabase(city),
        CONFIG.TIMEOUTS.database,
        'Requête base de données'
      );
      
      if (dbResults && dbResults.length > 0) {
        dbSuccess = true;
        console.log(`✅ Succès base de données: ${dbResults.length} résultats`);
        
        // Génération de la réponse IA avec les données DB
        const aiResponse = await TimeoutManager.withTimeout(
          generateResponse(trimmedQuestion, dbResults, 'database'),
          CONFIG.TIMEOUTS.aiGeneration,
          'Génération réponse IA (DB)'
        );
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reponse: aiResponse,
            source: 'database',
            results_count: dbResults.length,
            city_searched: city,
            response_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          })
        };
      } else {
        console.log('ℹ️ Base de données: aucun résultat trouvé');
      }
      
    } catch (dbError) {
      console.warn(`⚠️ Base de données inaccessible: ${dbError.message}`);
      // Continuer vers la recherche web
    }
    
    // ÉTAPE 2: Fallback recherche internet
    console.log('🔄 Activation du fallback internet...');
    
    try {
      const webResults = await TimeoutManager.withTimeout(
        searchWeb(city),
        CONFIG.TIMEOUTS.webSearch,
        'Recherche internet'
      );
      
      // Génération de la réponse IA avec les résultats web
      const aiResponse = await TimeoutManager.withTimeout(
        generateResponse(trimmedQuestion, webResults, 'web'),
        CONFIG.TIMEOUTS.aiGeneration,
        'Génération réponse IA (Web)'
      );
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          reponse: aiResponse,
          source: 'internet',
          results_count: webResults.length,
          city_searched: city,
          fallback: true,
          db_attempted: true,
          db_success: dbSuccess,
          response_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        })
      };
      
    } catch (webError) {
      console.error(`❌ Recherche internet échouée: ${webError.message}`);
      
      // ÉTAPE 3: Réponse de dernière chance (IA générative pure)
      try {
        const fallbackResponse = await TimeoutManager.withTimeout(
          generateResponse(trimmedQuestion, [], 'fallback'),
          CONFIG.TIMEOUTS.aiGeneration,
          'Génération réponse fallback'
        );
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reponse: fallbackResponse,
            source: 'ai_fallback',
            results_count: 0,
            city_searched: city,
            fallback: true,
            db_attempted: true,
            web_attempted: true,
            all_sources_failed: true,
            response_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          })
        };
        
      } catch (aiError) {
        console.error(`❌ Génération IA finale échouée: ${aiError.message}`);
        
        // Réponse d'urgence statique
        return {
          statusCode: 503,
          headers,
          body: JSON.stringify({
            reponse: `Désolé, tous nos services sont temporairement indisponibles. Notre équipe Worktripp travaille à résoudre le problème rapidement. Veuillez réessayer dans quelques minutes.`,
            source: 'static_fallback',
            error: 'Tous les services indisponibles',
            city_searched: city,
            response_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          })
        };
      }
    }
    
  } catch (globalError) {
    console.error('❌ Erreur globale handler:', globalError);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erreur interne du serveur',
        message: globalError.message,
        timestamp: new Date().toISOString(),
        response_time_ms: Date.now() - startTime
      })
    };
  }
};

// ===== FONCTIONS UTILITAIRES =====

// Test de connectivité (pour debugging)
async function healthCheck() {
  const results = {
    environment: validateEnvironment(),
    supabase: !!supabase,
    timestamp: new Date().toISOString()
  };
  
  if (supabase) {
    try {
      const { error } = await supabase.from('coworking').select('count').limit(1);
      results.supabase_connection = !error;
    } catch (e) {
      results.supabase_connection = false;
      results.supabase_error = e.message;
    }
  }
  
  return results;
}

// Export pour tests (optionnel)
module.exports = {
  handler: exports.handler,
  normalizeCity,
  extractCity,
  healthCheck,
  TimeoutManager,
  DatabaseCircuitBreaker
};
