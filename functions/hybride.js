const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, orderBy, limit } = require('firebase/firestore');

// Configuration Firebase - REMPLACEZ PAR VOS VRAIES VALEURS
const firebaseConfig = {
  apiKey: "AIzaSyAgOGUu9kN1BNJ-NdsW08_ae1jDbWD1VBk",
  authDomain: "worktripps.firebaseapp.com",
  projectId: "worktripps",
  storageBucket: "worktripps.firebasestorage.app",
  messagingSenderId: "7411770073",
  appId: "1:7411770073:web:6a80923c19200c136bdf38",
  measurementId: "G-JY8XTFFE083"
};

// Variables d'environnement
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// Initialisation Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Dictionnaire de normalisation des villes
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
    
    // 1. Extraction et normalisation de la ville
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
    
    // Nettoyage de la ville
    villeBrute = villeBrute
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    
    const villeNormalisee = VILLE_NORMALISATION[villeBrute] || villeBrute;
    
    console.log("Ville extraite:", villeBrute, "→ Normalisée:", villeNormalisee);
    
    // 2. Recherche dans Firebase Firestore
    let firebaseData = [];
    let firebaseSuccess = false;
    
    if (villeNormalisee && villeNormalisee.length > 2) {
      try {
        console.log("Recherche Firebase pour:", villeNormalisee);
        
        // Référence à la collection coworking
        const coworkingRef = collection(db, 'coworking');
        
        // Requête 1 : Recherche exacte dans le champ 'visit'
        try {
          const q1 = query(
            coworkingRef, 
            where('visit', '==', villeNormalisee),
            limit(5)
          );
          const querySnapshot1 = await getDocs(q1);
          
          querySnapshot1.forEach((doc) => {
            firebaseData.push({ id: doc.id, ...doc.data() });
          });
          
          console.log("Résultats recherche exacte:", firebaseData.length);
        } catch (error1) {
          console.log("Erreur recherche exacte:", error1.message);
        }
        
        // Requête 2 : Si pas de résultats, recherche plus large
        if (firebaseData.length === 0) {
          try {
            const q2 = query(coworkingRef, limit(10));
            const querySnapshot2 = await getDocs(q2);
            
            querySnapshot2.forEach((doc) => {
              const data = doc.data();
              // Filtrage côté client pour recherche partielle
              if (data.visit && data.visit.toLowerCase().includes(villeNormalisee) ||
                  data.name && data.name.toLowerCase().includes(villeNormalisee)) {
                firebaseData.push({ id: doc.id, ...data });
              }
            });
            
            console.log("Résultats recherche large:", firebaseData.length);
          } catch (error2) {
            console.log("Erreur recherche large:", error2.message);
          }
        }
        
        if (firebaseData.length > 0) {
          firebaseSuccess = true;
          console.log("Succès Firebase - Résultats trouvés:", firebaseData.length);
        }
        
      } catch (firebaseError) {
        console.error("Erreur générale Firebase:", firebaseError.message);
      }
    } else {
      console.log("Ville non détectée ou trop courte pour Firebase");
    }

    // 3. Si Firebase a des résultats
    if (firebaseSuccess && firebaseData.length > 0) {
      console.log("Génération de réponse depuis Firebase...");
      
      const firebaseInfo = firebaseData.slice(0, 5).map((item, i) => 
        `${i+1}. **${item.name}** - ${item.visit || 'Adresse non spécifiée'} - ${item.date || 'Prix sur demande'}`
      ).join('\n');
      
      const prompt = `L'utilisateur cherche: "${question}". 
      Voici des coworkings de notre base exclusive Firebase:

      ${firebaseInfo}

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
        reply += "\n\n🔥 **Source**: Notre base Firebase de coworkings partenaires";
        
        return { statusCode: 200, headers, body: JSON.stringify({ reponse: reply }) };
        
      } catch (aiError) {
        console.error("Erreur OpenAI:", aiError);
        // Fallback sans IA
        let manualReply = "🏢 **Coworkings trouvés dans notre base:**\n\n";
        firebaseData.slice(0, 5).forEach((item, i) => {
          manualReply += `${i+1}. **${item.name}**\n   📍 ${item.visit || 'Adresse non spécifiée'}\n   💰 ${item.date || 'Prix sur demande'}\n\n`;
        });
        manualReply += "🔥 **Source**: Notre base Firebase de coworkings partenaires";
        
        return { statusCode: 200, headers, body: JSON.stringify({ reponse: manualReply }) };
      }
    }
    
    // 4. Fallback - Recherche internet
    console.log("Aucun résultat Firebase - Recherche internet...");
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
        internetResults += "\n💡 **Info**: Ces résultats viennent de sources externes. Notre base Firebase grandit chaque jour !";
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
          reponse: "❌ Impossible d'accéder aux données pour le moment. Notre équipe enrichit constamment notre base Firebase !" 
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
