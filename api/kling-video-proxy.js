// FRD real Kling VIDEO — proxy function (separate from kling-proxy.js, which handles images
// only and is left untouched). Same reason this exists: browsers can't call Kling's API
// directly (CORS), servers can. Your browser calls THIS, this calls Kling, the answer comes
// back through this to your browser. Uses the SAME KLING_API_KEY environment variable already
// set in Vercel for the image proxy — one Kling account, one key, covers both.
//
// Handles two jobs in one endpoint, distinguished by the request body:
//   - No "task_id" in the body  -> START a new video generation (POST to Kling)
//   - "task_id" present in the body -> POLL that task's status (GET from Kling)
// This mirrors how the browser-side code needs to call it: once to start, then repeatedly to
// check progress, all through this one proxy URL.
//
// IMPORTANT — genuinely untested pieces, flagged honestly: the exact shape of a reference-image
// entry inside "contents" (inferred by analogy to Kling's confirmed "feature_video" shape, since
// no official example showing "refer_image" directly was found), whether Kling's "url" field
// accepts a base64 data URI or requires a real hosted https:// link, and the exact poll-endpoint
// path (inferred by pattern). The first live call's real response/error is what actually
// confirms or corrects these — this proxy passes Kling's raw response straight through
// unmodified specifically so that real error text reaches the browser console for exactly that
// reason.

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
      const pollResponse = await fetch(
        `https://api-singapore.klingai.com/omni-video/kling-3.0-omni/${task_id}`,
        { headers: { 'Authorization': 'Bearer ' + apiKey } }
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

    const klingResponse = await fetch('https://api-singapore.klingai.com/omni-video/kling-3.0-omni', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
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

    // Pass Kling's real response straight through, unmodified — the browser-side code needs
    // to see the actual field names (task_id vs data.task_id, etc.) to confirm or correct the
    // untested assumptions noted above.
    return response.status(200).json(data);

  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
