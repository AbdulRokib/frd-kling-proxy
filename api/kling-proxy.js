// FRD real Kling — proxy function
//
// CONFIRMED WORKING (31 Aug 2026). Real, task-based async API — submits a task, then polls
// for completion. Kling signals success/failure via `code` inside the JSON body, not just
// HTTP status. maxDuration extended to 60s (Vercel's free-tier default of 10s would cut off
// the polling loop otherwise).
//
// Your real Kling API key lives here, as an environment variable in Vercel.
export const config = {
  maxDuration: 60,
};
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
  const { prompt, imageUrls } = request.body || {};
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
    const requestBody = {
      model: 'kling-image-o1',
      prompt: prompt,
      aspect_ratio: '16:9',
      n: 1
    };
    // If a reference image (or images) is passed in, include it — used for Multi-Cam/Pose/
    // Quick Setup edit calls, not the base single-word generation. UNCONFIRMED whether Kling
    // accepts a base64 data URI here or strictly requires a real hosted URL — this is the
    // real, live test for that question, same approach as everything else in this build.
    if (imageUrls && imageUrls.length > 0) {
      requestBody.image_urls = imageUrls;
    }
    const klingResponse = await fetch('https://api-singapore.klingai.com/v1/images/omni-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(requestBody)
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
    // 2. Poll task status until complete (up to 50 seconds)
    let imageUrl = null;
    for (let i = 0; i < 25; i++) {
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

    // Fetch the actual image bytes server-side and convert to a data URI — the browser then
    // sees this as embedded, same-origin data rather than a foreign hosted URL, which avoids
    // a "tainted canvas" error when the panel-promote/crop code later draws it onto a canvas.
    const imageBytesResponse = await fetch(imageUrl);
    const imageArrayBuffer = await imageBytesResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageArrayBuffer).toString('base64');
    const dataUri = `data:image/png;base64,${imageBase64}`;

    // Return in the exact shape your HTML script expects
    return response.status(200).json({
      url: dataUri,
      data: [{ url: dataUri }]
    });
  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
