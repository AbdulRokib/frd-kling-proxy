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
    // 1. Submit task to Kling
    const klingResponse = await fetch('https://api-singapore.klingai.com/v1/images/omni-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'kling-image-o1',
        prompt: prompt,
        aspect_ratio: '16:9',
        n: 1
      })
    });

    const submitData = await klingResponse.json();

    if (!klingResponse.ok || submitData.code !== 0) {
      return response.status(klingResponse.status || 400).json({
        error: `Kling API error`,
        detail: submitData
      });
    }

    const taskId = submitData.data?.task_id;
    if (!taskId) {
      return response.status(500).json({ error: 'No task_id returned by Kling.', detail: submitData });
    }

    // 2. Poll task status until complete (up to 30 seconds)
    let imageUrl = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const checkResponse = await fetch(`https://api-singapore.klingai.com/v1/images/omni-image/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + apiKey
        }
      });

      const checkData = await checkResponse.json();
      const status = checkData.data?.task_status;

      if (status === 'succeed') {
        imageUrl = checkData.data?.task_result?.images?.[0]?.url;
        break;
      } else if (status === 'failed') {
        return response.status(500).json({ error: 'Kling task failed', detail: checkData });
      }
    }

    if (!imageUrl) {
      return response.status(504).json({ error: 'Kling generation timed out.' });
    }

    // Return in the exact shape your HTML script expects
    return response.status(200).json({
      url: imageUrl,
      data: [{ url: imageUrl }]
    });

  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
