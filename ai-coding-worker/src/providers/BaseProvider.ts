import { ExecuteRequest, UserRequestContent } from '../types';

export interface ProviderOptions {
  authentication: string;
  workspace: string;
  resumeSessionId?: string;
  providerOptions?: Record<string, any>;
}

export interface ProviderStreamEvent {
  type: string;
  data: any;
  model?: string;
}

/**
 * Base interface for all coding assistant providers
 */
export abstract class BaseProvider {
  protected authentication: string;
  protected workspace: string;

  constructor(authentication: string, workspace: string) {
    this.authentication = authentication;
    this.workspace = workspace;
  }

  /**
   * Execute a user request and stream results
   * @param userRequest The user's prompt/instruction (can be simple string or structured with images)
   * @param options Provider-specific options
   * @param onEvent Callback for each streaming event
   */
  abstract execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void>;

  /**
   * Validate the provider's access token
   */
  abstract validateToken(): Promise<boolean>;

  /**
   * Get provider name
   */
  abstract getProviderName(): string;
}
