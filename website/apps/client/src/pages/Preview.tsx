import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';
import SessionLayout from '@/components/SessionLayout';
import type { ChatSession } from '@webedt/shared';

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

  const session: ChatSession | undefined = sessionData?.data;
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
