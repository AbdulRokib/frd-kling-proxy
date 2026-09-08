// FRD real Kling VIDEO — proxy function
export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }

  const apiKey = process.env.KLING_API_KEY;
  if (!apiKey) {
    return response.status(500).json({
      error: 'KLING_API_KEY is not set on the server. Add it in Vercel → Project Settings → Environment Variables.'
    });
  }

  const { task_id, contents, settings, options } = request.body || {};

  try {
    // ---- POLL an existing task ----
    if (task_id) {
      // NOTE: Polling path updated from model route to the dedicated v1 query route
      const pollResponse = await fetch(
        `https://api-singapore.klingai.com/v1/videos/omni-video/${task_id}`,
        { 
          method: 'GET',
          headers: { 
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          } 
        }
      );
      
      const data = await pollResponse.json();
      
      if (!pollResponse.ok) {
        return response.status(pollResponse.status).json({
          error: `Kling Video poll error ${pollResponse.status}`,
          detail: data
        });
      }
      return response.status(200).json(data);
    }

    // ---- START a new video generation task ----
    if (!contents) {
      return response.status(400).json({ error: 'Missing "contents" in request body.' });
    }

    const klingResponse = await fetch('https://api-singapore.klingai.com/v1/videos/omni-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model_name: 'kling-3.0-omni',
        contents,
        settings: settings || { resolution: '1080p', aspect_ratio: '16:9', duration: 5, audio: 'off', multi_shot: false },
        options: options || { external_task_id: '' }
      })
    });

    const data = await klingResponse.json();

    if (!klingResponse.ok) {
      return response.status(klingResponse.status).json({
        error: `Kling Video API error ${klingResponse.status}`,
        detail: data
      });
    }

    return response.status(200).json(data);

  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
