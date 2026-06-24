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

from abc import ABC, abstractmethod

# Initialize OpenAI client
api_key = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=api_key) if api_key else None


class EmbeddingProvider(ABC):
    @abstractmethod
    def is_available(self) -> bool:
        """Return True if this provider is configured and healthy."""
        pass
        
    @abstractmethod
    def embed(self, texts: List[str]) -> List[List[float]]:
        """Generate list of embeddings for the input texts."""
        pass


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, client: Optional[OpenAI]):
        self.client = client
        
    def is_available(self) -> bool:
        return self.client is not None
        
    def embed(self, texts: List[str]) -> List[List[float]]:
        if not self.client:
            raise ValueError("OpenAI client not initialized.")
        response = self.client.embeddings.create(
            input=texts,
            model="text-embedding-3-small"
        )
        return [data.embedding for data in response.data]


class LocalEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        self.model = None
        
    def is_available(self) -> bool:
        return True  # Local offline model is always available
        
    def embed(self, texts: List[str]) -> List[List[float]]:
        if self.model is None:
            print("[Parser Service] Loading local sentence-transformers model (all-MiniLM-L6-v2)...")
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer("all-MiniLM-L6-v2")
            
        embeddings = self.model.encode(texts).tolist()
        
        # Pad local 384-dimensional vectors to 1536 dimensions for DB schema compatibility
        padded_embeddings = []
        for emb in embeddings:
            if len(emb) < 1536:
                padded = np.pad(emb, (0, 1536 - len(emb)), 'constant').tolist()
                padded_embeddings.append(padded)
            else:
                padded_embeddings.append(emb)
                
        return padded_embeddings


class EmbeddingProviderRegistry:
    def __init__(self):
        self._providers: dict[str, EmbeddingProvider] = {}
        
    def register(self, name: str, provider: EmbeddingProvider) -> None:
        self._providers[name] = provider
        
    def get(self, name: str) -> Optional[EmbeddingProvider]:
        return self._providers.get(name)
        
    def select_best(self) -> EmbeddingProvider:
        """Selector logic: choose OpenAI if configured and available, else local."""
        openai_p = self.get("openai")
        if openai_p and openai_p.is_available():
            return openai_p
        return self._providers["local"]


# Instantiate and register providers
registry = EmbeddingProviderRegistry()
registry.register("openai", OpenAIEmbeddingProvider(openai_client))
registry.register("local", LocalEmbeddingProvider())


def get_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings using the dynamic provider selector.
    """
    provider = registry.select_best()
    try:
        return provider.embed(texts)
    except Exception as e:
        print(f"Primary embedding provider failed: {e}. Falling back to local model.")
        local_p = registry.get("local")
        if not local_p:
            raise ValueError("Local embedding provider not registered.")
        return local_p.embed(texts)

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
    Extract text content from uploaded PDF, DOCX, or TXT file.
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
        elif filename.endswith(".txt"):
            content_bytes = await file.read()
            text = content_bytes.decode("utf-8")
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Must be PDF, DOCX, or TXT.")
        
        return {
            "fileName": filename,
            "fileType": content_type,
            "extractedText": text.strip()
        }
    except HTTPException as he:
        raise he
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
