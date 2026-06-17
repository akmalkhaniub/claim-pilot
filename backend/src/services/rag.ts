import { query } from '../config/db.js';

const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://127.0.0.1:8000';

export interface RetrievedChunk {
  content: string;
  similarity: number;
}

export interface SearchChunkResult {
  content: string;
  similarity: number;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  claimId?: string;
  claimTitle?: string;
  claimantName?: string;
}

/**
 * Fetch embeddings from parser-service, falling back to mock embeddings if offline.
 */
export async function getEmbeddingForQuery(searchQuery: string): Promise<number[]> {
  try {
    console.log(`[RAG Service]: Fetching embedding for query "${searchQuery}"...`);
    const embedResponse = await fetch(`${PARSER_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: searchQuery,
        chunk_size: 500, // simple single-chunk embed
        chunk_overlap: 0,
      }),
    });

    if (!embedResponse.ok) {
      throw new Error(`Failed to fetch embedding: ${embedResponse.statusText}`);
    }

    const embedData = (await embedResponse.json()) as {
      chunks: Array<{ embedding: number[] }>;
    };

    if (!embedData.chunks || embedData.chunks.length === 0) {
      throw new Error('Embedding service returned empty chunks.');
    }

    return embedData.chunks[0].embedding;
  } catch (error) {
    console.warn('[RAG Service] Embedding service failed, using fallback mock embedding:', error);
    // Generate mock 1536-dimension embedding for offline development
    return new Array(1536).fill(0).map(() => Math.random() - 0.5);
  }
}

/**
 * Retrieve top-k document chunks relevant to a search query for a specific claim.
 * Uses pgvector cosine similarity search.
 */
export async function retrieveRelevantContext(
  claimId: string,
  searchQuery: string,
  limit: number = 3
): Promise<RetrievedChunk[]> {
  try {
    const queryEmbedding = await getEmbeddingForQuery(searchQuery);

    console.log(`[RAG Service]: Performing vector search in DB for claim ${claimId}...`);
    const vectorResult = await query(
      `SELECT dc.chunk_content as "content", 
              1 - (dc.embedding <=> $1::vector) as "similarity"
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       WHERE d.claim_id = $2
       ORDER BY dc.embedding <=> $1::vector ASC
       LIMIT $3`,
      [JSON.stringify(queryEmbedding), claimId, limit]
    );

    return vectorResult.rows.map((row) => ({
      content: row.content,
      similarity: Number(row.similarity),
    }));
  } catch (error) {
    console.error('[RAG Service] Error during vector retrieval:', error);
    return [];
  }
}

/**
 * Search document chunks for a specific claim with detailed metadata.
 */
export async function searchClaimChunks(
  claimId: string,
  searchQuery: string,
  limit: number = 5
): Promise<SearchChunkResult[]> {
  try {
    const queryEmbedding = await getEmbeddingForQuery(searchQuery);

    console.log(`[RAG Service]: Performing claim-specific vector search in DB for claim ${claimId}...`);
    const vectorResult = await query(
      `SELECT dc.chunk_content as "content", 
              1 - (dc.embedding <=> $1::vector) as "similarity",
              dc.document_id as "documentId",
              d.file_name as "documentName",
              dc.chunk_index as "chunkIndex"
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       WHERE d.claim_id = $2
       ORDER BY dc.embedding <=> $1::vector ASC
       LIMIT $3`,
      [JSON.stringify(queryEmbedding), claimId, limit]
    );

    return vectorResult.rows.map((row) => ({
      content: row.content,
      similarity: Number(row.similarity),
      documentId: row.documentId,
      documentName: row.documentName,
      chunkIndex: Number(row.chunkIndex),
    }));
  } catch (error) {
    console.error('[RAG Service] Error during claim vector search:', error);
    return [];
  }
}

/**
 * Search all document chunks globally (Adjuster only).
 */
export async function searchAllChunks(
  searchQuery: string,
  limit: number = 5
): Promise<SearchChunkResult[]> {
  try {
    const queryEmbedding = await getEmbeddingForQuery(searchQuery);

    console.log(`[RAG Service]: Performing global vector search in DB...`);
    const vectorResult = await query(
      `SELECT dc.chunk_content as "content", 
              1 - (dc.embedding <=> $1::vector) as "similarity",
              dc.document_id as "documentId",
              d.file_name as "documentName",
              dc.chunk_index as "chunkIndex",
              d.claim_id as "claimId",
              c.title as "claimTitle",
              u.full_name as "claimantName"
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       JOIN claims c ON d.claim_id = c.id
       LEFT JOIN users u ON c.claimant_id = u.id
       ORDER BY dc.embedding <=> $1::vector ASC
       LIMIT $2`,
      [JSON.stringify(queryEmbedding), limit]
    );

    return vectorResult.rows.map((row) => ({
      content: row.content,
      similarity: Number(row.similarity),
      documentId: row.documentId,
      documentName: row.documentName,
      chunkIndex: Number(row.chunkIndex),
      claimId: row.claimId,
      claimTitle: row.claimTitle,
      claimantName: row.claimantName || 'Unknown Claimant',
    }));
  } catch (error) {
    console.error('[RAG Service] Error during global vector search:', error);
    return [];
  }
}

