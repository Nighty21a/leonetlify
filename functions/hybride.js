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
    
    // 1. Extraction du nombre demandé
    let nombreDemande = 5; // Par défaut
    const nombreMatch = question.match(/(\d+)/);
    if (nombreMatch) {
      nombreDemande = Math.min(parseInt(nombreMatch[1]), 10); // Maximum 10
      console.log("Nombre demandé:", nombreDemande);
    }
    
    // 2. Extraction et normalisation de la ville
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
    
    // 3. Détection du type de recherche
    const isCoworking = /coworking|espace|bureau|travail/i.test(question);
    const isActivite = /trucs?|activité|voir|faire|visiter|restaurant|musée|attraction|château|bar|temple|guinness|activités/i.test(question);
    
    let collectionName = 'coworking'; // Par défaut
    let searchQuery = `coworking ${villeNormalisee || question}`;
    
    if (isActivite && !isCoworking) {
      collectionName = 'activites'; // Nouvelle collection
      searchQuery = `activités choses à faire ${villeNormalisee || question}`;
      console.log("Recherche d'activités détectée");
    } else {
      console.log("Recherche de coworkings détectée");
    }
    
    // 4. Recherche dans Firebase Firestore
    let firebaseData = [];
    let firebaseSuccess = false;
    
    if (villeNormalisee && villeNormalisee.length > 2) {
      try {
        console.log("Recherche Firebase pour:", villeNormalisee, "dans", collectionName);
        
        // Référence à la collection (coworking ou activites)
        const collectionRef = collection(db, collectionName);
        
        // Requête 1 : Recherche exacte dans le champ 'visit'
        try {
          const q1 = query(
            collectionRef, 
            where('visit', '==', villeNormalisee),
            limit(nombreDemande + 2)
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
            const q2 = query(collectionRef, limit(nombreDemande + 5));
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

    // 5. Logique hybride : Firebase + Internet pour le nombre demandé
    let finalResults = [];
    let firebaseCount = 0;
    let internetCount = 0;
    const MAX_RESULTS = nombreDemande;
    
    // Étape 5a : Ajouter les résultats Firebase
    if (firebaseSuccess && firebaseData.length > 0) {
      firebaseCount = Math.min(firebaseData.length, MAX_RESULTS);
      finalResults = firebaseData.slice(0, firebaseCount);
      console.log(`Ajout de ${firebaseCount} résultats Firebase`);
    }
    
    // Étape 5b : Compléter avec Internet si besoin
    let internetData = [];
    if (finalResults.length < MAX_RESULTS) {
      internetCount = MAX_RESULTS - finalResults.length;
      console.log(`Recherche internet pour ${internetCount} résultats supplémentaires...`);
      
      const apiUrl = `https://serpapi.com/search?api_key=${SERPAPI_KEY}&engine=google&q=${encodeURIComponent(searchQuery)}&hl=fr&gl=fr`;
      
      try {
        const apiResponse = await fetch(apiUrl);
        const searchData = await apiResponse.json();
        
        if (searchData.organic_results?.length > 0) {
          internetData = searchData.organic_results.slice(0, internetCount).map(result => ({
            name: result.title,
            visit: villeNormalisee || 'Adresse web',
            date: 'Voir site',
            link: result.link,
            snippet: result.snippet,
            source: 'internet'
          }));
          console.log(`Trouvé ${internetData.length} résultats internet`);
        }
      } catch (internetError) {
        console.log("Erreur recherche internet:", internetError.message);
      }
    }
    
    // Étape 5c : Construire la réponse combinée
    if (finalResults.length > 0 || internetData.length > 0) {
      let combinedReply = "";
      
      // Section Firebase
      if (finalResults.length > 0) {
        const titre = collectionName === 'activites' ? "🎯 **Activités de notre base partenaire:**" : "🏢 **Coworkings de notre base partenaire:**";
        combinedReply += titre + "\n\n";
        finalResults.forEach((item, i) => {
          combinedReply += `${i+1}. **${item.name}**\n   📍 ${item.visit}\n   💰 ${item.date}\n   🔒 Partenaire exclusif\n\n`;
        });
      }
      
      // Section Internet
      if (internetData.length > 0) {
        const titreInternet = collectionName === 'activites' ? "🌍 **Activités trouvées sur internet:**" : "🌍 **Coworkings trouvés sur internet:**";
        combinedReply += titreInternet + "\n\n";
        internetData.forEach((item, i) => {
          const num = finalResults.length + i + 1;
          combinedReply += `${num}. **${item.name}**\n   🔗 [Voir le site](${item.link})\n   📝 ${item.snippet ? item.snippet.substring(0, 100) + '...' : 'Plus d\'infos sur le site'}\n\n`;
        });
      }
      
      // Footer avec statistiques
      const typeResultat = collectionName === 'activites' ? 'activité(s)' : 'coworking(s)';
      combinedReply += `📊 **Résultats**: ${finalResults.length} ${typeResultat} partenaire(s) + ${internetData.length} internet = ${finalResults.length + internetData.length} total\n`;
      combinedReply += `🔥 **Demandé**: ${nombreDemande} résultat(s) | **Source**: Firebase + Internet\n`;
      combinedReply += "💡 Notre base grandit chaque jour avec de nouveaux partenaires !";
      
      return { statusCode: 200, headers, body: JSON.stringify({ reponse: combinedReply }) };
    }
    
    // 6. Si aucun résultat trouvé
    const typeRecherche = collectionName === 'activites' ? 'activités' : 'coworkings';
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        reponse: `❌ Aucun ${typeRecherche} trouvé pour cette recherche. Essayez avec une autre ville ou ajoutez plus de données à notre base !` 
      }) 
    };
    
  } catch (err) {
    console.error('Erreur globale:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Erreur interne: ' + err.message }) 
    };
  }
};
