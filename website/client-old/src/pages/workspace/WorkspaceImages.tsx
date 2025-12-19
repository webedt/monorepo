import { useState, useCallback, useMemo } from 'react';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import { useGitHubFiles, TreeNode } from '@/hooks/useGitHubFiles';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';

// Image file extensions
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

// Helper to check if a file is an image
const isImageFile = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.includes(ext) : false;
};

// Helper to collect all image files from tree
const collectImageFiles = (nodes: TreeNode[], result: TreeNode[] = []): TreeNode[] => {
  for (const node of nodes) {
    if (node.type === 'file' && isImageFile(node.path)) {
      result.push(node);
    } else if (node.type === 'folder') {
      collectImageFiles(node.children, result);
    }
  }
  return result;
};

interface ImagePreviewProps {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  selected: boolean;
  onClick: () => void;
}

function ImagePreview({ owner, repo, branch, path, selected, onClick }: ImagePreviewProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const filename = path.split('/').pop() || path;

  // GitHub raw content URL
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}`;

  return (
    <button
      onClick={onClick}
      className={`relative group aspect-square rounded-lg overflow-hidden border-2 transition-all ${
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-base-300 hover:border-primary/50'
      }`}
    >
      {!loaded && !error && (
        <div className="absolute inset-0 bg-base-200 flex items-center justify-center">
          <span className="loading loading-spinner loading-sm"></span>
        </div>
      )}
      {error ? (
        <div className="absolute inset-0 bg-base-200 flex items-center justify-center">
          <svg className="w-8 h-8 text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
      ) : (
        <img
          src={rawUrl}
          alt={filename}
          className={`w-full h-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
      {/* Overlay with filename */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-white text-xs truncate">{filename}</p>
      </div>
    </button>
  );
}

/**
 * Workspace Images - Live workspace mode for managing images.
 * Uses GitHub API directly for file operations.
 */
export default function WorkspaceImages() {
  const workspace = useWorkspaceParams();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { owner, repo, branch } = workspace || { owner: '', repo: '', branch: '' };

  const {
    tree,
    isLoadingTree,
    treeError,
    refetchTree,
  } = useGitHubFiles({
    owner,
    repo,
    branch,
    enabled: !!workspace,
  });

  // Collect all image files from the tree
  const imageFiles = useMemo(() => collectImageFiles(tree), [tree]);

  const handleSelectImage = useCallback((path: string) => {
    setSelectedImage(path === selectedImage ? null : path);
  }, [selectedImage]);

  if (!workspace) {
    return null;
  }

  const selectedImageUrl = selectedImage
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${selectedImage}`
    : null;

  return (
    <WorkspaceLayout>
      <div className="flex h-full">
        {/* Image Gallery */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedImage ? 'w-1/2' : 'w-full'}`}>
          {/* Header */}
          <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Images</span>
              <span className="badge badge-sm">{imageFiles.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="btn-group">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`btn btn-xs ${viewMode === 'grid' ? 'btn-active' : ''}`}
                  title="Grid view"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`btn btn-xs ${viewMode === 'list' ? 'btn-active' : ''}`}
                  title="List view"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
                  </svg>
                </button>
              </div>
              <button
                onClick={() => refetchTree()}
                className="btn btn-ghost btn-xs"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoadingTree ? (
              <div className="flex items-center justify-center h-full">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : treeError ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-error">
                  <p>Failed to load images</p>
                  <button onClick={() => refetchTree()} className="btn btn-sm btn-ghost mt-2">
                    Retry
                  </button>
                </div>
              </div>
            ) : imageFiles.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-base-content/60">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  <p>No images found in this repository</p>
                  <p className="text-sm mt-1">Upload images to see them here</p>
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {imageFiles.map((file) => (
                  <ImagePreview
                    key={file.path}
                    owner={owner}
                    repo={repo}
                    branch={branch}
                    path={file.path}
                    selected={selectedImage === file.path}
                    onClick={() => handleSelectImage(file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {imageFiles.map((file) => {
                  const filename = file.path.split('/').pop() || file.path;
                  const folder = file.path.replace(filename, '').replace(/\/$/, '') || '/';
                  return (
                    <button
                      key={file.path}
                      onClick={() => handleSelectImage(file.path)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        selectedImage === file.path
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-base-200'
                      }`}
                    >
                      <img
                        src={`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path}`}
                        alt={filename}
                        className="w-10 h-10 object-cover rounded"
                      />
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium truncate">{filename}</p>
                        <p className="text-xs text-base-content/60 truncate">{folder}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Image Preview Panel */}
        {selectedImage && selectedImageUrl && (
          <div className="w-1/2 border-l border-base-300 flex flex-col bg-base-200">
            <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
              <span className="text-sm font-medium truncate">{selectedImage.split('/').pop()}</span>
              <button
                onClick={() => setSelectedImage(null)}
                className="btn btn-ghost btn-xs"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
              <img
                src={selectedImageUrl}
                alt={selectedImage}
                className="max-w-full max-h-full object-contain"
              />
            </div>
            <div className="p-4 bg-base-100 border-t border-base-300">
              <p className="text-xs text-base-content/60 truncate">
                Path: {selectedImage}
              </p>
              <a
                href={selectedImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-outline mt-2"
              >
                Open in new tab
              </a>
            </div>
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}
