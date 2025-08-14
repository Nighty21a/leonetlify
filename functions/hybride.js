const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, orderBy, limit } = require('firebase/firestore');

// Configuration Firebase
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
  "londres": "london", "paris": "paris", "tokyo": "tokyo", "dublin": "dublin",
  "new york": "new york", "berlin": "berlin", "rome": "rome", "madrid": "madrid",
  "barcelone": "barcelona", "barcelona": "barcelona", "amsterdam": "amsterdam",
  "lisbonne": "lisbon", "lisbon": "lisbon", "milan": "milan", "milano": "milan",
  "lyon": "lyon", "marseille": "marseille", "nice": "nice", "toulouse": "toulouse",
  "bordeaux": "bordeaux", "lille": "lille", "nantes": "nantes", "strasbourg": "strasbourg",
  "montpellier": "montpellier"
};

// ======================================
// FONCTION RECHERCHE COWORKINGS
// ======================================
async function rechercheCoworkings(villeNormalisee, nombreDemande) {
  console.log("🏢 RECHERCHE COWORKINGS pour:", villeNormalisee);
  
  let firebaseData = [];
  let firebaseSuccess = false;
  
  if (villeNormalisee && villeNormalisee.length > 2) {
    try {
      const coworkingRef = collection(db, 'coworking');
      const q = query(coworkingRef, limit(50));
      const querySnapshot = await getDocs(q);
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const visitLower = data.visit ? data.visit.toLowerCase() : '';
        const nameLower = data.name ? data.name.toLowerCase() : '';
        
        if (visitLower.includes(villeNormalisee.toLowerCase()) || 
            nameLower.includes(villeNormalisee.toLowerCase()) ||
            visitLower === villeNormalisee.toLowerCase()) {
          firebaseData.push({ id: doc.id, ...data });
        }
      });
      
      firebaseData = firebaseData.slice(0, nombreDemande + 3);
      
      if (firebaseData.length > 0) {
        firebaseSuccess = true;
        console.log("✅ Coworkings Firebase trouvés:", firebaseData.length);
      } else {
        console.log("❌ Aucun coworking Firebase trouvé");
      }
      
    } catch (error) {
      console.error("Erreur Firebase coworkings:", error.message);
    }
  }
  
  return { firebaseData, firebaseSuccess };
}

// ======================================
// FONCTION RECHERCHE ACTIVITÉS
// ======================================
async function rechercheActivites(villeNormalisee, nombreDemande) {
  console.log("🎯 RECHERCHE ACTIVITÉS pour:", villeNormalisee);
  
  let firebaseData = [];
  let firebaseSuccess = false;
  
  if (villeNormalisee && villeNormalisee.length > 2) {
    try {
      const activitesRef = collection(db, 'activites');
      const q = query(activitesRef, limit(50));
      const querySnapshot = await getDocs(q);
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const visitLower = data.visit ? data.visit.toLowerCase() : '';
        const nameLower = data.name ? data.name.toLowerCase() : '';
        
        if (visitLower.includes(villeNormalisee.toLowerCase()) || 
            nameLower.includes(villeNormalisee.toLowerCase()) ||
            visitLower === villeNormalisee.toLowerCase()) {
          firebaseData.push({ id: doc.id, ...data });
        }
      });
      
      firebaseData = firebaseData.slice(0, nombreDemande + 3);
      
      if (firebaseData.length > 0) {
        firebaseSuccess = true;
        console.log("✅ Activités Firebase trouvées:", firebaseData.length);
      } else {
        console.log("❌ Aucune activité Firebase trouvée");
      }
      
    } catch (error) {
      console.error("Erreur Firebase activités:", error.message);
    }
  }
  
  return { firebaseData, firebaseSuccess };
}

// ======================================
// FONCTION RECHERCHE INTERNET
// ======================================
async function rechercheInternet(searchQuery, internetCount) {
  console.log("🌍 RECHERCHE INTERNET pour:", searchQuery, "- Nombre:", internetCount);
  
  let internetData = [];
  
  try {
    const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(searchQuery)}&hl=fr&gl=fr`;
    const apiResponse = await fetch(apiUrl);
    const searchData = await apiResponse.json();
    
    if (searchData.organic_results?.length > 0) {
      internetData = searchData.organic_results.slice(0, internetCount).map(result => ({
        name: result.title,
        visit: 'Internet',
        date: 'Voir site',
        link: result.link,
        snippet: result.snippet,
        source: 'internet'
      }));
      console.log("✅ Résultats internet trouvés:", internetData.length);
    } else {
      console.log("❌ Aucun résultat internet");
    }
  } catch (error) {
    console.log("Erreur recherche internet:", error.message);
  }
  
  return internetData;
}

// ======================================
// FONCTION PRINCIPALE
// ======================================
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
    
    console.log("📝 Question reçue:", question);
    
    // 1. Extraction du nombre demandé
    let nombreDemande = 5;
    const nombreMatch = question.match(/(\d+)/);
    if (nombreMatch) {
      nombreDemande = Math.min(parseInt(nombreMatch[1]), 10);
      console.log("🔢 Nombre demandé:", nombreDemande);
    }
    
    // 2. Extraction de la ville
    const patterns = [
      /(?:coworking|espace|bureau|travail|activité|activités|trucs?|faire|voir).*?(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+)/i,
      /(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+).*?(?:coworking|espace|bureau|travail|activité|activités|trucs?|faire|voir)/i,
      /(?:trouve|cherche|recherche).*?(?:à|in|at|near|près de|nearby|dans)\s+([^.!?,:;]+)/i
    ];
    
    let villeBrute = "";
    for (const pattern of patterns) {
      const match = question.match(pattern);
      if (match && match[1]) {
        villeBrute = match[1].trim().toLowerCase();
        break;
      }
    }
    
    villeBrute = villeBrute.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s+/g, " ").trim();
    const villeNormalisee = VILLE_NORMALISATION[villeBrute] || villeBrute;
    
    console.log("🌍 Ville extraite:", villeBrute, "→ Normalisée:", villeNormalisee);
    
    // 3. Détection du type de recherche
    const isCoworking = /coworking|espace|bureau|travail/i.test(question);
    const isActivite = /trucs?|activité|activités|voir|faire|visiter|restaurant|musée|attraction|château|bar|temple|guinness|choses|que faire|à faire/i.test(question);
    
    let typeRecherche = 'coworking';
    let searchQuery = `coworking ${villeNormalisee || question}`;
    
    if (isActivite && !isCoworking) {
      typeRecherche = 'activites';
      searchQuery = `activités choses à faire ${villeNormalisee || question}`;
      console.log("🎯 TYPE: Recherche d'activités détectée");
    } else {
      console.log("🏢 TYPE: Recherche de coworkings détectée");
    }
    
    // ======================================
    // 4. RECHERCHE SELON LE TYPE
    // ======================================
    
    let firebaseData = [];
    let firebaseSuccess = false;
    
    if (typeRecherche === 'coworking') {
      // SECTION COWORKINGS
      const resultCoworking = await rechercheCoworkings(villeNormalisee, nombreDemande);
      firebaseData = resultCoworking.firebaseData;
      firebaseSuccess = resultCoworking.firebaseSuccess;
    } else {
      // SECTION ACTIVITÉS
      const resultActivites = await rechercheActivites(villeNormalisee, nombreDemande);
      firebaseData = resultActivites.firebaseData;
      firebaseSuccess = resultActivites.firebaseSuccess;
    }
    
    // ======================================
    // 5. LOGIQUE HYBRIDE FIREBASE + INTERNET
    // ======================================
    
    let finalResults = [];
    let internetData = [];
    
    // Étape 5a : Ajouter les résultats Firebase
    if (firebaseSuccess && firebaseData.length > 0) {
      const firebaseCount = Math.min(firebaseData.length, nombreDemande);
      finalResults = firebaseData.slice(0, firebaseCount);
      console.log(`📊 Ajout de ${firebaseCount} résultats Firebase`);
    }
    
    // Étape 5b : Compléter avec Internet si besoin
    if (finalResults.length < nombreDemande) {
      const internetCount = nombreDemande - finalResults.length;
      internetData = await rechercheInternet(searchQuery, internetCount);
    }
    
    // ======================================
    // 6. CONSTRUCTION DE LA RÉPONSE
    // ======================================
    
    if (finalResults.length > 0 || internetData.length > 0) {
      let combinedReply = "";
      
      // Section Firebase
      if (finalResults.length > 0) {
        const titre = typeRecherche === 'activites' ? 
          "🎯 **Activités de notre base partenaire:**" : 
          "🏢 **Coworkings de notre base partenaire:**";
        combinedReply += titre + "\n\n";
        
        finalResults.forEach((item, i) => {
          combinedReply += `${i+1}. **${item.name}**\n   📍 ${item.visit}\n   💰 ${item.date}\n   🔒 Partenaire exclusif\n\n`;
        });
      }
      
      // Section Internet
      if (internetData.length > 0) {
        const titreInternet = typeRecherche === 'activites' ? 
          "🌍 **Activités trouvées sur internet:**" : 
          "🌍 **Coworkings trouvés sur internet:**";
        combinedReply += titreInternet + "\n\n";
        
        internetData.forEach((item, i) => {
          const num = finalResults.length + i + 1;
          combinedReply += `${num}. **${item.name}**\n   🔗 [Voir le site](${item.link})\n   📝 ${item.snippet ? item.snippet.substring(0, 100) + '...' : 'Plus d\'infos sur le site'}\n\n`;
        });
      }
      
      // Footer avec statistiques
      const typeResultat = typeRecherche === 'activites' ? 'activité(s)' : 'coworking(s)';
      combinedReply += `📊 **Résultats**: ${finalResults.length} ${typeResultat} partenaire(s) + ${internetData.length} internet = ${finalResults.length + internetData.length} total\n`;
      combinedReply += `🔥 **Demandé**: ${nombreDemande} résultat(s) | **Source**: Firebase + Internet\n`;
      combinedReply += "💡 Notre base grandit chaque jour avec de nouveaux partenaires !";
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: combinedReply }) };
    }
    
    // 7. Aucun résultat trouvé
    const typeResultat = typeRecherche === 'activites' ? 'activités' : 'coworkings';
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        reponse: `❌ Aucun ${typeResultat} trouvé pour cette recherche. Essayez avec une autre ville ou ajoutez plus de données à notre base !` 
      }) 
    };
    
  } catch (err) {
    console.error('❌ Erreur globale:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Erreur interne: ' + err.message }) 
    };
  }
};
