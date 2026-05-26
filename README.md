# CodeLens

> Your codebase, documenting itself.

AI-powered documentation generator that turns any project folder into clear, structured docs in seconds. No CLI, no setup, no prompt engineering required.

**Live Demo:** [https://code-lens-ebon.vercel.app](https://code-lens-ebon.vercel.app)

---

## What It Does

Upload a project folder → AI scans the structure → recommends the most important files → generates a clean Markdown documentation you can copy or download.

Built for:
- New hires joining a team and trying to understand the codebase
- Freelancers inheriting client projects with no documentation
- Non-technical PMs who need to understand what their engineers built

---

## How It Works

```
1. Drop or select your project folder
2. AI recommends the key files worth documenting
3. Confirm or adjust the selection
4. Get clean Markdown documentation — copy or download
```

Behind the scenes, CodeLens runs a three-stage pipeline:

- **Stage B (scan):** Claude reads only the file names to identify the most important files
- **Stage C (select):** Recommended files are pre-checked; user can adjust
- **Stage A (analyze):** Selected files are sent to Claude in batches of 3–4 to avoid token limits, then merged into one document

---

## Tech Stack

| Layer | Technology |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Markdown rendering | React Markdown |
| API proxy | Vercel Serverless Functions |
| AI | Claude API (Sonnet) |
| Deployment | Vercel |

---

## Running Locally

### Prerequisites
- Node.js 18+
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Setup

```bash
git clone https://github.com/DerYung/CodeLens.git
cd CodeLens
npm install
```

Create a `.env.local` file in the root:

```
ANTHROPIC_API_KEY=your_api_key_here
```

### Run

Open two terminals.

**Terminal 1 — local API server:**
```bash
npx tsx --env-file=.env.local server.ts
```

**Terminal 2 — frontend:**
```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

---

## Project Structure

```
codelens/
├── api/                    # Vercel Serverless Functions (production)
│   ├── recommend.ts        # Recommends important files
│   └── analyze.ts          # Generates documentation
├── src/
│   ├── App.tsx             # Main app with stage management
│   ├── components/         # UI components
│   └── store/              # Zustand state
├── server.ts               # Local Express dev server (mirrors api/)
└── vite.config.ts
```

> **Note:** `server.ts` and the files under `api/` implement the same logic. The Express server is for local development; the Vercel functions handle production. Any change to one must be mirrored in the other.

---

## Built For

Shortcut Asia Internship Challenge 2026

---

## License

MIT