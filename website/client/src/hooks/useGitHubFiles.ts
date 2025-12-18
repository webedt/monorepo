import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { githubApi } from '@/lib/api';

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file';
  sha: string;
  size?: number;
}

export interface FolderNode {
  name: string;
  path: string;
  type: 'folder';
  children: TreeNode[];
}

export type TreeNode = FileNode | FolderNode;

/**
 * Transform flat GitHub tree entries into a nested tree structure
 */
function buildFileTree(entries: GitHubTreeEntry[]): TreeNode[] {
  const root: FolderNode = { name: '', path: '', type: 'folder', children: [] };

  // Sort entries so folders come before files, then alphabetically
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'tree' ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  for (const entry of sortedEntries) {
    const parts = entry.path.split('/');
    let current = root;

    // Navigate/create folder path
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join('/');
      let folder = current.children.find(
        (child): child is FolderNode => child.type === 'folder' && child.name === folderName
      );

      if (!folder) {
        folder = { name: folderName, path: folderPath, type: 'folder', children: [] };
        current.children.push(folder);
      }
      current = folder;
    }

    // Add the entry
    const name = parts[parts.length - 1];
    if (entry.type === 'blob') {
      current.children.push({
        name,
        path: entry.path,
        type: 'file',
        sha: entry.sha,
        size: entry.size,
      });
    } else if (entry.type === 'tree') {
      // Only add folder if it doesn't exist yet
      if (!current.children.find((child) => child.type === 'folder' && child.name === name)) {
        current.children.push({
          name,
          path: entry.path,
          type: 'folder',
          children: [],
        });
      }
    }
  }

  // Sort children at each level: folders first, then files
  const sortChildren = (node: FolderNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    node.children.filter((child): child is FolderNode => child.type === 'folder').forEach(sortChildren);
  };
  sortChildren(root);

  return root.children;
}

interface UseGitHubFilesOptions {
  owner: string;
  repo: string;
  branch: string;
  enabled?: boolean;
}

/**
 * Hook for working with GitHub repository files.
 * Provides file tree, file content, and file operations.
 */
export function useGitHubFiles({ owner, repo, branch, enabled = true }: UseGitHubFilesOptions) {
  const queryClient = useQueryClient();

  // Fetch the file tree
  const treeQuery = useQuery({
    queryKey: ['github-tree', owner, repo, branch],
    queryFn: async () => {
      const response = await githubApi.getTree(owner, repo, branch, true);
      if (!response.data?.tree) {
        throw new Error('Failed to fetch file tree');
      }
      return {
        entries: response.data.tree as GitHubTreeEntry[],
        tree: buildFileTree(response.data.tree as GitHubTreeEntry[]),
      };
    },
    enabled: enabled && !!owner && !!repo && !!branch,
  });

  // Mutation to update/create a file
  const updateFileMutation = useMutation({
    mutationFn: async ({
      path,
      content,
      sha,
      message,
    }: {
      path: string;
      content: string;
      sha?: string;
      message?: string;
    }) => {
      return githubApi.updateFile(owner, repo, path, {
        content,
        branch,
        sha,
        message: message || `Update ${path}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-tree', owner, repo, branch] });
    },
  });

  // Mutation to delete a file
  const deleteFileMutation = useMutation({
    mutationFn: async ({ path, sha, message }: { path: string; sha?: string; message?: string }) => {
      return githubApi.deleteFile(owner, repo, path, {
        branch,
        sha,
        message: message || `Delete ${path}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-tree', owner, repo, branch] });
    },
  });

  // Mutation to rename a file
  const renameFileMutation = useMutation({
    mutationFn: async ({
      oldPath,
      newPath,
      message,
    }: {
      oldPath: string;
      newPath: string;
      message?: string;
    }) => {
      return githubApi.renameFile(owner, repo, oldPath, {
        newPath,
        branch,
        message: message || `Rename ${oldPath} to ${newPath}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-tree', owner, repo, branch] });
    },
  });

  // Mutation to commit multiple files
  const commitMutation = useMutation({
    mutationFn: async ({
      files,
      deletions,
      message,
    }: {
      files?: Array<{ path: string; content: string; encoding?: string }>;
      deletions?: string[];
      message?: string;
    }) => {
      return githubApi.commit(owner, repo, {
        branch,
        files,
        deletions,
        message: message || 'Commit changes',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-tree', owner, repo, branch] });
    },
  });

  // Function to get file content
  const getFileContent = async (path: string): Promise<{ content: string; sha: string } | null> => {
    try {
      const response = await githubApi.getFileContent(owner, repo, path, branch);
      if (response.data?.content && response.data?.sha) {
        // GitHub returns base64 encoded content
        const content = atob(response.data.content.replace(/\n/g, ''));
        return { content, sha: response.data.sha };
      }
      return null;
    } catch (error) {
      console.error('Failed to get file content:', error);
      return null;
    }
  };

  return {
    // Tree data
    tree: treeQuery.data?.tree || [],
    entries: treeQuery.data?.entries || [],
    isLoadingTree: treeQuery.isLoading,
    treeError: treeQuery.error,
    refetchTree: treeQuery.refetch,

    // File operations
    getFileContent,
    updateFile: updateFileMutation.mutateAsync,
    deleteFile: deleteFileMutation.mutateAsync,
    renameFile: renameFileMutation.mutateAsync,
    commit: commitMutation.mutateAsync,

    // Mutation states
    isUpdating: updateFileMutation.isPending,
    isDeleting: deleteFileMutation.isPending,
    isRenaming: renameFileMutation.isPending,
    isCommitting: commitMutation.isPending,
  };
}
