const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // ✅ Headers CORS - À ajouter en premier
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET'
  };

  // ✅ Gérer les requêtes OPTIONS (preflight CORS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // ✅ Vérifier que c'est une requête POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    // ✅ Parser le body de la requête
    const { message } = JSON.parse(event.body);
    
    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message requis' })
      };
    }

    // ✅ Appeler l'API OpenAI
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
            content: 'Tu es Léo, un assistant IA spécialisé dans les conseils pour trouver des lieux de travail, coworkings, restaurants, hôtels et lieux à visiter. Tu donnes des conseils pratiques et personnalisés.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();

    // ✅ Vérifier si la réponse OpenAI est valide
    if (!response.ok) {
      console.error('Erreur OpenAI:', data);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur API OpenAI: ' + (data.error?.message || 'Erreur inconnue') })
      };
    }

    // ✅ Retourner la réponse avec headers CORS
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        reply: data.choices[0].message.content 
      })
    };

  } catch (error) {
    console.error('Erreur fonction:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur interne: ' + error.message 
      })
    };
  }
};
