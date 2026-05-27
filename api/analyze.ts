// Serverless function: sends a batch of files to Claude and returns generated
// Markdown documentation describing them.

interface SourceFile {
  path: string
  content: string
}

interface AnalyzeRequest {
  method?: string
  body: { files: SourceFile[] }
}

interface ApiResponse {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
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

Format the output in clean Markdown.`
        }]
      })
    })

    const data = (await response.json()) as AnthropicResponse
    const text = data.content[0].text
    res.json({ documentation: text })
  } catch (err) {
    console.error('analyze failed', err)
    res.status(500).json({ error: 'Failed to generate documentation' })
  }
}
