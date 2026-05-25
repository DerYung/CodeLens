# Product Requirements Document (PRD)
## CodeLens — AI-Powered Code Documentation Generator

**Version:** 1.0  
**Author:** Chong Der Yung  
**Date:** May 2026  
**Challenge:** Shortcut Asia Internship Challenge 2026

---

## 1. Problem Statement

Developers who inherit unfamiliar codebases spend significant time trying to understand what the code does before they can contribute. Existing AI tools like Claude Code or GitHub Copilot are designed for active developers — they require CLI setup, prompt engineering knowledge, and technical familiarity.

There is no simple, zero-setup tool that lets anyone (new team members, non-technical PMs, freelancers onboarding to a project) upload a code file and immediately receive a clear, human-readable explanation.

**CodeLens** solves this by turning raw code into structured documentation in seconds — no CLI, no prompts, no setup required.

---

## 2. Target Users

| User | Pain Point |
|------|-----------|
| New developer joining a team | Spends hours reading unfamiliar code before contributing |
| Freelancer onboarding to a client project | No documentation exists; codebase is inherited |
| Non-technical PM | Cannot understand what a feature does or how it's built |
| Student reviewing group project code | Teammates wrote code without comments |

---

## 3. Product Goals

- Allow any user to upload a project folder and receive AI-generated documentation
- Require zero technical setup — runs entirely in the browser
- Guide non-technical users on which files matter, so they don't have to decide themselves
- Produce output that is structured, readable, and immediately useful
- Allow users to copy or download the generated documentation

---

## 4. Core Features (MVP)

### Feature 1: Project Folder Upload & AI-Guided File Selection

User uploads an entire project folder. The app reads the file structure and runs a lightweight Claude scan (file names only, no content yet) to identify and recommend the most important files.

**Stage B — AI scans file structure and recommends:**
```
⭐ Recommended (start here):
☑ App.tsx              → Main entry point
☑ AuthContext.tsx      → Authentication system
☑ MembershipRegistration.tsx → Core feature

○ Other files:
☐ Button.tsx           → UI component
☐ index.css            → Styles
```

**Stage C — User confirms or adjusts selection:**
- Recommended files are pre-checked
- User can uncheck files they don't need
- User can add files that weren't recommended
- Non-technical users can trust the AI recommendation and proceed

**Files always skipped (automatically):**
- `node_modules/`
- `.env`
- `dist/` and `build/`
- Images and fonts (`.png`, `.jpg`, `.svg`, `.woff`)

### Feature 2: Batched Analysis & Documentation Output (Stage A)

Selected files are sent to Claude in batches (3–4 files per request) to avoid token limits. Results are merged into one unified documentation output.

**Output includes:**
- Project overview (what this codebase does)
- Per-file breakdown: purpose, key functions, dependencies
- How the files connect to each other
- Notes for a new developer ("things to know before touching this")

### Feature 3: Copy & Download Documentation
- User can copy the full documentation to clipboard
- User can download it as a `.md` (Markdown) file
- Output is formatted and ready to paste into a README or Notion

---

## 5. Out of Scope (MVP)

- GitHub repository integration (paste URL)
- User accounts or saved history
- Real-time collaboration
- Auto-generated architecture diagrams
- Support for binary or non-text files

These are valid future enhancements but will not be built within the 11-day challenge window.

---

## 6. Technical Architecture

```
User (Browser)
     │
     ▼
React + TypeScript Frontend (Vite)
     │
     ├── File Upload Component
     ├── Output Display Component
     └── Copy / Download Handler
     │
     ▼
Vercel Serverless Function (/api/generate)
     │
     ├── Receives code content from frontend
     ├── Reads Claude API key from environment variables (never exposed to browser)
     └── Forwards request to Claude API
     │
     ▼
Claude API (claude-sonnet-4-20250514)
     │
     └── Returns structured documentation as text
     │
     ▼
Rendered Output in UI
     │
     └── User copies or downloads .md file
```

**Deployment:** Vercel  
**Frontend:** React SPA (no server required)  
**Backend:** Vercel Serverless Function (`/api/generate.ts`) — handles Claude API calls and keeps the API key secure in Vercel environment variables

---

## 7. Tech Stack & Justification

| Technology | Reason |
|-----------|--------|
| React 18 + TypeScript | Familiar stack; type safety reduces bugs during fast development |
| Vite | Fast dev server and build tool |
| Tailwind CSS | Rapid UI styling without writing custom CSS |
| Zustand | Global state management for uploaded files, selected files, and generated docs — cleaner than prop drilling |
| React Markdown | Renders Claude's markdown output as formatted UI (headings, lists, code blocks) instead of raw text |
| Claude API (Sonnet) | Best-in-class code understanding; structured output quality |
| Vercel Serverless Function | Securely proxies Claude API calls; keeps API key out of browser |
| Vercel | One-click deployment; free tier sufficient for demo |

---

## 8. Key User Flow

```
1. User lands on homepage
        ↓
2. User uploads entire project folder (drag & drop or folder picker)
        ↓
3. [Stage B] App reads file structure
   Claude scans file names → identifies and recommends important files
        ↓
4. [Stage C] User sees recommended files (pre-checked)
   User confirms selection or adjusts manually
        ↓
5. [Stage A] Selected files sent to Claude in batches (3-4 files per request)
   Results merged into one unified documentation
        ↓
6. Loading state shown while API processes
        ↓
7. Structured documentation displayed on screen
        ↓
8. User copies to clipboard OR downloads as .md file
```

---

## 9. Success Criteria

| Criteria | Target |
|---------|--------|
| Folder upload and file structure reading works | ✅ Must have |
| AI correctly identifies and recommends important files | ✅ Must have |
| User can confirm or adjust file selection | ✅ Must have |
| Batched analysis produces unified documentation | ✅ Must have |
| Output is structured and readable | ✅ Must have |
| App deployed and accessible via URL | ✅ Must have |
| Copy and download functionality works | ✅ Must have |
| UI is clean and usable on desktop | ✅ Must have |

---

## 10. Timeline

| Day | Milestone |
|-----|-----------|
| Day 1–2 | Project setup, folder upload, file structure reading |
| Day 3–4 | Stage B: Claude scans file names, returns recommendations |
| Day 5–6 | Stage C: File selection UI with pre-checked recommendations |
| Day 7–8 | Stage A: Batched analysis, merge results, output display |
| Day 9 | Copy/download, UI polish, deploy to Vercel |
| Day 10 | Record demo video, write submission documentation |
| Day 11 | Submit by June 2, 11:59pm |

---

## 11. Future Enhancements (Post-MVP)

- **GitHub integration:** Paste a repo URL instead of uploading a folder
- **Architecture diagram:** Auto-generate a visual flowchart of component relationships
- **Export to Notion / Confluence:** One-click push to team documentation tools
- **Saved history:** Keep previously generated docs for reference
- **Comment injection:** Option to write documentation directly into the source code as comments
