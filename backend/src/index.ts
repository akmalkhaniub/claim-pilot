import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth.js';
import claimsRouter from './routes/claims.js';
import documentsRouter from './routes/documents.js';
import voiceRouter from './routes/voice.js';
import { authenticateToken } from './middleware/auth.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/claims', authenticateToken, claimsRouter);
app.use('/api/claims/:id/documents', authenticateToken, documentsRouter);
app.use('/api/voice', voiceRouter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'claimpilot-backend', timestamp: new Date() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
app.listen(port, () => {
  console.log(`[Server]: ClaimPilot API listening on port ${port}`);
});
