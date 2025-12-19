/**
 * API Utilities
 * Simple fetch wrapper for API calls
 */

export interface ApiOptions extends RequestInit {
  params?: Record<string, string>;
}

export interface ApiError {
  message: string;
  status: number;
  data?: unknown;
}

export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: HeadersInit;

  constructor(baseUrl: string = '/api', defaultHeaders: HeadersInit = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...defaultHeaders,
    };
  }

  private buildUrl(endpoint: string, params?: Record<string, string>): string {
    const url = new URL(endpoint, window.location.origin);

    if (!endpoint.startsWith('/')) {
      url.pathname = `${this.baseUrl}/${endpoint}`;
    } else if (!endpoint.startsWith(this.baseUrl)) {
      url.pathname = `${this.baseUrl}${endpoint}`;
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        data = await response.text();
      }

      const error: ApiError = {
        message: (data as { message?: string })?.message ?? response.statusText,
        status: response.status,
        data,
      };

      throw error;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return response.text() as unknown as T;
  }

  async request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);

    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...this.defaultHeaders,
        ...fetchOptions.headers,
      },
      credentials: 'include',
    });

    return this.handleResponse<T>(response);
  }

  async get<T>(endpoint: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Create an EventSource for SSE endpoints
   */
  sse(endpoint: string, options?: { params?: Record<string, string> }): EventSource {
    const url = this.buildUrl(endpoint, options?.params);
    return new EventSource(url, { withCredentials: true });
  }
}

// Default API client instance
export const api = new ApiClient('/api');

// Helper to check if an error is an ApiError
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    'status' in error
  );
}
