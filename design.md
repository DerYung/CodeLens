

# CodeLens — UI Design Specification

## Overall Aesthetic
- **Theme**: Dark mode, terminal/developer tool feel (like VS Code)
- **Vibe**: Professional but with subtle interactive energy — not playful, but satisfying to use
- **Font**: Monospace (`font-mono`) throughout
- **Color Palette**:
  - Background: `#0d1117` (GitHub dark)
  - Surface: `#161b22`
  - Border: `#30363d`
  - Primary accent: Green `#22c55e` (green-500)
  - Text primary: `#e6edf3`
  - Text muted: `#8b949e`
  - Text dim: `#484f58`

---

## Stage 1: Upload Screen

**Layout**: Centered, full viewport height

**Upload Zone**:
- Large dashed border box, centered
- On hover: border turns green, subtle glow effect
- Icon: 📁 or a custom folder SVG
- Text: `Drop your project folder here`
- Subtext: `or click to select`
- Small label: `Supports .tsx .ts .js .jsx .py .java .json .md`

**Interaction**:
- Clicking anywhere in the zone triggers the hidden folder input
- Drag and drop support (bonus if time permits)

---

## Stage 2: File Selection Screen

**Header line**:
```
▶ 109 files scanned
```
In green, monospace

**Subtext**:
```
⭐ Recommended files are pre-selected. Adjust if needed.
```
In muted gray

**File List**:
- Scrollable container, max height ~400px
- Each row: checkbox + file path + optional `⭐ recommended` badge
- Recommended badge: green text, small, right-aligned
- Hover state: slightly lighter background
- Checkbox accent color: green

**Generate Button**:
- Full width
- Green background, black bold text
- Label: `▶ Generate Documentation (8 files selected)`
- Disabled state: reduced opacity when no files selected

---

## Stage 3: Loading State

**Centered in page**:
```
⬡ Analysing your codebase...
```
- Pulsing animation on the text
- Subtext: `This may take a moment`
- Optional: animated dots or spinner in green

---

## Stage 4: Output Screen

**Top bar** (space-between):
- Left: `✓ Documentation generated` in green
- Right: Three buttons side by side:
  - `📋 Copy`
  - `⬇️ Download .md`
  - `↺ New Project`
  - All buttons: dark surface, border, gray text, hover lightens

**Documentation Display**:
- Dark surface card with border
- Rendered Markdown (use `react-markdown`)
- Prose styles for headings, lists, code blocks
- `prose-invert` for dark mode compatibility
- Code blocks should have slightly different background

---

## Header (persistent across all stages)

```
⬡  CodeLens    // AI-powered code documentation
```
- Logo icon: green hexagon or ⬡ symbol
- Title: `CodeLens` in green, bold, letter-spaced
- Subtitle: `// AI-powered code documentation` in dim gray
- Bottom border separator

---

## Micro-interactions & Polish

- Stage transitions should feel instant (no janky flickers)
- Loading pulse should be smooth
- Checkbox interactions should feel snappy
- Copy button: optionally show `✓ Copied!` for 2 seconds after click
- All hover states use `transition-colors` for smoothness

---

## What NOT to do

- No bright white backgrounds
- No rounded pill buttons (use `rounded-lg` or `rounded-xl` max)
- No emoji overload
- No gradients (keep it flat and clean)
- No serif fonts

---

## Component Structure (for reference)

```
App.tsx
├── Header
├── Stage: 'upload'   → UploadZone
├── Stage: 'select'   → FileSelector
│   ├── FileList (scrollable)
│   └── GenerateButton
├── Stage: 'output'
│   ├── OutputToolbar (Copy, Download, Reset)
│   └── DocumentationViewer (ReactMarkdown)
└── HiddenFolderInput
```
