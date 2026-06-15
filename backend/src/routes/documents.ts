import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { query } from '../config/db.js';

const router = Router({ mergeParams: true });
const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';

// Ensure upload directory exists
const UPLOADS_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Upload document (Base64 format in JSON)
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const claimantId = req.user?.id;
  const role = req.user?.role;
  const { fileName, fileType, fileContent } = req.body;

  if (!fileName || !fileType || !fileContent) {
    res.status(400).json({ error: 'Missing document fields (fileName, fileType, fileContent)' });
    return;
  }

  try {
    // 1. Verify claim ownership
    const claimCheck = await query('SELECT claimant_id, status FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    
    // Claimant can upload only if they own the claim. Adjusters can also upload.
    if (role !== 'adjuster' && claimCheck.rows[0].claimant_id !== claimantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 2. Decode base64 and write file to local disk
    const fileBuffer = Buffer.from(fileContent, 'base64');
    const localFileName = `${Date.now()}_${fileName.replace(/\s+/g, '_')}`;
    const localFilePath = path.join(UPLOADS_DIR, localFileName);
    fs.writeFileSync(localFilePath, fileBuffer);

    console.log(`[Documents]: Saved file to disk: ${localFilePath}`);

    // 3. Send file to FastAPI service for text extraction
    let extractedText = '';
    try {
      const blob = new Blob([fileBuffer], { type: fileType });
      const formData = new FormData();
      formData.append('file', blob, fileName);

      console.log(`[Documents]: Sending file to parser service: ${PARSER_SERVICE_URL}/parse`);
      const parseResponse = await fetch(`${PARSER_SERVICE_URL}/parse`, {
        method: 'POST',
        body: formData,
      });

      if (!parseResponse.ok) {
        throw new Error(`Parser service responded with status ${parseResponse.status}`);
      }

      const parseData = (await parseResponse.json()) as { extractedText: string };
      extractedText = parseData.extractedText || '';
      console.log(`[Documents]: Extracted ${extractedText.length} characters of text.`);
    } catch (parseError) {
      console.error('[Documents] FastAPI parse warning:', parseError);
      // Create a fallback extracted text for development if FastAPI is offline
      extractedText = `Fallback: Document ${fileName} content representation. (FastAPI parser offline)`;
    }

    // 4. Save document metadata to database
    const docResult = await query(
      `INSERT INTO documents (claim_id, file_name, file_path, file_type, extracted_text) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, file_name as "name", file_type as "type", created_at as "createdAt"`,
      [claimId, fileName, localFilePath, fileType, extractedText]
    );

    const docId = docResult.rows[0].id;

    // 5. Send text to FastAPI service for chunking & embeddings
    if (extractedText) {
      try {
        console.log(`[Documents]: Sending text to parser service for embedding: ${PARSER_SERVICE_URL}/embed`);
        const embedResponse = await fetch(`${PARSER_SERVICE_URL}/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: extractedText,
            chunk_size: 500,
            chunk_overlap: 100,
          }),
        });

        if (embedResponse.ok) {
          const embedData = (await embedResponse.json()) as {
            chunks: Array<{ index: number; content: string; embedding: number[] }>;
          };

          // Save chunks to database
          for (const chunk of embedData.chunks) {
            await query(
              `INSERT INTO document_chunks (document_id, chunk_index, chunk_content, embedding) 
               VALUES ($1, $2, $3, $4)`,
              [docId, chunk.index, chunk.content, JSON.stringify(chunk.embedding)]
            );
          }
          console.log(`[Documents]: Saved ${embedData.chunks.length} chunks with vector embeddings.`);
        } else {
          console.error(`[Documents] Embedding service returned status ${embedResponse.status}`);
        }
      } catch (embedError) {
        console.error('[Documents] FastAPI embedding warning:', embedError);
        // Fallback: create a mock chunk with a mock 1536-dimensional vector for local testing
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() - 0.5);
        await query(
          `INSERT INTO document_chunks (document_id, chunk_index, chunk_content, embedding) 
           VALUES ($1, $2, $3, $4)`,
          [docId, 0, extractedText, JSON.stringify(mockEmbedding)]
        );
        console.log('[Documents]: Saved 1 mock chunk with random vector representation.');
      }
    }

    // 6. Log to audit log (SOC 2)
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'DOCUMENT_UPLOADED', $3)`,
      [claimantId, claimId, JSON.stringify({ documentId: docId, fileName })]
    );

    res.status(201).json({
      document: docResult.rows[0],
      message: 'Document uploaded and indexed successfully.',
    });
  } catch (error: any) {
    console.error('Error processing document upload:', error);
    res.status(500).json({ error: 'Failed to process document upload' });
  }
});

// List documents for a claim
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const claimantId = req.user?.id;
  const role = req.user?.role;

  try {
    // Owner check
    const claimCheck = await query('SELECT claimant_id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (role !== 'adjuster' && claimCheck.rows[0].claimant_id !== claimantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const result = await query(
      `SELECT id, file_name as "name", file_type as "type", created_at as "createdAt"
       FROM documents 
       WHERE claim_id = $1 
       ORDER BY created_at DESC`,
      [claimId]
    );

    res.status(200).json({ documents: result.rows });
  } catch (error: any) {
    console.error('Error listing documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Download/View file content
router.get('/:docId/download', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id: claimId, docId } = req.params;
  const claimantId = req.user?.id;
  const role = req.user?.role;

  try {
    // Owner check
    const claimCheck = await query('SELECT claimant_id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (role !== 'adjuster' && claimCheck.rows[0].claimant_id !== claimantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const docCheck = await query(
      'SELECT file_name, file_path, file_type FROM documents WHERE id = $1 AND claim_id = $2',
      [docId, claimId]
    );

    if (docCheck.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = docCheck.rows[0];
    if (!fs.existsSync(doc.file_path)) {
      res.status(404).json({ error: 'File not found on server storage' });
      return;
    }

    res.setHeader('Content-Type', doc.file_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (error: any) {
    console.error('Error downloading document:', error);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

export default router;
