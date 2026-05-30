// Serverless function: sends a batch of files to Claude and returns generated
// Markdown documentation describing them.

import { logError, rejectIfUnauthorized, type ApiResponse } from './_lib'

interface SourceFile {
  path: string
  content: string
}

interface AnalyzeRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body: { files: SourceFile[] }
}

interface AnthropicResponse {
  content: { text: string }[]
}

export default async function handler(
  req: AnalyzeRequest,
  res: ApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (rejectIfUnauthorized(req.headers?.['x-app-token'], res)) return

  const { files } = req.body

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
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are a code documentation expert. Analyze these files and generate clear documentation for someone new to this codebase.

${files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

For each file, provide:
1. **Purpose** - What this file does in 1-2 sentences
2. **Key Functions/Components** - List and explain each one
3. **Dependencies** - What it imports and why
4. **Notes for new developers** - Things to know before touching this file
5. **Business Rules & Design Intent** - Infer the *why* behind the code, not just the *what*. Examples: pricing tiers and why they differ, validation rules and what they prevent, forced user flows and the business reason, fallback behaviors and their intent. If the file has no inferable business logic (e.g. a pure UI component), write "No specific business rules — this is structural/presentational."

Format the output in clean Markdown.`
        }]
      })
    })

    const data = (await response.json()) as AnthropicResponse
    const text = data.content[0].text
    res.json({ documentation: text })
  } catch (err) {
    logError('analyze failed', err)
    res.status(500).json({ error: 'Failed to generate documentation' })
  }
}
