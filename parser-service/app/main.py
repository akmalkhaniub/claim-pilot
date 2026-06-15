import os
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pypdf
import docx
import numpy as np
from openai import OpenAI

# Initialize FastAPI app
app = FastAPI(title="ClaimPilot Parser & RAG Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client
api_key = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=api_key) if api_key else None

# Local embedding model lazy-loader
local_model = None

def get_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings for list of texts.
    Falls back to local sentence-transformers if OpenAI key is not set.
    """
    global local_model
    
    if openai_client:
        try:
            response = openai_client.embeddings.create(
                input=texts,
                model="text-embedding-3-small"
            )
            return [data.embedding for data in response.data]
        except Exception as e:
            print(f"OpenAI Embedding Error: {e}. Falling back to local model.")
    
    # Fallback to local model
    if local_model is None:
        print("[Parser Service] Loading local sentence-transformers model (all-MiniLM-L6-v2)...")
        from sentence_transformers import SentenceTransformer
        local_model = SentenceTransformer("all-MiniLM-L6-v2")
        
    embeddings = local_model.encode(texts).tolist()
    
    # Pad local 384-dimensional vectors to 1536 dimensions for DB schema compatibility
    padded_embeddings = []
    for emb in embeddings:
        if len(emb) < 1536:
            padded = np.pad(emb, (0, 1536 - len(emb)), 'constant').tolist()
            padded_embeddings.append(padded)
        else:
            padded_embeddings.append(emb)
            
    return padded_embeddings

# Schema for embedding requests
class EmbedRequest(BaseModel):
    text: str
    chunk_size: Optional[int] = 500
    chunk_overlap: Optional[int] = 100

class ChunkResponse(BaseModel):
    index: int
    content: str
    embedding: List[float]

class EmbedResponse(BaseModel):
    chunks: List[ChunkResponse]

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "claimpilot-parser-service",
        "openai_available": openai_client is not None
    }

@app.post("/parse")
async def parse_document(file: UploadFile = File(...)):
    """
    Extract text content from uploaded PDF or DOCX file.
    """
    filename = file.filename
    content_type = file.content_type
    text = ""
    
    try:
        if filename.endswith(".pdf"):
            reader = pypdf.PdfReader(file.file)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        elif filename.endswith(".docx"):
            doc = docx.Document(file.file)
            for paragraph in doc.paragraphs:
                if paragraph.text:
                    text += paragraph.text + "\n"
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Must be PDF or DOCX.")
        
        return {
            "fileName": filename,
            "fileType": content_type,
            "extractedText": text.strip()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse document: {str(e)}")

@app.post("/embed", response_model=EmbedResponse)
def chunk_and_embed(req: EmbedRequest):
    """
    Chunk input text and generate embeddings for each chunk.
    """
    text = req.text
    chunk_size = req.chunk_size
    overlap = req.chunk_overlap
    
    if not text:
        return {"chunks": []}
        
    # Text chunking logic
    words = text.split()
    chunks = []
    
    i = 0
    while i < len(words):
        chunk_words = words[i : i + chunk_size]
        chunk_text = " ".join(chunk_words)
        if chunk_text.strip():
            chunks.append(chunk_text)
        # Advance index by chunk_size - overlap
        i += max(1, chunk_size - overlap)
        
    if not chunks:
         return {"chunks": []}
         
    # Generate embeddings
    try:
        embeddings = get_embeddings(chunks)
        
        response_chunks = []
        for idx, (content, emb) in enumerate(zip(chunks, embeddings)):
            response_chunks.append({
                "index": idx,
                "content": content,
                "embedding": emb
            })
            
        return {"chunks": response_chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embeddings: {str(e)}")
