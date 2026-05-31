import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Info, Target } from 'lucide-react'
import mermaid from 'mermaid'

interface ProjectFile {
  name: string
  path: string
  file: File
}

type Stage = 'upload' | 'select' | 'loading' | 'output'

// Headers for every /api call. The app token (if configured) gates the public
// endpoints against blind bots; it ships in the bundle, so it is not a hard
// secret. See api/_lib.ts.
const apiHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = import.meta.env.VITE_APP_TOKEN
  if (token) headers['x-app-token'] = token
  return headers
}

  const ALLOWED_EXTS = [
    'ts', 'tsx', 'js', 'jsx',
    'py', 'java', 'php', 'rb', 'go',
    'cs', 'rs', 'swift', 'kt', 'cpp', 'c', 'h',
    'json', 'md', 'yaml', 'yml', 'toml', 'env'
  ]

// Directory names whose entire subtree is skipped. Matched per path-segment
// (not substring) so a real folder like `mytarget/` isn't caught by `target`.
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  // Python virtual envs
  'venv', '.venv', 'env', '.env',
  // Python deps / artifacts
  'site-packages', '__pycache__',
  // PHP / Go dependencies
  'vendor',
  // Rust / Java (Maven) build output
  'target',
  // Next / Nuxt build output
  '.next', '.nuxt', 'out',
  // Build caches
  '.cache', '.parcel-cache',
  // Test coverage output
  'coverage',
])
const IGNORED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])
// Compiled artifacts to drop even if their extension were otherwise allowed.
const IGNORED_EXTS = new Set(['pyc'])

// Human-readable group each ignored directory rolls up into, for the
// "files filtered" breakdown shown to users.
const DIR_GROUP: Record<string, string> = {
  node_modules: 'node_modules',
  venv: 'venv / site-packages',
  '.venv': 'venv / site-packages',
  env: 'venv / site-packages',
  '.env': 'venv / site-packages',
  'site-packages': 'venv / site-packages',
  __pycache__: 'venv / site-packages',
  vendor: 'vendor',
  dist: 'build artifacts',
  build: 'build artifacts',
  target: 'build artifacts',
  '.next': 'build artifacts',
  '.nuxt': 'build artifacts',
  out: 'build artifacts',
  '.cache': 'build artifacts',
  '.parcel-cache': 'build artifacts',
  coverage: 'build artifacts',
  '.git': '.git',
}

// Why a file was filtered out, or null if it should be kept. Order mirrors the
// keep/skip precedence so the breakdown counts add up to total − kept.
function filterReason(file: File, path: string): string | null {
  const dirSeg = path.split('/').slice(0, -1).find(seg => IGNORED_DIRS.has(seg))
  if (dirSeg) return DIR_GROUP[dirSeg] ?? 'dependencies'
  if (IGNORED_FILES.has(file.name)) return 'lock files'
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (IGNORED_EXTS.has(ext || '')) return 'venv / site-packages'
  if (!ALLOWED_EXTS.includes(ext || '')) return 'other file types'
  return null
}

type FilterStat = { label: string; count: number }

// A single traced flow: a human title plus its Mermaid `flowchart TD` source.
type Flow = { title: string; mermaid: string }
type FlowState = 'idle' | 'loading' | 'done' | 'error'

// Strip the leading project-root folder so `CodeLens/src/App.tsx` → `src/App.tsx`.
function displayPath(path: string): string {
  const firstSlash = path.indexOf('/')
  return firstSlash === -1 ? path : path.slice(firstSlash + 1)
}

// Split markdown into heading-delimited sections so each can be wrapped with
// `content-visibility: auto` — the browser then skips layout/paint for the
// sections that are off-screen, keeping scroll smooth on very long docs.
// Headings inside fenced code blocks are ignored so blocks never get split.
function splitIntoSections(md: string): string[] {
  const lines = md.split('\n')
  const sections: string[] = []
  let current: string[] = []
  let fenceToken = ''

  for (const line of lines) {
    const fence = line.match(/^\s*(```|~~~)/)?.[1]
    if (fence) {
      if (!fenceToken) fenceToken = fence
      else if (fence === fenceToken) fenceToken = ''
    }

    const isHeading = !fenceToken && /^#{1,6}\s/.test(line)
    if (isHeading && current.some(l => l.trim() !== '')) {
      sections.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length) sections.push(current.join('\n'))
  return sections
}

// Recursively walk a DataTransfer file-system entry (drag-drop folder).
type FsEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file: (cb: (f: File) => void) => void
  createReader: () => { readEntries: (cb: (entries: FsEntry[]) => void) => void }
}

async function walkEntry(
  entry: FsEntry,
  prefix = ''
): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const f = await new Promise<File>(res => entry.file(res))
    return [{ file: f, path: prefix + entry.name }]
  }
  if (entry.isDirectory) {
    const reader = entry.createReader()
    let all: FsEntry[] = []
    // readEntries returns chunks (up to 100 in Chrome) — drain until empty
    while (true) {
      const chunk: FsEntry[] = await new Promise(res => reader.readEntries(res))
      if (!chunk.length) break
      all = all.concat(chunk)
    }
    const nested = await Promise.all(
      all.map(e => walkEntry(e, prefix + entry.name + '/'))
    )
    return nested.flat()
  }
  return []
}

function App(): React.JSX.Element {
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [filterStats, setFilterStats] = useState<FilterStat[]>([])
  const [recommended, setRecommended] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [documentation, setDocumentation] = useState<string>('')
  const [flows, setFlows] = useState<Flow[]>([])
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  const inputRef = useRef<HTMLInputElement>(null)

  const stage: Stage = isLoading
    ? 'loading'
    : documentation
    ? 'output'
    : files.length
    ? 'select'
    : 'upload'

  const fetchRecommended = async (filePaths: string[]) => {
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ filePaths }),
      })
      const data = await res.json()
      // The model returns paths relative to the project root (e.g.
      // "src/App.tsx"), while file.path is the full webkitRelativePath that
      // includes the root folder (e.g. "Project-main/src/App.tsx"). Match each
      // recommended path to a real scanned file by suffix and resolve it to the
      // actual file path, so downstream selection compares like-for-like.
      // Also dedupe and drop hallucinated paths that match no scanned file —
      // otherwise a phantom entry inflates the "selected" count with no
      // checkbox to ever uncheck it.
      const seen = new Set<string>()
      const rec: string[] = []
      for (const p of (data.recommended ?? []) as string[]) {
        const match = filePaths.find(fp => fp === p || fp.endsWith(p))
        if (match && !seen.has(match)) {
          seen.add(match)
          rec.push(match)
        }
      }
      setRecommended(rec)
      setSelected(rec)
    } catch (err) {
      console.error('recommend failed', err)
      setRecommended([])
      setSelected([])
    }
  }

  const ingestRaw = (raw: { file: File; path: string }[]) => {
    const kept: ProjectFile[] = []
    const counts = new Map<string, number>()
    for (const { file, path } of raw) {
      const reason = filterReason(file, path)
      if (reason === null) {
        kept.push({ name: file.name, path, file })
      } else {
        counts.set(reason, (counts.get(reason) ?? 0) + 1)
      }
    }
    setFiles(kept)
    setFilterStats(
      [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
    )
    if (kept.length) fetchRecommended(kept.map(f => f.path))
  }

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Array.from(e.target.files || []).map(f => ({
      file: f,
      path: f.webkitRelativePath || f.name,
    }))
    ingestRaw(raw)
  }

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const items = Array.from(e.dataTransfer.items || [])
    const entries = items
      .map(it => (it.webkitGetAsEntry?.() as FsEntry | null))
      .filter((x): x is FsEntry => !!x)
    if (entries.length) {
      const collected = await Promise.all(entries.map(en => walkEntry(en)))
      ingestRaw(collected.flat())
      return
    }
    // Fallback: plain files
    const fallback = Array.from(e.dataTransfer.files || []).map(f => ({
      file: f,
      path: f.name,
    }))
    if (fallback.length) ingestRaw(fallback)
  }, [])

  const generateDocs = async () => {
    setIsLoading(true)
    setDocumentation('')
    try {
      const selectedFiles = files.filter(f => selected.includes(f.path))
      const fileContents = await Promise.all(
        selectedFiles.map(async f => ({
          path: f.path,
          content: await f.file.text(),
        }))
      )
      const batches: typeof fileContents[] = []
      for (let i = 0; i < fileContents.length; i += 3) {
        batches.push(fileContents.slice(i, i + 3))
      }
      let fullDocs = ''
      for (const batch of batches) {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ files: batch }),
        })
        if (!res.ok) throw new Error(`analyze request failed (${res.status})`)
        const data = await res.json()
        fullDocs += (data.documentation ?? '') + '\n\n'
      }
      setDocumentation(fullDocs.trim())
    } catch (err) {
      console.error('analyze failed', err)
      setDocumentation('# Error\n\nSomething went wrong while generating documentation.')
    } finally {
      setIsLoading(false)
    }
  }

  // Lazily trace flows the first time the user opens the Flow View tab. Reuses
  // the same `selected` files as documentation generation, in one request.
  const traceFlows = async () => {
    setFlowState('loading')
    try {
      const selectedFiles = files.filter(f => selected.includes(f.path))
      const fileContents = await Promise.all(
        selectedFiles.map(async f => ({
          path: f.path,
          content: await f.file.text(),
        }))
      )
      const res = await fetch('/api/trace', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ files: fileContents }),
      })
      if (!res.ok) throw new Error(`trace request failed (${res.status})`)
      const data = await res.json()
      setFlows(Array.isArray(data.flows) ? data.flows : [])
      setFlowState('done')
    } catch (err) {
      console.error('trace failed', err)
      setFlows([])
      setFlowState('error')
    }
  }

  // Return to the file-selection stage, keeping files/recommended/selected so
  // the user can adjust and regenerate. Clearing documentation drops `stage`
  // back to 'select'; flow state is reset so a new selection re-traces.
  const backToSelection = () => {
    setDocumentation('')
    setFlows([])
    setFlowState('idle')
  }

  const reset = () => {
    setFiles([])
    setFilterStats([])
    setRecommended([])
    setSelected([])
    setDocumentation('')
    setFlows([])
    setFlowState('idle')
    setIsLoading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(documentation)
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([documentation], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'documentation.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSelect = (path: string) => {
    setSelected(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    )
  }

  const selectAll = () => setSelected(files.map(f => f.path))
  const selectNone = () => setSelected([])
  const selectRecommended = () => setSelected(recommended)

  return (
    <div className="min-h-screen flex flex-col bg-[#0d1117] text-[#e6edf3]">
      <Header />

      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        {stage === 'upload' && (
          <UploadStage
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
          />
        )}

        {stage === 'select' && (
          <SelectStage
            files={files}
            filterStats={filterStats}
            recommended={recommended}
            selected={selected}
            onToggle={toggleSelect}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            onSelectRecommended={selectRecommended}
            onGenerate={generateDocs}
          />
        )}

        {stage === 'loading' && <LoadingStage />}

        {stage === 'output' && (
          <OutputStage
            documentation={documentation}
            flows={flows}
            flowState={flowState}
            onTrace={traceFlows}
            copyState={copyState}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onBack={backToSelection}
            onReset={reset}
          />
        )}
      </main>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        style={{ display: 'none' }}
        onChange={handleFolderSelect}
        {...({ webkitdirectory: 'true' } as Record<string, string>)}
      />
    </div>
  )
}

/* ─────────────────── Header ─────────────────── */

function Header() {
  return (
    <header className="border-b border-[#30363d] bg-[#0d1117]/80 backdrop-blur supports-[backdrop-filter]:bg-[#0d1117]/60 sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-3">
        <LensLogo />
        <h1 className="text-[#34D399] font-bold tracking-[0.08em] text-sm uppercase">
          CodeLens
        </h1>
      </div>
    </header>
  )
}

// Animated lens mark: two counter-spinning rings around a `< / >` code symbol.
function LensLogo() {
  return (
    <div className="lens-logo relative w-8 h-8 shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]">
      <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
        {/* Outer glow ring */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="url(#lens-grad)"
          strokeWidth="2"
          className="opacity-50"
        />

        {/* Outer spinning ring + focus points */}
        <g className="lens-ring-outer">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#34D399"
            strokeWidth="1.5"
            strokeDasharray="4 8"
            className="opacity-70"
          />
          <circle cx="50" cy="8" r="2" fill="#34D399" />
          <circle cx="50" cy="92" r="2" fill="#34D399" />
          <circle cx="8" cy="50" r="2" fill="#34D399" />
          <circle cx="92" cy="50" r="2" fill="#34D399" />
        </g>

        {/* Inner spinning ring */}
        <g className="lens-ring-inner">
          <circle
            cx="50"
            cy="50"
            r="34"
            fill="none"
            stroke="#6EE7B7"
            strokeWidth="2.5"
            strokeDasharray="1 4"
            className="opacity-50"
          />
        </g>

        {/* Core glass + glare */}
        <circle cx="50" cy="50" r="28" fill="#0d1117" stroke="#30363d" strokeWidth="1.5" />
        <path d="M 30 30 Q 50 15 70 30 A 25 25 0 0 0 30 30" fill="rgba(255,255,255,0.05)" />

        {/* < / > code symbol */}
        <g strokeLinecap="round" strokeLinejoin="round" fill="none" strokeWidth="4">
          <path d="M 40 40 L 30 50 L 40 60" stroke="#34D399" className="lens-bracket-l" />
          <path d="M 55 35 L 45 65" stroke="#6EE7B7" className="lens-slash" />
          <path d="M 60 40 L 70 50 L 60 60" stroke="#34D399" className="lens-bracket-r" />
        </g>

        <defs>
          <linearGradient id="lens-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="50%" stopColor="transparent" />
            <stop offset="100%" stopColor="#6EE7B7" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

/* ─────────────────── Stage 1: Upload ─────────────────── */

function UploadStage({
  isDragging,
  setIsDragging,
  onClick,
  onDrop,
}: {
  isDragging: boolean
  setIsDragging: (v: boolean) => void
  onClick: () => void
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
}) {
  const [showHow, setShowHow] = useState(false)

  return (
    <div
      onDragOver={e => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`hero ${
        isDragging ? 'is-dragging' : ''
      } animate-fade-in flex flex-col justify-center min-h-[72vh] rounded-2xl px-2`}
    >
      <div className="font-mono text-xs tracking-[0.3em] text-[#34D399] uppercase mb-4">
        CodeLens <span className="text-[#6e7681]">//</span> Doc Generator
      </div>

      <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-[#e6edf3] mb-6 leading-[1.05]">
        Your codebase,
        <br />
        documenting itself.
      </h1>

      <p className="font-sans text-lg text-[#8b949e] max-w-xl mb-8 leading-relaxed">
        AI-powered documentation that explains your project from its own
        source. Drop a folder and get clear, structured docs — no config, no
        setup headaches.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <button onClick={onClick} className="hero-btn-primary font-mono text-sm">
          Upload your project
        </button>
        <button
          onClick={() => setShowHow(v => !v)}
          className="hero-btn-secondary font-mono text-sm"
        >
          See how it works
        </button>
      </div>

      {showHow && (
        <div className="animate-fade-in surface rounded-lg mt-6 px-5 py-4 max-w-xl font-mono text-[12px] text-[#8b949e] space-y-2">
          <div>
            <span className="text-[#34D399]">1 ▸</span> Drop or select your
            project folder
          </div>
          <div>
            <span className="text-[#34D399]">2 ▸</span> We recommend the key
            files worth documenting
          </div>
          <div>
            <span className="text-[#34D399]">3 ▸</span> Claude generates clean
            Markdown you can copy or download
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <div className="inline-flex items-center gap-2 font-mono text-[11px] text-[#484f58]">
          <span className="text-[#34D399]">$</span>
          <span>supports</span>
          <code className="text-[#8b949e]">.tsx .ts .js .jsx .py .java .json .md</code>
        </div>
        <div className="font-mono text-[11px] tracking-[0.15em] uppercase text-[#34D399]/60">
          v0.0.0 <span className="opacity-50">·</span> drag &amp; drop anywhere{' '}
          <span className="opacity-50">·</span> powered by claude
        </div>
      </div>
    </div>
  )
}

/* ─────────────────── Stage 2: File Selection ─────────────────── */

// First-visit onboarding tours. Each stage has its own localStorage flag that
// gates whether its tour auto-opens; the "Show tour again" link can replay it
// without clearing the flag.
const ONBOARDING_KEY = 'codelens.onboarding.completed'
const OUTPUT_ONBOARDING_KEY = 'codelens.onboarding.output.completed'

// A single coach-mark step: the target element (resolved lazily so refs are
// read at measure time, not at array-build time) plus its label and copy.
// `onEnter` runs when the step activates — used to e.g. switch the active tab
// so the step's target is on screen before it's measured.
type TourStep = {
  tag: string
  text: string
  get: () => HTMLElement | null
  onEnter?: () => void
}

const FILTER_TOOLTIPS: Record<string, string> = {
  'node_modules': 'JavaScript dependencies installed by npm — generated automatically, not your actual code.',
  'venv / site-packages': 'Python virtual environment files — external libraries installed automatically, not part of your project.',
  'vendor': 'Third-party dependencies (PHP/Go/Ruby) installed automatically — not your project code.',
  'build artifacts': 'Files generated during build (dist, .next, out, coverage) — not source code you wrote.',
  '.git': 'Git version control internals — not source code.',
  'lock files': 'Auto-generated dependency version locks — too long and not useful for documentation.',
  'other file types': 'Files in formats CodeLens does not currently support for analysis.',
}

// Subtle, collapsed-by-default breakdown of what the scanner filtered out.
// Builds trust ("show me what you dropped") without cluttering the header.
function FilteredSummary({ stats }: { stats: FilterStat[] }) {
  const [open, setOpen] = useState(false)
  const total = stats.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="font-mono text-[11px] text-[#6e7681] hover:text-[#8b949e] transition-colors"
      >
        <span className="inline-block w-2.5 text-[9px] align-middle">
          {open ? '▲' : '▼'}
        </span>{' '}
        {total} files filtered
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 min-w-[240px] surface rounded-md px-3 py-2.5 shadow-xl animate-fade-in">
          <ul className="space-y-1.5">
            {stats.map(s => (
              <li
                key={s.label}
                className="flex items-center justify-between gap-6 font-mono text-[11px]"
              >
                <span className="flex items-center gap-1.5 text-[#8b949e]">
                  {s.label}
                  {FILTER_TOOLTIPS[s.label] && (
                    <span className="relative group">
                      <Info size={10} className="text-[#484f58] hover:text-[#6e7681] cursor-default transition-colors" />
                      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-30 w-52 rounded px-2.5 py-2 bg-[#1c2530] border border-[#30363d] text-[10px] text-[#8b949e] leading-relaxed font-sans tracking-normal normal-case opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-xl">
                        {FILTER_TOOLTIPS[s.label]}
                      </span>
                    </span>
                  )}
                </span>
                <span className="text-[#56606b] tabular-nums">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SelectStage({
  files,
  filterStats,
  recommended,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onSelectRecommended,
  onGenerate,
}: {
  files: ProjectFile[]
  filterStats: FilterStat[]
  recommended: string[]
  selected: string[]
  onToggle: (p: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onSelectRecommended: () => void
  onGenerate: () => void
}) {
  // Derive which segment is "active" from the current selection, so manual
  // row toggles keep the segmented control in sync (no separate state).
  const activeFilter = useMemo<'core' | 'all' | 'none' | null>(() => {
    if (selected.length === 0) return 'none'
    if (selected.length === files.length) return 'all'
    const recSet = new Set(recommended)
    if (
      recommended.length > 0 &&
      selected.length === recommended.length &&
      selected.every(p => recSet.has(p))
    ) {
      return 'core'
    }
    return null
  }, [selected, files, recommended])

  const segments = [
    { key: 'core', label: 'Core', onClick: onSelectRecommended },
    { key: 'all', label: 'All', onClick: onSelectAll },
    { key: 'none', label: 'None', onClick: onSelectNone },
  ] as const

  // Track scroll position to fade the bottom only while more rows remain below.
  const listRef = useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = useState(false)

  const updateFade = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > 4
    setShowFade(more)
  }, [])

  useEffect(() => {
    updateFade()
  }, [files, updateFade])

  // ── First-visit onboarding tour ───────────────────────────────
  const filesPanelRef = useRef<HTMLDivElement>(null)
  const selectorsRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const generateRef = useRef<HTMLButtonElement>(null)
  const [showTour, setShowTour] = useState(false)

  // Spotlight the first recommended row's badge (if any recommendations exist).
  const firstRecIdx = useMemo(
    () => files.findIndex(f => recommended.includes(f.path)),
    [files, recommended]
  )

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        tag: 'Scan summary',
        text: 'Hover any filtered category to see what was excluded and why. We filter dependencies and build artifacts so the AI focuses on your actual code.',
        get: () => filesPanelRef.current,
      },
      {
        tag: 'Quick selectors',
        text: 'Quick selectors. CORE picks only the AI-recommended files (recommended for most users). ALL selects every scanned file. NONE clears your selection.',
        get: () => selectorsRef.current,
      },
      ...(firstRecIdx >= 0
        ? [
            {
              tag: 'Core files',
              text: 'Files marked as recommended were identified by AI as the most important — entry points, auth, core logic. You can still adjust your selection manually.',
              get: () => badgeRef.current,
            },
          ]
        : []),
      {
        tag: 'Generate',
        text: 'Sends your selected files to Claude in small batches and returns clean Markdown documentation. Takes about 30 seconds depending on file count.',
        get: () => generateRef.current,
      },
    ],
    [firstRecIdx]
  )

  // Auto-open once per browser, after a short beat so the stage has faded in
  // and the recommendation badges have rendered.
  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === 'true') return
    const t = setTimeout(() => setShowTour(true), 600)
    return () => clearTimeout(t)
  }, [])

  const dismissTour = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setShowTour(false)
  }, [])

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div ref={filesPanelRef} className="flex items-center gap-3">
          <p className="text-[#34D399] text-sm tracking-wide font-mono">
            <span className="mr-1">▶</span> {files.length} files scanned
          </p>
          <FilteredSummary stats={filterStats} />
        </div>

        {/* Segmented filter control */}
        <div
          ref={selectorsRef}
          className="inline-flex items-center gap-0.5 rounded-lg bg-[#121820] border border-[#21262d] p-0.5"
        >
          {segments.map(seg => {
            const active = activeFilter === seg.key
            return (
              <button
                key={seg.key}
                onClick={seg.onClick}
                aria-pressed={active}
                className={`px-3 py-1 rounded-md font-mono text-[11px] uppercase tracking-[0.1em] transition-all ${
                  active
                    ? 'bg-[#1c2530] text-[#34D399] shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                    : 'text-[#6e7681] hover:text-[#e6edf3]'
                }`}
              >
                {seg.label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-[#8b949e] text-xs mb-4 flex items-center gap-1.5">
        <Target size={12} className="text-[#34D399]" />
        Core files are pre-selected. Adjust the selection as needed.
      </p>

      <div className="relative surface rounded-lg overflow-hidden mb-4">
        <div
          ref={listRef}
          onScroll={updateFade}
          className="max-h-[55vh] overflow-y-auto cl-scroll"
        >
          {files.map((file, i) => {
            const isRecommended = recommended.includes(file.path)
            const isSelected = selected.includes(file.path)
            return (
              <FileRow
                key={file.path + i}
                file={file}
                isRecommended={isRecommended}
                isSelected={isSelected}
                onToggle={() => onToggle(file.path)}
                badgeRef={i === firstRecIdx ? badgeRef : undefined}
              />
            )
          })}
        </div>

        {/* Fade-out hint that more rows remain below */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#161b22] to-transparent transition-opacity duration-200 ${
            showFade ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      {/* Sticky CTA — stays visible while the page scrolls */}
      <div className="sticky bottom-0 pt-2 pb-1 bg-gradient-to-t from-[#0d1117] via-[#0d1117] to-transparent">
        <button
          ref={generateRef}
          onClick={onGenerate}
          disabled={selected.length === 0}
          className="cta-btn"
        >
          <span>▶</span>
          <span>
            Generate Documentation ({selected.length} files selected)
          </span>
        </button>
      </div>

      {/* Replay the onboarding tour on demand. Portaled to <body> so it (and
          the tour) escape the `.animate-fade-in` transform, which would
          otherwise act as the containing block for these fixed elements. */}
      {createPortal(
        <button
          onClick={() => setShowTour(true)}
          className="fixed bottom-3 left-3 z-20 inline-flex items-center gap-1 font-mono text-[10px] text-[#484f58] hover:text-[#34D399] transition-colors"
        >
          <span aria-hidden>↻</span> Show tour again
        </button>,
        document.body
      )}

      {showTour && <OnboardingTour steps={tourSteps} onClose={dismissTour} />}
    </div>
  )
}

function CoreBadge({ selected }: { selected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] whitespace-nowrap transition-colors ${
        selected
          ? 'text-[#34D399] bg-[#34D399]/10 border-[#34D399]/30'
          : 'text-[#6e7681] bg-transparent border-[#30363d]'
      }`}
    >
      <Target size={10} strokeWidth={2.5} />
      Core File
    </span>
  )
}

function FileRow({
  file,
  isRecommended,
  isSelected,
  onToggle,
  badgeRef,
}: {
  file: ProjectFile
  isRecommended: boolean
  isSelected: boolean
  onToggle: () => void
  badgeRef?: React.Ref<HTMLSpanElement>
}) {
  const shown = displayPath(file.path)
  const lastSlash = shown.lastIndexOf('/')
  const dir = lastSlash >= 0 ? shown.slice(0, lastSlash + 1) : ''
  const name = lastSlash >= 0 ? shown.slice(lastSlash + 1) : shown

  return (
    <div
      role="checkbox"
      aria-checked={isSelected}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onToggle()
        }
      }}
      className={`file-row ${isSelected ? 'is-selected' : ''} ${
        isRecommended ? 'is-recommended' : ''
      } flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-[#21262d] last:border-b-0 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#34D399]/60`}
    >
      <input
        type="checkbox"
        className="cl-checkbox pointer-events-none"
        checked={isSelected}
        readOnly
        tabIndex={-1}
        aria-hidden
      />
      <span className="flex-1 min-w-0 truncate">
        <span className="text-[#56606b]">{dir}</span>
        <span className="text-[#e6edf3] font-medium">{name}</span>
      </span>
      {isRecommended && (
        <span ref={badgeRef}>
          <CoreBadge selected={isSelected} />
        </span>
      )}
    </div>
  )
}

/* ─────────────────── Onboarding Tour ─────────────────── */

// Vanilla coach-mark overlay: a spotlight cut-out over the current target with
// a tooltip card beside it. The backdrop is pointer-events:none (only the card
// is interactive) so the user can keep clicking the page if they ignore the
// tour. Owns its own step + fade state; calls onClose once fully dismissed.
function OnboardingTour({
  steps,
  onClose,
}: {
  steps: TourStep[]
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [show, setShow] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Steps can shrink/grow if recommendations arrive mid-tour; keep in bounds.
  const clamped = Math.min(step, steps.length - 1)
  const current = steps[clamped]
  const isLast = clamped === steps.length - 1

  // Fade in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Fade out, then unmount via onClose.
  const finish = useCallback(() => {
    setShow(false)
    window.setTimeout(onClose, 200)
  }, [onClose])

  const next = useCallback(() => {
    if (isLast) finish()
    else setStep(s => s + 1)
  }, [isLast, finish])

  const back = useCallback(() => setStep(s => Math.max(0, s - 1)), [])

  // Esc skips the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  // Activate the step, then measure its target and keep the spotlight in sync
  // as the page scrolls or resizes. `onEnter` may change the DOM (e.g. switch
  // tabs), so the target is resolved/measured across animation frames — not
  // synchronously — and scrolled into view (the Core badge can sit inside the
  // scrollable file list).
  useEffect(() => {
    current?.onEnter?.()

    const measure = () => {
      const node = current?.get() ?? null
      setRect(node ? node.getBoundingClientRect() : null)
    }

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      current?.get()?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      measure()
      raf2 = requestAnimationFrame(measure)
    })
    const settle = window.setTimeout(measure, 360)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(settle)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [current])

  // Spotlight box = target rect + a little padding.
  const pad = 6
  const spot = rect && {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }

  // Card sits below the target, or above it when the target is low on screen.
  // Horizontally aligned to the target but clamped on-screen.
  const cardW = Math.min(320, window.innerWidth - 32)
  const gap = 12
  const placeAbove = rect ? rect.top > window.innerHeight * 0.55 : false
  const cardLeft = rect
    ? Math.max(16, Math.min(rect.left, window.innerWidth - cardW - 16))
    : 16
  const cardStyle: React.CSSProperties =
    spot && rect
      ? placeAbove
        ? { left: cardLeft, bottom: window.innerHeight - spot.top + gap, width: cardW }
        : { left: cardLeft, top: spot.top + spot.height + gap, width: cardW }
      : { left: 16, bottom: 16, width: cardW }

  return createPortal(
    <div
      className="fixed inset-0 z-40 transition-opacity duration-200"
      style={{ opacity: show ? 1 : 0, pointerEvents: 'none' }}
    >
      {spot ? (
        <div
          aria-hidden
          className="fixed rounded-lg transition-all duration-300 ease-out"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow:
              '0 0 0 9999px rgba(13,17,23,0.72), 0 0 0 1px rgba(52,211,153,0.55), 0 0 22px -2px rgba(52,211,153,0.45)',
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0" style={{ background: 'rgba(13,17,23,0.72)' }} />
      )}

      <div
        key={clamped}
        role="dialog"
        aria-label={`Onboarding step ${clamped + 1} of ${steps.length}`}
        className="fixed z-50 surface rounded-lg shadow-2xl animate-fade-in pointer-events-auto"
        style={cardStyle}
      >
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#34D399]">
              {current.tag}
            </span>
            <span className="font-mono text-[10px] text-[#6e7681] tabular-nums">
              {clamped + 1} / {steps.length}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-[#c9d1d9] font-sans">
            {current.text}
          </p>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#30363d]">
          <button
            onClick={finish}
            className="font-mono text-[11px] text-[#6e7681] hover:text-[#8b949e] transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-1.5">
            {clamped > 0 && (
              <button
                onClick={back}
                className="font-mono text-[11px] text-[#8b949e] hover:text-[#e6edf3] px-2 py-1 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="font-mono text-[11px] font-semibold rounded-md bg-[#34D399] text-[#0d1117] px-3 py-1 hover:bg-[#10B981] transition-colors"
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ─────────────────── Stage 3: Loading ─────────────────── */

function LoadingStage() {
  const lines = useMemo(
    () => [
      'parsing source tree...',
      'extracting symbols...',
      'reasoning over modules...',
      'composing documentation...',
    ],
    []
  )
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-[#34D399] text-6xl mb-6 animate-hex-pulse select-none">
        ⬡
      </div>
      <p className="text-[#e6edf3] text-base">
        Analysing your codebase<span className="loading-dots" />
      </p>
      <p className="text-[#8b949e] text-xs mt-2">This may take a moment</p>

      <div className="mt-10 surface rounded-lg px-4 py-3 text-[11px] text-[#8b949e] text-left w-full max-w-sm">
        {lines.map((l, i) => (
          <div key={l} className="flex items-center gap-2">
            <span className="text-[#34D399]">
              {i === lines.length - 1 ? '▸' : '✓'}
            </span>
            <span className={i === lines.length - 1 ? 'text-[#e6edf3]' : ''}>
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────── Stage 4: Output ─────────────────── */

function OutputStage({
  documentation,
  flows,
  flowState,
  onTrace,
  copyState,
  onCopy,
  onDownload,
  onBack,
  onReset,
}: {
  documentation: string
  flows: Flow[]
  flowState: FlowState
  onTrace: () => void
  copyState: 'idle' | 'copied'
  onCopy: () => void
  onDownload: () => void
  onBack: () => void
  onReset: () => void
}) {
  const [tab, setTab] = useState<'docs' | 'flow'>('docs')
  const sections = useMemo(() => splitIntoSections(documentation), [documentation])

  // Kick off tracing the first time Flow View is opened.
  const openFlow = useCallback(() => {
    setTab('flow')
    if (flowState === 'idle') onTrace()
  }, [flowState, onTrace])

  // ── Onboarding tour for the results stage ─────────────────────
  const docHeaderRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLSpanElement>(null)
  const navRef = useRef<HTMLSpanElement>(null)
  const flowTabRef = useRef<HTMLButtonElement>(null)
  const [showTour, setShowTour] = useState(false)

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        tag: 'Documentation',
        text: "Your AI-generated documentation, split into sections — each file's purpose, key functions, dependencies, and the business rules behind the code.",
        get: () => docHeaderRef.current,
        onEnter: () => setTab('docs'),
      },
      {
        tag: 'Export',
        text: 'Copy the Markdown to your clipboard, or download it as a .md file to commit straight into your repo.',
        get: () => exportRef.current,
        onEnter: () => setTab('docs'),
      },
      {
        tag: 'Navigate',
        text: 'Go back to adjust your file selection and regenerate, or start over with a brand-new project.',
        get: () => navRef.current,
        onEnter: () => setTab('docs'),
      },
      {
        tag: 'Flow View',
        text: 'Flow View asks Claude to trace your 1–2 most important user flows and renders them as visual flowchart diagrams — showing how functions call across files.',
        get: () => flowTabRef.current,
        onEnter: openFlow,
      },
    ],
    [openFlow]
  )

  useEffect(() => {
    if (localStorage.getItem(OUTPUT_ONBOARDING_KEY) === 'true') return
    const t = setTimeout(() => setShowTour(true), 600)
    return () => clearTimeout(t)
  }, [])

  const dismissTour = useCallback(() => {
    localStorage.setItem(OUTPUT_ONBOARDING_KEY, 'true')
    setShowTour(false)
  }, [])

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-[#34D399] text-sm tracking-wide">
          <span className="mr-1">✓</span> Documentation generated
        </p>
        <div className="flex items-center gap-2">
          {tab === 'docs' && (
            <span ref={exportRef} className="flex items-center gap-2">
              <button
                onClick={onCopy}
                className={`tb-btn ${copyState === 'copied' ? 'is-success' : ''}`}
              >
                {copyState === 'copied' ? (
                  <>
                    <span>✓</span>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <span>📋</span>
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button onClick={onDownload} className="tb-btn">
                <span>⬇</span>
                <span>Download .md</span>
              </button>
            </span>
          )}
          <span ref={navRef} className="flex items-center gap-2">
            <button onClick={onBack} className="tb-btn">
              <span>←</span>
              <span>Back to selection</span>
            </button>
            <button onClick={onReset} className="tb-btn">
              <span>↺</span>
              <span>New Project</span>
            </button>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#30363d] mb-5">
        <TabButton active={tab === 'docs'} onClick={() => setTab('docs')}>
          Documentation
        </TabButton>
        <TabButton active={tab === 'flow'} onClick={openFlow} btnRef={flowTabRef}>
          Flow View
        </TabButton>
      </div>

      {tab === 'docs' ? (
        <div className="surface rounded-lg">
          <div
            ref={docHeaderRef}
            className="flex items-center gap-2 px-4 h-9 border-b border-[#30363d] text-[11px] text-[#8b949e]"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
            <span className="ml-3 tracking-wide">documentation.md</span>
          </div>
          <div className="px-6 py-5 prose-doc">
            {sections.map((section, i) => (
              <section key={i} className="doc-section">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{section}</ReactMarkdown>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <FlowView flows={flows} state={flowState} />
      )}

      {/* Replay the results tour on demand. Portaled to <body> so it escapes
          the `.animate-fade-in` transform (the containing block for fixed
          descendants). Switch back to the docs tab so every step's target
          exists when the tour runs. */}
      {createPortal(
        <button
          onClick={() => {
            setTab('docs')
            setShowTour(true)
          }}
          className="fixed bottom-3 left-3 z-20 inline-flex items-center gap-1 font-mono text-[10px] text-[#484f58] hover:text-[#34D399] transition-colors"
        >
          <span aria-hidden>↻</span> Show tour again
        </button>,
        document.body
      )}

      {showTour && <OnboardingTour steps={tourSteps} onClose={dismissTour} />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
  btnRef,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  btnRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      className={`px-4 py-2 -mb-px font-mono text-[12px] tracking-wide border-b-2 transition-colors ${
        active
          ? 'text-[#34D399] border-[#34D399]'
          : 'text-[#6e7681] border-transparent hover:text-[#e6edf3]'
      }`}
    >
      {children}
    </button>
  )
}

// Flow View tab content: loading, error/empty, or the rendered diagrams.
function FlowView({ flows, state }: { flows: Flow[]; state: FlowState }) {
  if (state === 'loading') {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center min-h-[40vh] text-center">
        <div className="text-[#34D399] text-5xl mb-5 animate-hex-pulse select-none">
          ⬡
        </div>
        <p className="text-[#e6edf3] text-base">
          Tracing flows<span className="loading-dots" />
        </p>
        <p className="text-[#8b949e] text-xs mt-2">Mapping how your code connects</p>
      </div>
    )
  }

  if (state === 'error') {
    return <EmptyState text="Flow tracing failed. Start a new project to try again." />
  }

  if (flows.length === 0) {
    return (
      <EmptyState text="No clear flows detected. Try selecting more entry-point files." />
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {flows.map((flow, i) => (
        <div key={i} className="surface rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-9 border-b border-[#30363d] text-[11px] text-[#8b949e]">
            <span className="text-[#34D399]">▤</span>
            <span className="tracking-wide">{flow.title}</span>
          </div>
          <div className="px-4 py-5 overflow-x-auto flex justify-center">
            <MermaidDiagram code={flow.mermaid} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="surface rounded-lg px-6 py-14 text-center animate-fade-in">
      <div className="text-[#484f58] text-4xl mb-4 select-none">⬡</div>
      <p className="text-[#8b949e] text-sm font-mono max-w-sm mx-auto">{text}</p>
    </div>
  )
}

// Initialise Mermaid once, themed to match the app's dark/mint aesthetic.
// `securityLevel: 'loose'` lets node labels render the <b>/<small> HTML.
let mermaidReady = false
function initMermaid() {
  if (mermaidReady) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'dark',
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    themeVariables: {
      darkMode: true,
      background: '#161b22',
      primaryColor: '#161b22',
      primaryBorderColor: '#34D399',
      primaryTextColor: '#e6edf3',
      lineColor: '#34D399',
      secondaryColor: '#1c2530',
      tertiaryColor: '#0d1117',
    },
  })
  mermaidReady = true
}

// Renders a Mermaid diagram string into SVG, with loading and error states.
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  // Stable, render-safe unique id (colons stripped — they break DOM lookups).
  const id = `mmd-${useId().replace(/:/g, '')}`

  useEffect(() => {
    let cancelled = false
    initMermaid()
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg)
          setError(false)
        }
      })
      .catch(err => {
        console.error('mermaid render failed', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [code, id])

  if (error) {
    return (
      <p className="text-[#8b949e] text-xs font-mono py-6">
        Could not render this diagram.
      </p>
    )
  }
  if (!svg) {
    return (
      <p className="text-[#8b949e] text-xs font-mono py-6 animate-pulse">
        Rendering diagram…
      </p>
    )
  }
  return (
    <div className="mermaid-diagram w-full" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}

export default App
