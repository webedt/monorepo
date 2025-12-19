/**
 * Common Types
 */

export interface User {
  id: string;
  email: string;
  name?: string;
  isAdmin?: boolean;
}

export interface Session {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'failed';
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
