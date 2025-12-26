/**
 * Code Analyzer Service
 * Uses Claude Web to analyze code for improvements, bugs, and tech debt
 */

import { logger } from '../utils/logging/logger.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';

import type { ClaudeRemoteAuth } from '../claudeWeb/types.js';
import type { AnalysisResult } from './types.js';
import type { AnalysisOptions } from './types.js';

const ANALYSIS_PROMPT = `Analyze this codebase and identify:
1. **Bugs**: Logic errors, edge cases, potential crashes
2. **Security Issues**: Vulnerabilities, unsafe practices
3. **Technical Debt**: Code duplication, outdated patterns, missing abstractions
4. **Improvements**: Performance optimizations, better practices

For each finding, provide:
- Category: bug | improvement | tech-debt | security
- Severity: critical | high | medium | low
- File and line number (if applicable)
- Brief description
- Suggested fix

Focus on actionable items that can be fixed programmatically.

Output as JSON array:
[{"category": "...", "severity": "...", "file": "...", "line": N, "description": "...", "suggestedFix": "..."}]`;

export class CodeAnalyzerService {
  private client: ClaudeWebClient;

  constructor(auth: ClaudeRemoteAuth, environmentId: string) {
    this.client = new ClaudeWebClient({
      accessToken: auth.accessToken,
      environmentId,
    });
  }

  async analyze(
    gitUrl: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult[]> {
    logger.info('Starting code analysis', {
      component: 'CodeAnalyzerService',
      gitUrl,
      focus: options?.focus || 'all',
    });

    const focusPrompt = this.buildFocusPrompt(options?.focus);
    const maxItems = options?.maxItems || 20;

    const prompt = `${ANALYSIS_PROMPT}

${focusPrompt}

Limit results to top ${maxItems} most important items.
Only return the JSON array, no other text.`;

    try {
      let analysisOutput = '';

      const result = await this.client.execute(
        {
          prompt,
          gitUrl,
        },
        (event) => {
          // Capture assistant output
          if (event.type === 'assistant' && event.message?.content) {
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text') {
                  analysisOutput += block.text;
                }
              }
            }
          }
        }
      );

      logger.info('Code analysis complete', {
        component: 'CodeAnalyzerService',
        sessionId: result.sessionId,
        status: result.status,
      });

      // Parse the JSON output
      const results = this.parseAnalysisOutput(analysisOutput);

      // Filter by focus if specified
      if (options?.focus && options.focus !== 'all') {
        return results.filter((r) => r.category === options.focus);
      }

      return results.slice(0, maxItems);
    } catch (error) {
      logger.error('Code analysis failed', error, {
        component: 'CodeAnalyzerService',
        gitUrl,
      });
      throw error;
    }
  }

  private buildFocusPrompt(focus?: string): string {
    switch (focus) {
      case 'bugs':
        return 'Focus primarily on bugs and logic errors.';
      case 'security':
        return 'Focus primarily on security vulnerabilities and unsafe practices.';
      case 'tech-debt':
        return 'Focus primarily on technical debt and code quality issues.';
      case 'improvements':
        return 'Focus primarily on performance and architectural improvements.';
      default:
        return 'Analyze all categories equally.';
    }
  }

  private parseAnalysisOutput(output: string): AnalysisResult[] {
    try {
      // Extract JSON from the output (might have surrounding text)
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in analysis output', {
          component: 'CodeAnalyzerService',
          outputLength: output.length,
        });
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((item) => ({
        category: item.category || 'improvement',
        severity: item.severity || 'medium',
        file: item.file,
        line: item.line,
        description: item.description || '',
        suggestedFix: item.suggestedFix,
      }));
    } catch (error) {
      logger.warn('Failed to parse analysis output', {
        component: 'CodeAnalyzerService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
