interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

interface TokenUsageDisplayProps {
  usageData?: TokenUsage | null;
  maxContextTokens?: number;
}

export function TokenUsageDisplay({ usageData, maxContextTokens = 200000 }: TokenUsageDisplayProps) {
  // Show the latest usage directly - no accumulation needed
  // Claude's usage.input_tokens already represents the full context sent in that request
  const inputTokens = usageData?.input_tokens || 0;
  const outputTokens = usageData?.output_tokens || 0;
  const cachedTokens = usageData?.cache_read_input_tokens || 0;

  // For context window tracking, input_tokens is what matters (context sent to Claude)
  // Output tokens don't count against the context window for future requests
  const contextUsed = inputTokens;
  const remainingTokens = maxContextTokens - contextUsed;
  const percentageUsed = (contextUsed / maxContextTokens) * 100;

  // Determine color based on usage percentage
  const getColorClass = () => {
    if (percentageUsed > 90) return 'text-error';
    if (percentageUsed > 70) return 'text-warning';
    return 'text-success';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  // Don't render anything if no usage data yet
  if (!usageData) {
    return null;
  }

  return (
    <div className="text-xs text-base-content/60 flex items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="font-medium">Context:</span>
        <span className={getColorClass()}>
          {formatNumber(contextUsed)} / {formatNumber(maxContextTokens)}
        </span>
      </div>
      <div className="h-3 w-px bg-base-content/20" />
      <div className="flex items-center gap-1">
        <span className="font-medium">Remaining:</span>
        <span className={getColorClass()}>
          {formatNumber(remainingTokens)}
        </span>
      </div>
      <div className="h-3 w-px bg-base-content/20" />
      <div className="flex items-center gap-1">
        <span className="opacity-60">
          ({percentageUsed.toFixed(1)}% used)
        </span>
      </div>

      {/* Tooltip with detailed breakdown */}
      <div className="dropdown dropdown-end">
        <button
          tabIndex={0}
          className="btn btn-ghost btn-xs btn-circle"
          title="View token breakdown"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <div tabIndex={0} className="dropdown-content z-[1] card card-compact w-64 p-4 shadow bg-base-100 border border-base-300">
          <h4 className="font-semibold text-sm mb-2">Token Usage (Last Request)</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="opacity-70">Input tokens:</span>
              <span className="font-mono">{formatNumber(inputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Output tokens:</span>
              <span className="font-mono">{formatNumber(outputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Cached tokens:</span>
              <span className="font-mono">{formatNumber(cachedTokens)}</span>
            </div>
            <div className="divider my-1"></div>
            <div className="flex justify-between font-semibold">
              <span>Context used:</span>
              <span className="font-mono">{formatNumber(contextUsed)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Max context:</span>
              <span className="font-mono">{formatNumber(maxContextTokens)}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <progress
              className={`progress ${percentageUsed > 90 ? 'progress-error' : percentageUsed > 70 ? 'progress-warning' : 'progress-success'} w-full`}
              value={contextUsed}
              max={maxContextTokens}
            ></progress>
          </div>
        </div>
      </div>
    </div>
  );
}
