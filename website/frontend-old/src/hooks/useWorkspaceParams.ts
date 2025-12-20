import { useParams } from 'react-router-dom';

export interface WorkspaceParams {
  owner: string;
  repo: string;
  branch: string;
  page?: string;
}

/**
 * Hook to extract workspace parameters from URL.
 * Expects routes like: /github/:owner/:repo/:branch/:page
 */
export function useWorkspaceParams(): WorkspaceParams | null {
  const { owner, repo, branch, page } = useParams<{
    owner: string;
    repo: string;
    branch: string;
    page?: string;
  }>();

  if (!owner || !repo || !branch) {
    return null;
  }

  return {
    owner,
    repo,
    // Decode branch name in case it was URL-encoded
    branch: decodeURIComponent(branch),
    page,
  };
}

/**
 * Get the session path format for storage operations.
 * Format: owner__repo__branch (double underscore separator)
 */
export function getWorkspaceSessionPath(owner: string, repo: string, branch: string): string {
  // Replace any slashes in branch name with hyphens for storage path
  const safeBranch = branch.replace(/\//g, '-');
  return `${owner}__${repo}__${safeBranch}`;
}
