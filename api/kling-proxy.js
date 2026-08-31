// FRD real Kling — proxy function
//
// This exists purely to work around CORS: browsers block direct calls from an HTML
// file to Kling's API, but servers aren't restricted by CORS at all — so this small
// function sits in the middle. Your browser calls THIS, this calls Kling, Kling's
// answer comes back through this to your browser.
//
// Your real Kling API key lives here, as an environment variable (set in Vercel's own
// dashboard, step-by-step instructions provided separately) — never in the HTML file,
// never visible to anyone who views the page's source. This is more secure than every
// other file in this project, not less.

export default async function handler(request, response) {
  // Allow the browser to actually call this endpoint (this proxy's own CORS headers —
  // safe to leave open here since the real secret, the Kling key, never leaves this server).
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }

  const { prompt } = request.body || {};
  if (!prompt) {
    return response.status(400).json({ error: 'Missing "prompt" in request body.' });
  }

  const apiKey = process.env.KLING_API_KEY;
  if (!apiKey) {
    return response.status(500).json({
      error: 'KLING_API_KEY is not set on the server. Add it in Vercel → Project Settings → Environment Variables.'
    });
  }

  try {
    const klingResponse = await fetch('https://api-singapore.klingai.com/v1/images/omni-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'kling-image-o1',
        prompt: prompt,
        resolution: '2K',
        aspect_ratio: '16:9',
        n: 1
      })
    });

    const data = await klingResponse.json();

    if (!klingResponse.ok) {
      return response.status(klingResponse.status).json({
        error: `Kling Image API error ${klingResponse.status}`,
        detail: data
      });
    }

    // Pass Kling's real response straight through, unmodified — the HTML file's own
    // parsing logic (already built to handle b64_json, url, or a task_id) decides what
    // to do with it, same as it would with a direct call.
    return response.status(200).json(data);

  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
