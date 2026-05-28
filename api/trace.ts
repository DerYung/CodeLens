// Serverless function: asks Claude to identify 1-2 important user-facing flows
// and return each as Mermaid `flowchart TD` syntax for visual rendering.

interface SourceFile {
  path: string
  content: string
}

interface TraceRequest {
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

const TRACE_PROMPT = `You are a code flow analysis expert. Identify the 1-2 most important user-facing flows in this codebase (for example: login, registration, form submission, payment, or a key API route).

For each flow:
1. Start from an entry point — a button handler, form submit, API route, or auth action.
2. Trace the call chain across files, function by function.
3. Express the chain as Mermaid \`flowchart TD\` syntax.

Each node MUST show the function name in bold and the file name smaller below, exactly in this shape:
A["<b>handleLogin()</b><br/><small>LoginScreen.tsx</small>"] --> B["<b>signIn()</b><br/><small>AuthContext.tsx</small>"]

Keep node labels concise — each line should be roughly 25 characters or less. If a function name is long, shorten it to its essential part (e.g. use "supabase.from(memberships)" instead of the full chained call). If a label still needs more than ~25 characters, break it across lines with <br/>.

Reply ONLY with a JSON array, no other text. Each element has a "title" (string) and a "mermaid" (string, a complete flowchart TD diagram). Example:
[{ "title": "User Login Flow", "mermaid": "flowchart TD\\n    A[\\"<b>handleLogin()</b><br/><small>LoginScreen.tsx</small>\\"] --> B[\\"<b>signIn()</b><br/><small>AuthContext.tsx</small>\\"]" }]

If there is no clear user-facing flow, reply with an empty array: []`

// Pull a JSON array out of a model reply that may include code fences or
// surrounding prose, by slicing between the first '[' and last ']'.
function extractJsonArray(text: string): string {
  const stripped = text.replace(/```json\n?|\n?```/g, '').trim()
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  return start !== -1 && end !== -1 ? stripped.slice(start, end + 1) : stripped
}

export default async function handler(
  req: TraceRequest,
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
          content: `${TRACE_PROMPT}

${files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}`
        }]
      })
    })

    const data = (await response.json()) as AnthropicResponse
    const text = data.content[0].text
    const flows = JSON.parse(extractJsonArray(text))
    res.json({ flows })
  } catch (err) {
    console.error('trace failed', err)
    res.status(500).json({ error: 'Failed to trace flows' })
  }
}
