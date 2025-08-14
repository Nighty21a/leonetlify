// functions/hybride.js
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

/* ========= ENV ========= */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;        // anon/public OK si RLS autorise SELECT
const SERPAPI_KEY   = process.env.SERPAPI_KEY;

/* ========= CLIENT DB ========= */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { 'x-client-info': 'worktripp-leo' } }
});

/* ========= UTIL ========= */
// Normalise quelques variantes courantes vers la forme stockée en DB (français)
const CITY_MAP = {
  'paris': 'Paris',
  'lyon': 'Lyon',
  'marseille': 'Marseille',
  'lille': 'Lille',
  'bordeaux': 'Bordeaux',
  'nice': 'Nice',
  'nantes': 'Nantes',
  'strasbourg': 'Strasbourg',
  'london': 'Londres',
  'londres': 'Londres',
  'new york': 'New York',
  'ny': 'New York',
  'berlin': 'Berlin',
  'madrid': 'Madrid',
  'barcelona': 'Barcelone',
  'barcelone': 'Barcelone',
  'rome': 'Rome',
  'tokyo': 'Tokyo',
  'singapore': 'Singapour',
  'singapour': 'Singapour',
};

function extractCity(q) {
  if (!q) return '';
  const raw = (q || '').toLowerCase().trim();

  // on prend ce qui suit "à|in|dans|en"
  const m = raw.match(/(?:\bà|\bin|\bdans|\ben)\s+([^,.;!?]+)/i);
  const candidate = (m ? m[1] : raw)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // si la ville contient plusieurs mots, on garde tout (ex: "new york")
  const norm = CITY_MAP[candidate] || CITY_MAP[candidate.normalize('NFD').replace(/[\u0300-\u036f]/g,'')] || candidate;
  return norm;
}

function formatDbAnswer(rows, villeAffichee) {
  const lines = rows.map((it, i) => {
    const prix = (it.prix != null && it.prix !== '') ? `${it.prix} €` : 'Prix sur demande';
    const adresse = it.adresse || 'Adresse disponible';
    const ville = it.ville || villeAffichee || 'Localisation';
    const nom = it.nom || it.name || 'Espace de coworking';
    return `${i+1}. **${nom}** — ${ville}\n   📍 ${adresse}\n   💰 ${prix}`;
  }).join('\n\n');

  return `🏢 **Coworkings trouvés dans notre base :**\n\n${lines}\n\n🔒 *Source : Base Worktripp (partenaires vérifiés)*`;
}

/* ========= HANDLER ========= */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  try {
    const { question } = JSON.parse(event.body || '{}');
    if (!question || typeof question !== 'string' || !question.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Question requise' }) };
    }

    const ville = extractCity(question);
    if (!ville) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ville introuvable dans la requête' }) };
    }
    console.log('🔎 Ville extraite =', ville);

    /* ====== ETAPE 1 : SUPABASE D’ABORD ====== */
    try {
      const { data, error } = await supabase
        .from('coworking')
        .select('id, nom, ville, pays, prix, adresse, description')
        // on cherche d'abord par "ville", mais on accepte aussi une occurrence dans "nom"
        .or(`ville.ilike.%${ville}%,nom.ilike.%${ville}%`)
        .limit(8);

      if (error) {
        console.error('❌ Supabase error:', error);
        throw error;
      }

      if (Array.isArray(data) && data.length > 0) {
        console.log(`✅ DB hits: ${data.length}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reponse: formatDbAnswer(data, ville),
            source: 'database',
            count: data.length,
          })
        };
      } else {
        console.log('ℹ️ DB: aucun résultat, on passe au web');
      }
    } catch (e) {
      console.error('⚠️ DB indisponible, fallback web. Détail:', e?.message || e);
    }

    /* ====== ETAPE 2 : INTERNET (fallback) ====== */
    try {
      const query = `coworking ${ville}`;
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=5&hl=fr&gl=fr&api_key=${SERPAPI_KEY}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`SerpAPI HTTP ${r.status}`);
      const j = await r.json();
      const items = (j.organic_results || []).slice(0, 3);

      if (items.length > 0) {
        const txt = items.map((it, i) => {
          const snippet = (it.snippet || '').slice(0, 120);
          return `${i+1}. **${it.title}**\n   🔗 ${it.link}\n   📄 ${snippet}${snippet.length === 120 ? '…' : ''}`;
        }).join('\n\n');

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            reponse: `🌐 **Coworkings trouvés sur internet :**\n\n${txt}\n\n💡 *Notre base s’enrichit quotidiennement*`,
            source: 'internet',
            count: items.length
          })
        };
      }
    } catch (e) {
      console.error('❌ Web search error:', e?.message || e);
    }

    /* ====== ETAPE 3 : FALLBACK FINAL ====== */
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reponse:
`Désolé, je n’ai rien trouvé pour **${ville}** pour le moment.
💡 Essayez une autre formulation (ex. “Trouve 3 coworkings à ${ville} centre”).`,
        source: 'fallback'
      })
    };

  } catch (err) {
    console.error('❌ Handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
