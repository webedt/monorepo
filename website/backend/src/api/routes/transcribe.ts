/**
 * Transcription routes for audio-to-text using OpenAI Whisper
 * Consolidated from website/apps/server/src/routes/transcribe.ts
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { aiOperationRateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit (Whisper API limit)
  },
});

/**
 * POST /api/transcribe
 * Transcribes audio using OpenAI Whisper API
 * Rate limited to prevent abuse of expensive audio processing (10/min per user)
 *
 * Request body (multipart/form-data):
 * - audio: Audio file (webm, mp3, mp4, mpeg, mpga, m4a, wav, or webm)
 *
 * Response:
 * - success: boolean
 * - data: { text: string } - Transcribed text
 * - error: string (if failed)
 */
router.post('/transcribe', aiOperationRateLimiter, upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    // Check if OpenAI API key is configured
    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'OpenAI API key not configured. Please use browser fallback.',
      });
      return;
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No audio file provided',
      });
      return;
    }

    console.log('Transcribing audio file:', {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });

    // Create form data for OpenAI API
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype,
    });
    formData.append('model', 'whisper-1');

    // Call OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      body: formData as unknown as import('node-fetch').BodyInit,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      res.status(response.status).json({
        success: false,
        error: `OpenAI API error: ${response.statusText}`,
      });
      return;
    }

    const result = await response.json() as { text: string };

    console.log('Transcription successful:', result.text.substring(0, 100) + '...');

    res.json({
      success: true,
      data: {
        text: result.text,
      },
    });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to transcribe audio',
    });
  }
});

export default router;
