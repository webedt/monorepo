import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';

/**
 * Workspace Chat - Live Chat for the branch workspace.
 * Messages are stored per-branch, LLM runs locally.
 * (Phase 5 will implement full functionality)
 */
export default function WorkspaceChat() {
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
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Live Chat</h1>
          <p className="text-base-content/70 mb-6">
            Chat with AI about <span className="font-mono text-primary">{owner}/{repo}</span>
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
            <span>Live Chat implementation coming in Phase 5. This will allow local LLM execution with branch-specific context.</span>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
