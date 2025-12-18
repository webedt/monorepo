import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';

/**
 * Workspace Sounds Editor - Live workspace mode for managing audio files.
 * Uses GitHub API directly (Phase 4 will implement full functionality).
 */
export default function WorkspaceSounds() {
  const workspace = useWorkspaceParams();

  if (!workspace) {
    return null;
  }

  const { owner, repo, branch } = workspace;

  return (
    <WorkspaceLayout>
      <div className="flex flex-col items-center justify-center h-full bg-base-200 p-8">
        <div className="text-center max-w-lg">
          <div className="text-6xl mb-4">
            <svg className="w-16 h-16 mx-auto text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Sounds</h1>
          <p className="text-base-content/70 mb-6">
            Manage audio files in <span className="font-mono text-primary">{owner}/{repo}</span>
          </p>

          <div className="bg-base-100 rounded-lg p-4 mb-6 text-left">
            <h3 className="font-semibold mb-2">Branch Context</h3>
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 16 16">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              <span className="font-mono">{branch}</span>
            </div>
          </div>

          <div className="alert alert-info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span>GitHub API integration coming in Phase 4. Audio library and upload will use the GitHub API directly.</span>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
