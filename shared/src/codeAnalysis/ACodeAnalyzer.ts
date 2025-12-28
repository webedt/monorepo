import { AService } from '../services/abstracts/AService.js';

import type { CodeAnalysisParams } from './types.js';
import type { CodeAnalysisResult } from './types.js';
import type { CodeAnalyzerConfig } from './types.js';

export abstract class ACodeAnalyzer extends AService {
  override readonly order: number = 60;

  abstract configure(
    config: CodeAnalyzerConfig
  ): void;

  abstract analyze(
    params: CodeAnalysisParams
  ): Promise<CodeAnalysisResult>;

  abstract isAvailable(): boolean;
}
