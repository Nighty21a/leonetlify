export async function handler(event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Méthode non autorisée" }),
      };
    }

    const API_KEY = process.env.OPENAI_API_KEY;
    if (!API_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Clé OpenAI manquante dans Netlify" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const userMessage = body.message || "Bonjour Léo";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Tu es un assistant qui aide à rechercher coworkings, lieux à voir et infos." },
          { role: "user", content: userMessage }
        ],
        max_tokens: 300,
        temperature: 0.5
      }),
    });

    const data = await response.json().catch(() => null);

    if (!data || !data.choices) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Réponse OpenAI invalide", raw: data }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: data.choices[0].message.content
      }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
}
