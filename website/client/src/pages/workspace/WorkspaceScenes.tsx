import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';

/**
 * Workspace Scenes Editor - Live workspace mode for managing scenes.
 * Uses GitHub API directly (Phase 4 will implement full functionality).
 */
export default function WorkspaceScenes() {
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
              <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Scenes</h1>
          <p className="text-base-content/70 mb-6">
            Manage scene files in <span className="font-mono text-primary">{owner}/{repo}</span>
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
            <span>GitHub API integration coming in Phase 4. Scene editor will use the GitHub API directly.</span>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
