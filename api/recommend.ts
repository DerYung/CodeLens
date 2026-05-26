export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { filePaths } = req.body

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

  const data = await response.json()
  console.log('Claude response:', JSON.stringify(data, null, 2))
  const text = data.content[0].text
  const clean = text.replace(/```json\n?|\n?```/g, '').trim()
  const recommended = JSON.parse(clean)

  res.json({ recommended })
}