import { useState, useCallback, useEffect, useRef } from 'react';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';
import { liveChatApi } from '@/lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  images?: Array<{ id: string; data: string; mediaType: string; fileName?: string }>;
}

/**
 * Workspace Chat - Live Chat for the branch workspace.
 * Messages are stored per-branch, LLM runs with branch context.
 */
export default function WorkspaceChat() {
  const workspace = useWorkspaceParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { owner, repo, branch } = workspace || { owner: '', repo: '', branch: '' };

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load messages on mount
  useEffect(() => {
    if (!workspace) return;

    const loadMessages = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await liveChatApi.getMessages(owner, repo, branch);
        if (response.success && response.data?.messages) {
          setMessages(response.data.messages);
          setTimeout(scrollToBottom, 100);
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
        setError('Failed to load chat history');
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [owner, repo, branch, workspace, scrollToBottom]);

  // Handle sending a message
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !workspace || isSending) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsSending(true);
    setError(null);

    // Optimistically add user message
    const tempUserMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMessage]);
    setTimeout(scrollToBottom, 100);

    try {
      // Use fetch for POST request with SSE response
      const response = await fetch(
        `${liveChatApi.getExecuteUrl(owner, repo, branch)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ message: userMessage }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let assistantMessageId: string | null = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim();

              // Get the data line
              const dataLineIndex = lines.indexOf(line) + 1;
              if (dataLineIndex < lines.length && lines[dataLineIndex].startsWith('data: ')) {
                const dataStr = lines[dataLineIndex].slice(6);
                try {
                  const data = JSON.parse(dataStr);

                  if (eventType === 'assistant_message' && data.content) {
                    assistantContent = data.content;
                    // Update or add assistant message
                    setMessages((prev) => {
                      const existingIndex = prev.findIndex(
                        (m) => m.id === `assistant-streaming`
                      );
                      const newMessage: ChatMessage = {
                        id: `assistant-streaming`,
                        role: 'assistant',
                        content: assistantContent,
                        createdAt: new Date().toISOString(),
                      };
                      if (existingIndex >= 0) {
                        const updated = [...prev];
                        updated[existingIndex] = newMessage;
                        return updated;
                      }
                      return [...prev, newMessage];
                    });
                    setTimeout(scrollToBottom, 100);
                  }

                  if (eventType === 'completed' && data.messageId) {
                    assistantMessageId = data.messageId;
                    // Finalize the assistant message with proper ID
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === 'assistant-streaming'
                          ? { ...m, id: assistantMessageId! }
                          : m
                      )
                    );
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setError('Failed to send message. Please try again.');
      // Remove the optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [inputValue, workspace, isSending, owner, repo, branch, scrollToBottom]);

  // Handle key press in input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Clear chat
  const handleClearChat = useCallback(async () => {
    if (!workspace) return;
    if (!confirm('Clear all chat messages for this branch?')) return;

    try {
      await liveChatApi.clearMessages(owner, repo, branch);
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear messages:', err);
      setError('Failed to clear chat history');
    }
  }, [owner, repo, branch, workspace]);

  if (!workspace) {
    return null;
  }

  return (
    <WorkspaceLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
            </svg>
            <span className="text-sm font-medium">Live Chat</span>
            <span className="badge badge-sm badge-ghost">
              {owner}/{repo} @ {branch}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearChat}
              className="btn btn-ghost btn-xs"
              title="Clear chat"
              disabled={messages.length === 0}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-16 h-16 text-base-content/20 mb-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
              </svg>
              <p className="text-base-content/60 mb-2">No messages yet</p>
              <p className="text-sm text-base-content/40">
                Start a conversation about your code in{' '}
                <span className="font-mono text-primary">{branch}</span>
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-content'
                        : 'bg-base-200 text-base-content'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    <div
                      className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-primary-content/60' : 'text-base-content/40'
                      }`}
                    >
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="px-4 pb-2">
            <div className="alert alert-error py-2">
              <span className="text-sm">{error}</span>
              <button onClick={() => setError(null)} className="btn btn-ghost btn-xs">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 border-t border-base-300 bg-base-100">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              className="textarea textarea-bordered flex-1 min-h-[44px] max-h-32 resize-none"
              rows={1}
              disabled={isSending}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isSending}
              className="btn btn-primary"
            >
              {isSending ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
          <p className="text-xs text-base-content/40 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
