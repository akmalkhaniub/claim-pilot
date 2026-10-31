# AGENTS.md — Autonomous Agent Operating Contract

## 🎯 Repository Purpose & Architecture
`claim-pilot` is an automated insurance claim adjudication engine featuring multi-document policy parsing, fraud risk heuristics, and structured LLM evaluation pipelines with automated fallback handling.

### Tech Stack
- **Frontend**: Next.js (React 19, TailwindCSS)
- **Backend API**: Express + TypeScript
- **Parser Service**: FastAPI (Python, PyPDF/docx, sentence-transformers)
- **Database**: PostgreSQL (pgvector)

---

## ⚡ Autonomous Execution Protocol
1. Pull task from `TASKS.json`.
2. Maintain strict decoupling between Python parser and Express API.
3. Run verification: `pytest backend/tests/` or `npm test`.
4. Commit with: `feat(task-id): description`.
