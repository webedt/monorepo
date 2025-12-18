import BranchSelector from '@/components/workspace/BranchSelector';

/**
 * Workspace page - entry point for selecting a repository and branch
 * to start working in the live workspace.
 */
export default function Workspace() {
  return (
    <div className="min-h-screen bg-base-200 py-8">
      <BranchSelector variant="page" defaultPage="code" />
    </div>
  );
}
