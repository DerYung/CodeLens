// Serverless function: asks Claude which files are most worth documenting and
// returns a JSON array of recommended file paths.

import { logError, rejectIfUnauthorized, type ApiResponse } from './_lib'

interface RecommendRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body: { filePaths: string[] }
}

interface AnthropicResponse {
  content: { text: string }[]
}

export default async function handler(
  req: RecommendRequest,
  res: ApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (rejectIfUnauthorized(req.headers?.['x-app-token'], res)) return

  const { filePaths } = req.body

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `Here are the files in a project:
${filePaths.join('\n')}

Identify the 5-10 most important files for understanding this codebase.
Reply ONLY with a JSON array of file paths, nothing else.
Example: ["src/App.tsx", "src/contexts/AuthContext.tsx"]`
          }
        ]
      })
    })

    const data = (await response.json()) as AnthropicResponse
    const text = data.content[0].text
    const clean = text.replace(/```json\n?|\n?```/g, '').trim()
    const recommended = JSON.parse(clean)
    res.json({ recommended })
  } catch (err) {
    logError('recommend failed', err)
    res.status(500).json({ error: 'Failed to get recommendations' })
  }
}
