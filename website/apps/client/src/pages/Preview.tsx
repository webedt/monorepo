import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';
import SessionLayout from '@/components/SessionLayout';

function PreviewContent({ previewUrl }: { previewUrl: string | null }) {
  if (!previewUrl) {
    return (
      <div className="h-full bg-base-300 flex flex-col">
        {/* Main preview area - No preview available */}
        <div className="flex-1 relative bg-gradient-to-br from-base-200 to-base-300 flex items-center justify-center">
          {/* Placeholder content */}
          <div className="text-center space-y-6">
            {/* Large icon */}
            <div className="w-32 h-32 mx-auto rounded-full bg-base-100/10 backdrop-blur-sm border-2 border-base-content/20 flex items-center justify-center">
              <svg className="w-16 h-16 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </div>

            {/* Text */}
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-base-content/60">No Preview Available</h2>
              <p className="text-base-content/40">Connect a repository to see the preview</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-base-300 flex flex-col">
      {/* URL bar at the top */}
      <div className="bg-base-200 border-b border-base-300 px-4 py-2 flex items-center gap-2">
        <svg className="w-4 h-4 text-base-content/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-base-content/80 hover:text-primary truncate flex-1 hover:underline"
          title={previewUrl}
        >
          {previewUrl}
        </a>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-xs gap-1 flex-shrink-0"
          title="Open in new tab"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Main preview area - Full-window iframe */}
      <div className="flex-1 relative">
        <iframe
          src={previewUrl}
          title="Repository Preview"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>
    </div>
  );
}

export default function Preview() {
  const { sessionId } = useParams();

  // Load session details to get preview URL
  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['session-details', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
  });

  const previewUrl = (sessionData?.data as any)?.previewUrl || null;

  return (
    <SessionLayout>
      {isLoading ? (
        <div className="h-full bg-base-300 flex items-center justify-center">
          <div className="text-center space-y-4">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="text-base-content/60">Loading preview...</p>
          </div>
        </div>
      ) : (
        <PreviewContent previewUrl={previewUrl} />
      )}
    </SessionLayout>
  );
}
