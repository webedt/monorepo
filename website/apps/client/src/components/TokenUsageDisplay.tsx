import { useState, useEffect } from 'react';

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
  const [cumulativeUsage, setCumulativeUsage] = useState({
    totalInput: 0,
    totalOutput: 0,
    totalCached: 0,
  });

  useEffect(() => {
    if (usageData) {
      setCumulativeUsage(prev => ({
        totalInput: prev.totalInput + (usageData.input_tokens || 0),
        totalOutput: prev.totalOutput + (usageData.output_tokens || 0),
        totalCached: prev.totalCached + (usageData.cache_read_input_tokens || 0),
      }));
    }
  }, [usageData]);

  const totalTokens = cumulativeUsage.totalInput + cumulativeUsage.totalOutput + cumulativeUsage.totalCached;
  const remainingTokens = maxContextTokens - totalTokens;
  const percentageUsed = (totalTokens / maxContextTokens) * 100;

  // Determine color based on usage percentage
  const getColorClass = () => {
    if (percentageUsed > 90) return 'text-error';
    if (percentageUsed > 70) return 'text-warning';
    return 'text-success';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <div className="text-xs text-base-content/60 flex items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="font-medium">Tokens:</span>
        <span className={getColorClass()}>
          {formatNumber(totalTokens)} / {formatNumber(maxContextTokens)}
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
          <h4 className="font-semibold text-sm mb-2">Token Usage Breakdown</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="opacity-70">Input tokens:</span>
              <span className="font-mono">{formatNumber(cumulativeUsage.totalInput)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Output tokens:</span>
              <span className="font-mono">{formatNumber(cumulativeUsage.totalOutput)}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">Cached tokens:</span>
              <span className="font-mono">{formatNumber(cumulativeUsage.totalCached)}</span>
            </div>
            <div className="divider my-1"></div>
            <div className="flex justify-between font-semibold">
              <span>Total:</span>
              <span className="font-mono">{formatNumber(totalTokens)}</span>
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
              value={totalTokens}
              max={maxContextTokens}
            ></progress>
          </div>
        </div>
      </div>
    </div>
  );
}
