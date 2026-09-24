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
  const { prompt, imageUrl, imageUrls, elementIds, resolution } = request.body || {};
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
    // Kling's own API confirmed (live, 31 Aug 2026): prompt length must be under 2500 characters
    // (error code 1201, "size must be between 0 and 2500"). The full FRD art-direction prompt
    // occasionally exceeds this depending on mood/scene complexity — truncated here with margin
    // to prevent the error, rather than letting it fail intermittently.
    const safePrompt = prompt.length > 2400 ? prompt.slice(0, 2400) : prompt;
    // FIXED 24 Sep 2026 against Kling's official Omni Image schema: the field is `model_name`,
    // not `model`. The old `model` key was silently ignored — generation only worked because
    // model_name defaults to kling-image-o1 (which also means the earlier "kling-v3-omni" attempt
    // never actually switched models).
    const requestBody = {
      model_name: 'kling-image-o1',
      prompt: safePrompt,
      aspect_ratio: '16:9',
      n: 1
    };
    // Optional output resolution (Kling's schema: '1k' default, '2k', '4k'). Used for grid
    // conversions, which get cropped into panels and need the extra pixels.
    if (['1k', '2k', '4k'].includes(resolution)) {
      requestBody.resolution = resolution;
    }
    // References — FIXED 24 Sep 2026 against Kling's official Omni Image schema. The only
    // documented field is `image_list: [{ image: <URL or Base64> }]`. The previous `image_url` /
    // `image_urls` keys don't exist in the schema and were silently dropped, which is why all three
    // earlier reference attempts were "accepted but ignored". The prompt must also cite each image
    // as <<<image_1>>>, <<<image_2>>>... — that's done browser-side. Base64 is sent without the
    // data-URI prefix. Formats: jpg/jpeg/png only, ≤10MB, ≥300px, aspect between 1:2.5 and 2.5:1.
    const toKlingImage = (src) => String(src).replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
    const refs = imageUrl ? [imageUrl] : (Array.isArray(imageUrls) ? imageUrls : []);
    if (refs.length > 0) {
      requestBody.image_list = refs.map(src => ({ image: toKlingImage(src) }));
    }
    // Element Library IDs (optional, for the Element route) — `element_list: [{ element_id }]`.
    // IDs are 64-bit, so they're passed as strings from the browser and inserted as bare numbers
    // below to avoid JavaScript rounding them. Refs + elements combined must not exceed 10.
    const elementIdList = Array.isArray(elementIds) ? elementIds.map(String).filter(id => /^\d+$/.test(id)) : [];
    const klingResponse = await fetch('https://api-singapore.klingai.com/v1/images/omni-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: elementIdList.length > 0
        ? JSON.stringify({ ...requestBody, element_list: '__ELEMENTS__' })
            .replace('"__ELEMENTS__"', '[' + elementIdList.map(id => '{"element_id":' + id + '}').join(',') + ']')
        : JSON.stringify(requestBody)
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
    let resultImageUrl = null;
    for (let i = 0; i < 27; i++) {
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
        resultImageUrl = checkData.data?.task_result?.images?.[0]?.url;
        break;
      } else if (status === 'failed') {
        return response.status(500).json({ error: 'Kling task failed', detail: checkData });
      }
    }
    if (!resultImageUrl) {
      return response.status(504).json({ error: 'Kling generation timed out.' });
    }
    // Return in the exact shape your HTML script expects
    return response.status(200).json({
      url: resultImageUrl,
      data: [{ url: resultImageUrl }]
    });
  } catch (err) {
    return response.status(500).json({ error: 'Proxy failed to reach Kling.', detail: String(err) });
  }
}
