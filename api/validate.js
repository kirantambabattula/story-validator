export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, type } = req.body;
  if (!text || text.trim().length < 10)
    return res.status(400).json({ error: 'Please provide a valid user story or epic (min 10 chars).' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured. Set ANTHROPIC_API_KEY.' });

  const systemPrompt = `You are an expert Agile coach. Evaluate user stories and epics and return ONLY valid JSON — no markdown fences, no preamble.`;

  const userPrompt = `Evaluate this ${type || 'user story or epic'} against Agile best practices.

SUBMISSION:
"""
${text.trim()}
"""

Return ONLY this exact JSON structure with no extra text:
{
  "type": "user_story" or "epic",
  "overallScore": <integer 0-100>,
  "dimensions": [
    { "name": "INVEST / Strategic Clarity", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Persona & Role", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Goal & Action", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Benefit & Outcome", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Acceptance Criteria", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Clarity & Precision", "score": <0-100>, "comment": "<1-2 sentence assessment>" },
    { "name": "Scope Appropriateness", "score": <0-100>, "comment": "<1-2 sentence assessment>" }
  ],
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "improvements": ["<specific gap 1>", "<specific gap 2>", "<specific gap 3>"],
  "recommendedChanges": [
    {
      "id": "rc1",
      "category": "Persona",
      "priority": "high",
      "issue": "<brief description of what is missing or wrong>",
      "change": "<exact text to add or replace>",
      "impact": "<what score dimension this fixes and estimated score lift, e.g. +8 pts>"
    }
  ],
  "rewrite": "<improved version — As a [persona], I want [action] so that [benefit]. Include 3-5 acceptance criteria as lines starting with AC:. For epics, write epic statement plus scope.>"
}

Generate exactly 4-6 recommendedChanges. Each must be actionable and specific. Priority must be one of: high, medium, low.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      console.error('Anthropic error:', await response.text());
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Failed to process validation. Please try again.' });
  }
}
