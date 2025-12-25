import { ClaudeRemoteError } from '@webedt/shared';

export interface ErrorHandlerOptions {
  json?: boolean;
  silent?: boolean;
}

export function handleCommandError(
  error: unknown,
  action: string,
  options: ErrorHandlerOptions = {}
): never {
  if (options.json) {
    const errorResponse = {
      success: false,
      action,
      error: error instanceof Error ? error.message : String(error),
      type: error instanceof ClaudeRemoteError ? 'api_error' : 'error',
    };
    console.error(JSON.stringify(errorResponse));
  } else if (error instanceof ClaudeRemoteError) {
    console.error(`API Error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Error ${action}: ${error.message}`);
  } else {
    console.error(`Error ${action}:`, error);
  }
  process.exit(1);
}

export function wrapCommand<T extends unknown[]>(
  action: string,
  fn: (...args: T) => Promise<void>,
  getOptions?: (...args: T) => ErrorHandlerOptions
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const options = getOptions ? getOptions(...args) : {};
      handleCommandError(error, action, options);
    }
  };
}
