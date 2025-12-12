/**
 * Image Generation Routes
 * Handles AI-powered image generation/editing via OpenRouter, CometAPI, or Google APIs
 */

import { Router, Request, Response } from 'express';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Available models for image generation
const AVAILABLE_MODELS = {
  'google/gemini-2.5-flash-image': {
    displayName: 'Gemini 2.5 Flash Image',
    description: 'Fast image generation and editing',
    providers: ['openrouter', 'cometapi', 'google'],
  },
  'google/gemini-3-pro-image-preview': {
    displayName: 'Gemini 3 Pro Image Preview',
    description: 'Advanced image generation with higher quality',
    providers: ['openrouter', 'cometapi', 'google'],
  },
};

// Provider endpoint configurations
const PROVIDER_ENDPOINTS = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    chatEndpoint: '/chat/completions',
  },
  cometapi: {
    baseUrl: 'https://api.cometapi.com/v1',
    chatEndpoint: '/chat/completions',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    chatEndpoint: '/models/{model}:generateContent',
  },
};

interface ImageGenerationRequest {
  prompt: string;
  imageData?: string; // Base64 encoded image
  selection?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  provider?: 'openrouter' | 'cometapi' | 'google';
  model?: string;
}

// Generate image using OpenRouter or CometAPI (OpenAI-compatible API)
async function generateWithOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  imageData?: string
): Promise<{ success: boolean; imageData?: string; error?: string }> {
  try {
    const messages: any[] = [];

    if (imageData) {
      // Image editing mode
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      });
    } else {
      // Image generation mode
      messages.push({
        role: 'user',
        content: prompt,
      });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://webedt.com',
        'X-Title': 'WebEDT Image Editor',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096,
        // Enable image generation in response
        response_format: { type: 'text' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ImageGen] API error:', response.status, errorText);
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };

    // Extract image from response
    // The response format may vary depending on the model
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      // Check if content contains base64 image data
      const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
      if (base64Match) {
        return { success: true, imageData: base64Match[0] };
      }

      // Some models return image URLs instead
      const urlMatch = content.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp|gif)/i);
      if (urlMatch) {
        // Fetch the image and convert to base64
        const imageResponse = await fetch(urlMatch[0]);
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64 = Buffer.from(imageBuffer).toString('base64');
        const mimeType = imageResponse.headers.get('content-type') || 'image/png';
        return { success: true, imageData: `data:${mimeType};base64,${base64}` };
      }

      // Return text response if no image found (model might need different handling)
      return { success: false, error: 'No image generated. Model response: ' + content.substring(0, 200) };
    }

    return { success: false, error: 'No content in response' };
  } catch (error) {
    console.error('[ImageGen] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Generate image using Google's native API
async function generateWithGoogle(
  apiKey: string,
  model: string,
  prompt: string,
  imageData?: string
): Promise<{ success: boolean; imageData?: string; error?: string }> {
  try {
    // Extract just the model name from the full identifier
    const modelName = model.replace('google/', '');

    const parts: any[] = [];

    if (imageData) {
      // Image editing mode
      // Extract base64 data from data URL
      const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '');
      const mimeType = imageData.match(/^data:(image\/[^;]+);/)?.[1] || 'image/png';

      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      });
    }

    parts.push({ text: prompt });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['image', 'text'],
            responseMimeType: 'image/png',
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ImageGen] Google API error:', response.status, errorText);
      return { success: false, error: `Google API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inline_data?: { mime_type?: string; data?: string } }> } }> };

    // Extract image from response
    const candidates = data.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inline_data) {
          const mimeType = part.inline_data.mime_type || 'image/png';
          const base64 = part.inline_data.data;
          return { success: true, imageData: `data:${mimeType};base64,${base64}` };
        }
      }
    }

    // Check for text response
    const textPart = candidates[0]?.content?.parts?.find((p: any) => p.text);
    if (textPart) {
      return { success: false, error: 'Model returned text instead of image: ' + textPart.text.substring(0, 200) };
    }

    return { success: false, error: 'No image in response' };
  } catch (error) {
    console.error('[ImageGen] Google API error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Main image generation endpoint
router.post('/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { prompt, imageData, selection, provider: requestedProvider, model: requestedModel } = req.body as ImageGenerationRequest;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
      return;
    }

    // Get user's API keys and preferences
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    const user = userResult[0];
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    // Determine provider and model to use
    const provider = requestedProvider || user.imageAiProvider || 'openrouter';
    const model = requestedModel || user.imageAiModel || 'google/gemini-2.5-flash-image';

    // Get API key for the provider
    const apiKeys = user.imageAiKeys as Record<string, string> | null;
    const apiKey = apiKeys?.[provider];

    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: `No API key configured for ${provider}. Please add your API key in Settings.`,
      });
      return;
    }

    // Validate model
    if (!AVAILABLE_MODELS[model as keyof typeof AVAILABLE_MODELS]) {
      res.status(400).json({
        success: false,
        error: `Invalid model: ${model}`,
      });
      return;
    }

    console.log(`[ImageGen] Generating with ${provider}/${model} for user ${user.id}`);

    let result: { success: boolean; imageData?: string; error?: string };

    if (provider === 'google') {
      result = await generateWithGoogle(apiKey, model, prompt, imageData);
    } else {
      // OpenRouter or CometAPI (OpenAI-compatible)
      const endpoint = PROVIDER_ENDPOINTS[provider as 'openrouter' | 'cometapi'];
      result = await generateWithOpenAICompatible(apiKey, endpoint.baseUrl, model, prompt, imageData);
    }

    if (result.success && result.imageData) {
      res.json({
        success: true,
        data: {
          imageData: result.imageData,
          provider,
          model,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Image generation failed',
      });
    }
  } catch (error) {
    console.error('[ImageGen] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// Get available models and providers
router.get('/models', requireAuth, async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      models: Object.entries(AVAILABLE_MODELS).map(([id, info]) => ({
        id,
        ...info,
      })),
      providers: [
        { id: 'openrouter', name: 'OpenRouter', description: 'Access multiple AI models through OpenRouter' },
        { id: 'cometapi', name: 'CometAPI', description: 'Alternative API provider' },
        { id: 'google', name: 'Google AI', description: 'Direct access to Google Gemini models' },
      ],
    },
  });
});

export default router;
