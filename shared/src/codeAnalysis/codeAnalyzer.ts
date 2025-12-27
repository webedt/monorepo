/**
 * Code Analyzer Implementation
 *
 * Uses ClaudeWebClient to perform AI-powered code analysis.
 * Analyzes code quality, security, patterns, and more.
 */

import { ACodeAnalyzer } from './ACodeAnalyzer.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';
import { getClaudeCredentials } from '../auth/claudeAuth.js';
import { logger } from '../utils/logging/logger.js';
import { CLAUDE_ENVIRONMENT_ID, LLM_FALLBACK_REPO_URL } from '../config/env.js';

import type { CodeAnalysisParams } from './types.js';
import type { CodeAnalysisResult } from './types.js';
import type { CodeAnalyzerConfig } from './types.js';
import type { AnalysisFinding } from './types.js';
import type { AnalysisSummary } from './types.js';
import type { AnalysisType } from './types.js';
import type { SessionEvent } from '../claudeWeb/types.js';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_FINDINGS = 20;

/**
 * Build the analysis prompt based on the analysis type
 */
function buildAnalysisPrompt(params: CodeAnalysisParams): string {
  const { code, filePaths, analysisType = 'general', language, context, maxFindings = DEFAULT_MAX_FINDINGS, customPrompt } = params;

  const typePrompts: Record<AnalysisType, string> = {
    quality: `Focus on code quality and maintainability:
- Code style consistency
- Naming conventions
- Function/method length and complexity
- DRY (Don't Repeat Yourself) violations
- SOLID principles adherence
- Documentation completeness`,

    security: `Focus on security vulnerabilities and risks:
- OWASP Top 10 vulnerabilities
- Injection risks (SQL, command, XSS)
- Authentication and authorization issues
- Sensitive data exposure
- Security misconfigurations
- Insecure dependencies`,

    performance: `Focus on performance issues and optimizations:
- Algorithm efficiency (time/space complexity)
- Memory leaks and resource management
- Database query optimization
- Caching opportunities
- Unnecessary computations
- I/O bottlenecks`,

    patterns: `Focus on design patterns and architecture:
- Design pattern usage and applicability
- Anti-patterns present
- Architectural concerns
- Coupling and cohesion
- Module organization
- Dependency management`,

    complexity: `Focus on code complexity analysis:
- Cyclomatic complexity
- Cognitive complexity
- Nesting depth
- Function length
- Parameter count
- Conditional logic complexity`,

    refactor: `Focus on refactoring opportunities:
- Code duplication
- Long methods/functions
- Large classes/modules
- Feature envy
- Data clumps
- Switch statement abuse`,

    general: `Perform a comprehensive code review covering:
- Code quality and readability
- Potential bugs or errors
- Security concerns
- Performance considerations
- Best practices
- Improvement suggestions`,
  };

  const analysisPrompt = typePrompts[analysisType];
  const languageHint = language ? `The code is written in ${language}.` : '';
  const contextHint = context ? `Context: ${context}` : '';
  const filesHint = filePaths?.length ? `Focus on these files: ${filePaths.join(', ')}` : '';

  let prompt = `You are an expert code reviewer. Analyze the following code and provide structured feedback.

${analysisPrompt}

${languageHint}
${contextHint}
${filesHint}

Return your analysis as a JSON object with this structure:
{
  "findings": [
    {
      "severity": "critical|high|medium|low|info",
      "category": "string (e.g., 'security', 'performance', 'style')",
      "title": "Short descriptive title",
      "description": "Detailed explanation of the issue",
      "file": "optional file path",
      "line": optional line number,
      "suggestion": "How to fix or improve"
    }
  ],
  "assessment": "Overall assessment paragraph with key recommendations"
}

Limit findings to the top ${maxFindings} most important issues.
Return ONLY the JSON object, no markdown formatting or additional text.`;

  if (code) {
    prompt += `\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\``;
  }

  if (customPrompt) {
    prompt += `\n\nAdditional instructions: ${customPrompt}`;
  }

  return prompt;
}

/**
 * Parse the analysis response from Claude
 */
function parseAnalysisResponse(content: string): { findings: AnalysisFinding[]; assessment: string } {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('No JSON found in analysis response', { component: 'CodeAnalyzer', contentLength: content.length });
    return {
      findings: [],
      assessment: content.trim() || 'Unable to parse analysis response.',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { findings?: AnalysisFinding[]; assessment?: string };

    const findings = (parsed.findings || []).filter((f): f is AnalysisFinding => {
      return (
        typeof f.severity === 'string' &&
        ['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) &&
        typeof f.title === 'string' &&
        typeof f.description === 'string'
      );
    });

    return {
      findings,
      assessment: parsed.assessment || 'Analysis complete.',
    };
  } catch (parseError) {
    logger.warn('Failed to parse analysis JSON', {
      component: 'CodeAnalyzer',
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    return {
      findings: [],
      assessment: content.trim() || 'Unable to parse analysis response.',
    };
  }
}

/**
 * Calculate summary statistics from findings
 */
function calculateSummary(findings: AnalysisFinding[]): AnalysisSummary {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    if (finding.severity in counts) {
      counts[finding.severity as keyof typeof counts]++;
    }
  }

  // Calculate a simple score (100 = no issues, deduct points based on severity)
  const deductions = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 1,
  };

  let score = 100;
  for (const [severity, count] of Object.entries(counts)) {
    score -= deductions[severity as keyof typeof deductions] * count;
  }

  return {
    totalFindings: findings.length,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    infoCount: counts.info,
    overallScore: Math.max(0, Math.min(100, score)),
  };
}

export class CodeAnalyzer extends ACodeAnalyzer {
  private accessToken?: string;
  private environmentId?: string;
  private fallbackRepoUrl: string;
  private timeoutMs: number;
  private client?: ClaudeWebClient;

  constructor(config: CodeAnalyzerConfig = {}) {
    super();
    this.accessToken = config.accessToken;
    this.environmentId = config.environmentId || CLAUDE_ENVIRONMENT_ID;
    this.fallbackRepoUrl = config.fallbackRepoUrl || LLM_FALLBACK_REPO_URL;
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  configure(config: CodeAnalyzerConfig): void {
    if (config.accessToken !== undefined) {
      this.accessToken = config.accessToken;
      this.client = undefined; // Reset client to use new token
    }
    if (config.environmentId !== undefined) {
      this.environmentId = config.environmentId;
      this.client = undefined;
    }
    if (config.fallbackRepoUrl !== undefined) {
      this.fallbackRepoUrl = config.fallbackRepoUrl;
    }
    if (config.timeoutMs !== undefined) {
      this.timeoutMs = config.timeoutMs;
    }
  }

  isAvailable(): boolean {
    // Check if we have an environment ID and can potentially get credentials
    return Boolean(this.environmentId);
  }

  private async getClient(): Promise<ClaudeWebClient> {
    if (this.client) {
      return this.client;
    }

    let token = this.accessToken;

    if (!token) {
      const credentials = await getClaudeCredentials({ checkDatabase: true });
      if (!credentials) {
        throw new Error('Claude credentials not available for code analysis');
      }
      token = credentials.accessToken;
    }

    if (!this.environmentId) {
      throw new Error('CLAUDE_ENVIRONMENT_ID not configured for code analysis');
    }

    this.client = new ClaudeWebClient({
      accessToken: token,
      environmentId: this.environmentId,
    });

    return this.client;
  }

  async analyze(params: CodeAnalysisParams): Promise<CodeAnalysisResult> {
    const startTime = Date.now();

    if (!params.code && !params.gitUrl) {
      return {
        success: false,
        findings: [],
        summary: calculateSummary([]),
        assessment: 'Either code or gitUrl must be provided for analysis.',
        provider: 'claude-web',
        durationMs: Date.now() - startTime,
        error: 'Either code or gitUrl must be provided for analysis.',
      };
    }

    logger.info('Starting code analysis', {
      component: 'CodeAnalyzer',
      analysisType: params.analysisType || 'general',
      hasCode: Boolean(params.code),
      hasGitUrl: Boolean(params.gitUrl),
      fileCount: params.filePaths?.length,
    });

    try {
      const client = await this.getClient();

      // Build the analysis prompt
      const prompt = buildAnalysisPrompt(params);

      // Use the provided gitUrl or fallback repo
      const gitUrl = params.gitUrl || this.fallbackRepoUrl;

      // Collect response
      const responseBlocks: string[] = [];
      let sessionId: string | undefined;
      let totalCost: number | undefined;

      const onEvent = (event: SessionEvent) => {
        if (event.type === 'assistant' && event.message) {
          const content = event.message.content;
          if (typeof content === 'string') {
            responseBlocks.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                responseBlocks.push(block.text);
              }
            }
          }
        }

        if (event.type === 'result') {
          if (event.total_cost_usd !== undefined) {
            totalCost = event.total_cost_usd;
          }
        }
      };

      // Generate session title
      const analysisTypeLabel = params.analysisType || 'general';
      const sessionTitle = `Code Analysis: ${analysisTypeLabel}`;

      // Execute the analysis
      const result = await client.execute(
        {
          prompt,
          gitUrl,
          title: sessionTitle,
        },
        onEvent
      );

      sessionId = result.sessionId;

      // Archive the session to clean up
      try {
        await client.archiveSession(sessionId);
        logger.debug('Archived code analysis session', {
          component: 'CodeAnalyzer',
          sessionId,
        });
      } catch (archiveError) {
        logger.warn('Failed to archive code analysis session', {
          component: 'CodeAnalyzer',
          sessionId,
          error: archiveError instanceof Error ? archiveError.message : String(archiveError),
        });
      }

      const responseText = responseBlocks.join('');

      if (!responseText) {
        throw new Error('No response received from code analysis');
      }

      // Parse the response
      const { findings, assessment } = parseAnalysisResponse(responseText);
      const summary = calculateSummary(findings);

      const durationMs = Date.now() - startTime;

      logger.info('Code analysis complete', {
        component: 'CodeAnalyzer',
        sessionId,
        findingCount: findings.length,
        durationMs,
        cost: totalCost,
      });

      return {
        success: true,
        findings,
        summary,
        assessment,
        provider: 'claude-web',
        sessionId,
        durationMs,
        cost: totalCost,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Code analysis failed', {
        component: 'CodeAnalyzer',
        error: errorMessage,
      });

      return {
        success: false,
        findings: [],
        summary: calculateSummary([]),
        assessment: 'Code analysis failed.',
        provider: 'claude-web',
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }
}
