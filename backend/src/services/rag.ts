import { query } from '../config/db.js';

const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';

export interface RetrievedChunk {
  content: string;
  similarity: number;
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
    // 1. Get embedding for the search query from the Python service
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
      console.warn('[RAG Service]: Embedding service returned empty chunks.');
      return [];
    }

    const queryEmbedding = embedData.chunks[0].embedding;

    // 2. Perform cosine similarity vector search in the database
    // The <=> operator is the cosine distance operator in pgvector.
    // 1 - (embedding <=> query_embedding) represents cosine similarity.
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
    // Return empty results on failure (graceful degradation)
    return [];
  }
}
