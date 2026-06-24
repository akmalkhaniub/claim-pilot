# ClaimPilot: Insurance Claims Parser & RAG Platform

ClaimPilot is an enterprise insurance policy parser and claims extraction system. It processes complex policy documents (PDF, DOCX, TXT), chunks and embeds text utilizing OpenAI or local embeddings, and provides an end-to-end dashboard to verify policy terms and matching claims.

---

## 📂 Project Structure

- **`frontend/`:** Next.js application (React 19, TailwindCSS v4, TypeScript) serving the claims dashboard.
- **`backend/`:** Express TypeScript REST API server running on Node.js. It manages authorization, PostgreSQL connection, policy rules, and records management.
- **`parser-service/`:** Python FastAPI document extractor and chunking service. It runs PyPDF/docx and uses OpenAI embeddings or a local `sentence-transformers` fallback (padded to 1536 dimensions for schema compatibility).
- **`evals/`:** Test extraction cases and python performance evaluation scripts.

---

## ⚙️ Environment Configuration

Set up environment files inside their respective service directories:

### 1. Backend (`/backend/.env`)
```env
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/claimpilot?schema=public
JWT_SECRET=your_jwt_secret_here
USE_REDIS=false
REDIS_URL=redis://localhost:6379

# AI Keys (If backend connects to LLMs directly)
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

### 2. Parser Service (`/parser-service/.env` or system variables)
```env
OPENAI_API_KEY=your_openai_key_here
```

---

## 🚀 Installation & Running

### 1. Launch Parser Service (Python)
Navigate to `/parser-service`:
```bash
cd parser-service
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
```

### 2. Launch API Backend (Express TS)
Navigate to `/backend`:
```bash
cd backend
npm install
# Initialize DB Schema (requires PostgreSQL running at DATABASE_URL)
npm run db:init
# Start server in watch mode
npm run dev
```

### 3. Launch Frontend (Next.js)
Navigate to `/frontend`:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000` to view the web dashboard.

### 4. Running Evaluations
To verify document extraction and chunking precision:
```bash
cd evals
python run_evals.py
```
