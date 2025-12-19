import SessionLayout from './AgentLayout';
import type { GitHubRepository } from '@/shared';

interface EditorPageWrapperProps {
  isEmbedded?: boolean;
  selectedRepo?: string;
  baseBranch?: string;
  branch?: string;
  onRepoChange?: (repo: string) => void;
  onBaseBranchChange?: (branch: string) => void;
  repositories?: GitHubRepository[];
  isLoadingRepos?: boolean;
  isLocked?: boolean;
  titleActions?: React.ReactNode;
  prActions?: React.ReactNode;
  session?: any;
  children: React.ReactNode;
}

/**
 * Wrapper component for editor pages that conditionally wraps content in SessionLayout.
 * When isEmbedded is true (split view), it skips the SessionLayout wrapper.
 * When isEmbedded is false (standalone), it wraps content in SessionLayout.
 */
export default function EditorPageWrapper({
  isEmbedded = false,
  children,
  ...sessionLayoutProps
}: EditorPageWrapperProps) {
  // When embedded in split view, just render the content directly
  if (isEmbedded) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-base-200">
        {children}
      </div>
    );
  }

  // When standalone, wrap in SessionLayout
  return (
    <SessionLayout {...sessionLayoutProps}>
      {children}
    </SessionLayout>
  );
}
