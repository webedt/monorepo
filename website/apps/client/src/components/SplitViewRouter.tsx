import { useParams, Navigate } from 'react-router-dom';
import SessionLayout from '@/components/SessionLayout';
import SplitLayout, { type SplitPageName, getPageDisplayName } from '@/components/SplitLayout';
import { useSplitViewStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';

// Valid page names for split view
const VALID_PAGES: SplitPageName[] = ['chat', 'code', 'images', 'sound', 'scene-editor', 'preview'];

function isValidPage(page: string): page is SplitPageName {
  return VALID_PAGES.includes(page as SplitPageName);
}

export default function SplitViewRouter() {
  const { sessionId, pages } = useParams<{ sessionId: string; pages: string }>();
  const { getSplitPrefs, setSplitRatio } = useSplitViewStore();

  // Load session data for SessionLayout
  const { data: sessionData } = useQuery({
    queryKey: ['session-for-layout', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
  });

  const session = sessionData?.data;

  // Parse the pages parameter
  if (!pages || !sessionId) {
    return <Navigate to="/sessions" replace />;
  }

  // Check if this is a split view (contains '+')
  if (pages.includes('+')) {
    const [leftPage, rightPage] = pages.split('+');

    // Validate both pages
    if (!isValidPage(leftPage) || !isValidPage(rightPage)) {
      // Invalid page names - redirect to chat
      return <Navigate to={`/session/${sessionId}/chat`} replace />;
    }

    // Don't allow same page on both sides
    if (leftPage === rightPage) {
      return <Navigate to={`/session/${sessionId}/${leftPage}`} replace />;
    }

    // Get saved preferences for this session
    const prefs = getSplitPrefs(sessionId);

    // Construct repo URL if available
    const selectedRepoUrl = session?.repositoryOwner && session?.repositoryName
      ? `https://github.com/${session.repositoryOwner}/${session.repositoryName}.git`
      : undefined;

    return (
      <SessionLayout
        selectedRepo={selectedRepoUrl}
        baseBranch={session?.baseBranch}
        branch={session?.branch}
        isLocked={!!session}
        session={session}
      >
        <div className="h-full flex flex-col">
          {/* Split view header bar */}
          <div className="bg-base-200 border-b border-base-300 px-4 py-1 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base-content/70">Split View:</span>
              <span className="font-medium">{getPageDisplayName(leftPage)}</span>
              <span className="text-base-content/50">+</span>
              <span className="font-medium">{getPageDisplayName(rightPage)}</span>
            </div>
            <a
              href={`/session/${sessionId}/${leftPage}`}
              className="btn btn-ghost btn-xs gap-1"
              title="Exit split view"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close Split
            </a>
          </div>

          {/* Split layout */}
          <div className="flex-1 min-h-0">
            <SplitLayout
              leftPage={leftPage}
              rightPage={rightPage}
              sessionId={sessionId}
              initialRatio={prefs.ratio}
              orientation={prefs.orientation}
              onRatioChange={(ratio) => setSplitRatio(sessionId, ratio)}
            />
          </div>
        </div>
      </SessionLayout>
    );
  }

  // Not a split view - redirect to the appropriate single page
  // This handles cases where someone navigates to /session/:id/:page directly
  if (isValidPage(pages)) {
    return <Navigate to={`/session/${sessionId}/${pages}`} replace />;
  }

  // Unknown page - redirect to chat
  return <Navigate to={`/session/${sessionId}/chat`} replace />;
}
