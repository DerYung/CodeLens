export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { files } = req.body // [{ path, content }]

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

${files.map((f: any) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

For each file, provide:
1. **Purpose** - What this file does in 1-2 sentences
2. **Key Functions/Components** - List and explain each one
3. **Dependencies** - What it imports and why
4. **Notes for new developers** - Things to know before touching this file

Format the output in clean Markdown.`
      }]
    })
  })

  const data = await response.json()
  const text = data.content[0].text
  res.json({ documentation: text })
}