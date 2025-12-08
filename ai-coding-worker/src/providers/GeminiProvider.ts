import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { UserRequestContent, TextBlock, ImageBlock } from '../types';

// Dynamic import for @google/generative-ai
type GoogleGenerativeAI = import('@google/generative-ai').GoogleGenerativeAI;
type GenerativeModel = import('@google/generative-ai').GenerativeModel;
type Part = import('@google/generative-ai').Part;

/**
 * Gemini provider implementation
 *
 * Uses the Google Generative AI SDK to interact with Gemini models.
 * Supports both text and image inputs for multimodal prompting.
 */
export class GeminiProvider extends BaseProvider {
  private apiKey: string;
  private model?: string;
  private genAI?: GoogleGenerativeAI;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);
    this.model = model || 'gemini-2.0-flash-exp'; // Default to Gemini 2.0 Flash

    // Parse authentication to get API key
    try {
      const parsed = JSON.parse(authentication);
      this.apiKey = parsed.apiKey || authentication;
    } catch {
      this.apiKey = authentication;
    }

    console.log('[GeminiProvider] Provider initialized', {
      model: this.model,
      isResuming: !!isResuming
    });
  }

  /**
   * Execute a user request using Gemini
   */
  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    console.log('[GeminiProvider] Starting execution with options:', {
      workspace: this.workspace,
      model: this.model,
      hasStructuredContent: typeof userRequest !== 'string'
    });

    try {
      // Initialize the Gemini client
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(this.apiKey);

      // Get the model
      const model = this.genAI.getGenerativeModel({
        model: this.model || 'gemini-2.0-flash-exp',
        systemInstruction: this.getSystemPrompt()
      });

      // Send init event
      const sessionId = `gemini-${Date.now()}`;
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          message: 'Gemini provider initialized'
        }
      });

      // Check if execution was aborted before starting
      if (options.abortSignal?.aborted) {
        console.log('[GeminiProvider] Abort signal already aborted, skipping execution');
        throw new Error('Execution aborted before start');
      }

      // Convert user request to Gemini format
      const parts = this.convertToGeminiParts(userRequest);

      console.log('[GeminiProvider] Generating content with parts:', parts.length);

      // Use streaming for real-time responses
      const result = await model.generateContentStream(parts);

      let fullResponse = '';

      for await (const chunk of result.stream) {
        // Check for abort signal
        if (options.abortSignal?.aborted) {
          console.log('[GeminiProvider] Execution aborted during streaming');
          onEvent({
            type: 'assistant_message',
            data: {
              type: 'system',
              subtype: 'abort',
              message: 'Execution was aborted by user'
            }
          });
          throw new Error('Execution aborted by user');
        }

        const chunkText = chunk.text();
        if (chunkText) {
          fullResponse += chunkText;

          // Stream each chunk as an assistant message
          onEvent({
            type: 'assistant_message',
            data: {
              type: 'assistant',
              message: {
                content: [{
                  type: 'text',
                  text: chunkText
                }]
              }
            },
            model: this.model
          });
        }
      }

      console.log('[GeminiProvider] Response completed, total length:', fullResponse.length);

      // Send completion event
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: Date.now()
        }
      });

      console.log('[GeminiProvider] Execution completed successfully');
    } catch (error) {
      // Check if this was an abort
      const isAbort = options.abortSignal?.aborted ||
        (error instanceof Error && (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        ));

      if (isAbort) {
        console.log('[GeminiProvider] Execution was aborted');
        throw new Error('Execution aborted by user');
      }

      console.error('[GeminiProvider] Execution error:', error);
      console.error('[GeminiProvider] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

  /**
   * Get system prompt for coding assistance
   */
  private getSystemPrompt(): string {
    return `You are a helpful AI coding assistant. You are working in a project directory at ${this.workspace}.

Your capabilities:
- Help with code generation, debugging, and refactoring
- Explain code and programming concepts
- Suggest improvements and best practices
- Help with file operations and project structure

When providing code:
- Use proper formatting with code blocks
- Include file paths when creating or modifying files
- Explain your changes and reasoning

Be concise but thorough in your responses.`;
  }

  /**
   * Convert user request content to Gemini parts format
   */
  private convertToGeminiParts(content: UserRequestContent): Part[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    const parts: Part[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        parts.push({ text: (block as TextBlock).text });
      } else if (block.type === 'image') {
        const imageBlock = block as ImageBlock;
        parts.push({
          inlineData: {
            mimeType: imageBlock.source.media_type,
            data: imageBlock.source.data
          }
        });
      }
    }

    if (parts.length === 0) {
      throw new Error('No content provided in request');
    }

    return parts;
  }

  /**
   * Validate Gemini API key
   */
  async validateToken(): Promise<boolean> {
    try {
      return !!this.apiKey && this.apiKey.length > 0;
    } catch (error) {
      console.error('[GeminiProvider] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'gemini';
  }
}
