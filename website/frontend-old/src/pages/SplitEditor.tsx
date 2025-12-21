import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SessionLayout from '@/components/AgentLayout';
import SplitEditorLayout, { parseSplitRoute } from '@/components/SplitEditorLayout';
import { sessionsApi, githubApi } from '@/lib/api';
import { useAuthStore, useSplitViewStore } from '@/lib/store';
import { useEffect } from 'react';
import type { GitHubRepository } from '@/shared';

export default function SplitEditor() {
  const { sessionId, splitPages } = useParams<{ sessionId?: string; splitPages: string }>();
  const { user } = useAuthStore();
  const { setLastConfig } = useSplitViewStore();

  // Parse the split pages from the URL
  const parsedPages = splitPages ? parseSplitRoute(splitPages) : null;

  // Fetch session data if we have a sessionId
  const { data: sessionData } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId && sessionId !== 'new',
  });

  // Fetch repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: !!user?.githubAccessToken,
  });

  const session = sessionData?.data;
  const repositories = reposData?.data ?? [];

  // Save the last split config for this session
  useEffect(() => {
    if (sessionId && parsedPages && splitPages) {
      setLastConfig(sessionId, splitPages);
    }
  }, [sessionId, parsedPages, splitPages, setLastConfig]);

  // If invalid split route, redirect to the session's chat page
  if (!parsedPages) {
    if (sessionId) {
      return <Navigate to={`/session/${sessionId}/chat`} replace />;
    }
    return <Navigate to="/sessions" replace />;
  }

  const [leftPage, rightPage] = parsedPages;

  return (
    <SessionLayout
      selectedRepo={session?.repositoryUrl}
      branch={session?.branch}
      repositories={repositories as GitHubRepository[]}
      isLoadingRepos={isLoadingRepos}
      isLocked={!!sessionId && !!session}
      session={session}
    >
      <SplitEditorLayout leftPage={leftPage} rightPage={rightPage} />
    </SessionLayout>
  );
}
