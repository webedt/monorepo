import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { storageWorkerApi } from '@/lib/api';

type FileNode = {
  name: string;
  type: 'file';
  icon: string;
};

type FolderNode = {
  name: string;
  type: 'folder';
  children: TreeNode[];
};

type TreeNode = FileNode | FolderNode;

interface SessionMetadata {
  sessionId: string;
  createdAt: string;
  lastModified: string;
  size?: number;
}

export default function Code() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId || null);
  const [selectedFile, setSelectedFile] = useState('Button.jsx');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'components']));

  // Fetch all sessions
  const { data: sessionsData, isLoading: isLoadingSessions, error: sessionsError } = useQuery({
    queryKey: ['storage-sessions'],
    queryFn: storageWorkerApi.listSessions,
  });

  // Fetch specific session if sessionId is provided
  const { data: sessionData, isLoading: isLoadingSession } = useQuery({
    queryKey: ['storage-session', selectedSessionId],
    queryFn: () => storageWorkerApi.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  const sessions: SessionMetadata[] = sessionsData?.sessions || [];

  // Update selected session when URL param changes
  useEffect(() => {
    if (sessionId) {
      setSelectedSessionId(sessionId);
    }
  }, [sessionId]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const fileTree: FolderNode = {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'components',
        type: 'folder',
        children: [
          { name: 'Button.jsx', type: 'file', icon: '🔵' },
          { name: 'Card.jsx', type: 'file', icon: '🔵' }
        ]
      },
      {
        name: 'styles',
        type: 'folder',
        children: []
      },
      { name: 'App.js', type: 'file', icon: 'JS' },
      { name: 'index.css', type: 'file', icon: 'CSS' },
      { name: 'package.json', type: 'file', icon: '📦' },
      { name: 'README.md', type: 'file', icon: '📄' }
    ]
  };

  const exampleCode = `import React from 'react';

// A simple button component
const Button = ({ children, onClick, type = 'button' }) => {
  const baseStyles = 'px-4 py-2 rounded font-semibold';
  const typeStyles = 'bg-primary text-white hover:bg-primary/90';
  return (
    <button
      type={type}
      onClick={onClick}
      className={\`\${baseStyles} \${typeStyles}\`}
    >
      {children}
    </button>
  );
};

export default Button;`;

  const renderFileTree = (node: TreeNode, level = 0): JSX.Element | JSX.Element[] => {
    const paddingLeft = level * 16 + 8;

    if (node.type === 'file') {
      return (
        <div
          key={node.name}
          onClick={() => setSelectedFile(node.name)}
          className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
            selectedFile === node.name ? 'bg-base-300' : ''
          }`}
          style={{ paddingLeft }}
        >
          <span className="text-xs">{node.icon}</span>
          <span className="text-sm">{node.name}</span>
        </div>
      );
    }

    const isExpanded = expandedFolders.has(node.name);
    return (
      <div key={node.name}>
        <div
          onClick={() => toggleFolder(node.name)}
          className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300"
          style={{ paddingLeft }}
        >
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium">{node.name}</span>
        </div>
        {isExpanded && node.children?.map(child => renderFileTree(child, level + 1))}
      </div>
    );
  };

  const CodeEditor = () => (
    <div className="flex h-full">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold uppercase tracking-wide">Explorer</span>
          <div className="flex gap-1">
            <button className="p-1 hover:bg-base-200 rounded">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
            </button>
            <button className="p-1 hover:bg-base-200 rounded">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        <div className="py-2">
          {renderFileTree(fileTree)}
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col bg-base-200">
        {/* Tab Bar */}
        <div className="flex items-center bg-base-100 border-b border-base-300">
          <div className="flex items-center gap-2 px-4 py-2 bg-base-200 border-r border-base-300">
            <span className="text-xs">🔵</span>
            <span className="text-sm">{selectedFile}</span>
            <button className="ml-2 hover:bg-base-300 rounded px-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 font-mono text-sm">
            {exampleCode.split('\n').map((line, i) => (
              <div key={i} className="flex">
                <span className="text-base-content/40 select-none w-12 text-right pr-4">
                  {i + 1}
                </span>
                <span className="text-base-content">
                  {line.length === 0 ? '\u00A0' : line}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Sessions List View
  const SessionsList = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-base-content mb-2">Code Sessions</h1>
        <p className="text-sm text-base-content/70">
          Select a session to view its code workspace
        </p>
      </div>

      {isLoadingSessions && (
        <div className="text-center py-12">
          <span className="loading loading-spinner loading-lg text-primary"></span>
          <p className="mt-2 text-base-content/70">Loading sessions...</p>
        </div>
      )}

      {sessionsError && (
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{sessionsError instanceof Error ? sessionsError.message : 'Failed to load sessions'}</span>
        </div>
      )}

      {!isLoadingSessions && !sessionsError && sessions.length === 0 && (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-base-content/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-base-content">No sessions</h3>
          <p className="mt-1 text-sm text-base-content/70">
            No code sessions found in storage.
          </p>
        </div>
      )}

      {!isLoadingSessions && !sessionsError && sessions.length > 0 && (
        <div className="bg-base-100 shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-base-300">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <div
                  onClick={() => setSelectedSessionId(session.sessionId)}
                  className="px-4 py-4 sm:px-6 hover:bg-base-200 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">
                        {session.sessionId}
                      </p>
                      <div className="mt-1 flex items-center gap-4 text-sm text-base-content/70">
                        <span>
                          Created: {new Date(session.createdAt).toLocaleString()}
                        </span>
                        {session.size && (
                          <span>
                            Size: {(session.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      <svg
                        className="w-5 h-5 text-base-content/40"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // Session Detail View (with mock code editor for now)
  const SessionDetailView = () => {
    if (!selectedSessionId) {
      return <SessionsList />;
    }

    if (isLoadingSession) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-112px)]">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-2 text-base-content/70">Loading session...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="h-[calc(100vh-112px)] flex flex-col">
        {/* Session Header */}
        <div className="bg-base-100 border-b border-base-300 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedSessionId(null)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <div>
                <h2 className="text-sm font-semibold text-base-content">{selectedSessionId}</h2>
                {sessionData && (
                  <p className="text-xs text-base-content/70">
                    Last modified: {new Date(sessionData.lastModified).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Code Editor */}
        <div className="flex-1">
          <CodeEditor />
        </div>
      </div>
    );
  };

  // Always use SessionLayout to show status bar
  return (
    <SessionLayout>
      {selectedSessionId ? <SessionDetailView /> : <SessionsList />}
    </SessionLayout>
  );
}
