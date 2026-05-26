import { useCallback, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface ProjectFile {
  name: string
  path: string
  file: File
}

type Stage = 'upload' | 'select' | 'loading' | 'output'

const ALLOWED_EXTS = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'json', 'md']
const IGNORED_DIRS = ['node_modules/', 'dist/', 'build/', '.git/', '.next/']
const IGNORED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])

function shouldKeepFile(file: File, path: string): boolean {
  if (IGNORED_DIRS.some(d => path.includes(d))) return false
  if (IGNORED_FILES.has(file.name)) return false
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ALLOWED_EXTS.includes(ext || '')
}

// Strip the leading project-root folder so `CodeLens/src/App.tsx` → `src/App.tsx`.
function displayPath(path: string): string {
  const firstSlash = path.indexOf('/')
  return firstSlash === -1 ? path : path.slice(firstSlash + 1)
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

function App() {
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [recommended, setRecommended] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [documentation, setDocumentation] = useState<string>('')
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths }),
      })
      const data = await res.json()
      const rec: string[] = data.recommended ?? []
      setRecommended(rec)
      setSelected(rec)
    } catch (err) {
      console.error('recommend failed', err)
      setRecommended([])
      setSelected([])
    }
  }

  const ingestRaw = (raw: { file: File; path: string }[]) => {
    const kept = raw
      .filter(({ file, path }) => shouldKeepFile(file, path))
      .map(({ file, path }) => ({ name: file.name, path, file }))
    setFiles(kept)
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: batch }),
        })
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

  const reset = () => {
    setFiles([])
    setRecommended([])
    setSelected([])
    setDocumentation('')
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
            copyState={copyState}
            onCopy={handleCopy}
            onDownload={handleDownload}
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
        <span className="text-[#22c55e] text-lg leading-none select-none transition-transform duration-200 hover:rotate-180">
          ⬡
        </span>
        <h1 className="text-[#22c55e] font-bold tracking-[0.08em] text-sm uppercase">
          CodeLens
        </h1>
        <span className="text-[#484f58] text-xs ml-1">
          <span className="text-[#6e7681]">//</span>{' '}
          AI-powered code documentation
        </span>
      </div>
    </header>
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
  return (
    <div className="animate-fade-in flex items-center justify-center min-h-[60vh]">
      <div
        onClick={onClick}
        onDragOver={e => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`upload-zone ${
          isDragging ? 'is-dragging' : ''
        } w-full cursor-pointer rounded-xl border-2 border-dashed border-[#30363d] bg-[#0d1117] px-10 py-16 text-center`}
      >
        <div className="text-[#22c55e] text-5xl mb-5 leading-none select-none">
          ⬢
        </div>
        <p className="text-[#e6edf3] text-base">
          Drop your project folder here
        </p>
        <p className="text-[#8b949e] text-xs mt-2">
          or click to select
        </p>
        <div className="mt-8 inline-flex items-center gap-2 text-[11px] text-[#484f58]">
          <span className="text-[#22c55e]">$</span>
          <span>supports</span>
          <code className="text-[#8b949e]">.tsx .ts .js .jsx .py .java .json .md</code>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────── Stage 2: File Selection ─────────────────── */

function SelectStage({
  files,
  recommended,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onSelectRecommended,
  onGenerate,
}: {
  files: ProjectFile[]
  recommended: string[]
  selected: string[]
  onToggle: (p: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onSelectRecommended: () => void
  onGenerate: () => void
}) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-[#22c55e] text-sm tracking-wide">
          <span className="mr-1">▶</span> {files.length} files scanned
        </p>
        <div className="flex items-center gap-3 text-[11px] text-[#8b949e]">
          <button
            onClick={onSelectRecommended}
            className="hover:text-[#22c55e] transition-colors"
          >
            recommended
          </button>
          <span className="text-[#30363d]">·</span>
          <button onClick={onSelectAll} className="hover:text-[#e6edf3] transition-colors">
            all
          </button>
          <span className="text-[#30363d]">·</span>
          <button onClick={onSelectNone} className="hover:text-[#e6edf3] transition-colors">
            none
          </button>
        </div>
      </div>
      <p className="text-[#8b949e] text-xs mb-4">
        <span className="text-[#22c55e]">⭐</span> Recommended files are
        pre-selected. Adjust if needed.
      </p>

      <div className="surface rounded-lg overflow-hidden mb-5">
        <div className="max-h-[400px] overflow-y-auto">
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
              />
            )
          })}
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={selected.length === 0}
        className="cta-btn"
      >
        <span>▶</span>
        <span>Generate Documentation ({selected.length} files selected)</span>
      </button>
    </div>
  )
}

function FileRow({
  file,
  isRecommended,
  isSelected,
  onToggle,
}: {
  file: ProjectFile
  isRecommended: boolean
  isSelected: boolean
  onToggle: () => void
}) {
  const shown = displayPath(file.path)
  const lastSlash = shown.lastIndexOf('/')
  const dir = lastSlash >= 0 ? shown.slice(0, lastSlash + 1) : ''
  const name = lastSlash >= 0 ? shown.slice(lastSlash + 1) : shown

  return (
    <label
      className={`file-row ${isSelected ? 'is-selected' : ''} ${
        isRecommended ? 'is-recommended' : ''
      } flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-[#21262d] last:border-b-0 text-[12px]`}
    >
      <input
        type="checkbox"
        className="cl-checkbox"
        checked={isSelected}
        onChange={onToggle}
      />
      <span className="flex-1 min-w-0 truncate">
        <span className="text-[#6e7681]">{dir}</span>
        <span className="text-[#e6edf3]">{name}</span>
      </span>
      {isRecommended && (
        <span className="text-[10px] text-[#22c55e] tracking-wider uppercase whitespace-nowrap">
          ⭐ recommended
        </span>
      )}
    </label>
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
      <div className="text-[#22c55e] text-6xl mb-6 animate-hex-pulse select-none">
        ⬡
      </div>
      <p className="text-[#e6edf3] text-base">
        Analysing your codebase<span className="loading-dots" />
      </p>
      <p className="text-[#8b949e] text-xs mt-2">This may take a moment</p>

      <div className="mt-10 surface rounded-lg px-4 py-3 text-[11px] text-[#8b949e] text-left w-full max-w-sm">
        {lines.map((l, i) => (
          <div key={l} className="flex items-center gap-2">
            <span className="text-[#22c55e]">
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
  copyState,
  onCopy,
  onDownload,
  onReset,
}: {
  documentation: string
  copyState: 'idle' | 'copied'
  onCopy: () => void
  onDownload: () => void
  onReset: () => void
}) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-[#22c55e] text-sm tracking-wide">
          <span className="mr-1">✓</span> Documentation generated
        </p>
        <div className="flex items-center gap-2">
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
          <button onClick={onReset} className="tb-btn">
            <span>↺</span>
            <span>New Project</span>
          </button>
        </div>
      </div>

      <div className="surface rounded-lg">
        <div className="flex items-center gap-2 px-4 h-9 border-b border-[#30363d] text-[11px] text-[#8b949e]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#30363d]" />
          <span className="ml-3 tracking-wide">documentation.md</span>
        </div>
        <div className="px-6 py-5 prose-doc">
          <ReactMarkdown>{documentation}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export default App
