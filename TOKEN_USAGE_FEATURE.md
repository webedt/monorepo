# Token Usage Display Feature

## Overview
This feature displays cumulative token usage and remaining context in the chat interface, allowing users to monitor their conversation's token consumption in real-time.

## Implementation Summary

### 1. New Component: TokenUsageDisplay
**Location:** `website/apps/client/src/components/TokenUsageDisplay.tsx`

**Features:**
- **Cumulative tracking** - Tracks total input, output, and cached tokens across all messages
- **Remaining context** - Shows how many tokens are left in the 200K context window
- **Percentage indicator** - Displays usage as a percentage
- **Color-coded warnings** - Changes color based on usage:
  - Green: < 70% used
  - Yellow: 70-90% used
  - Red: > 90% used
- **Detailed breakdown** - Hover tooltip shows:
  - Input tokens
  - Output tokens
  - Cached tokens
  - Total tokens
  - Max context
  - Progress bar

### 2. Integration Points

#### Chat.tsx Updates
1. **Import the component:**
   ```typescript
   import { TokenUsageDisplay } from '@/components/TokenUsageDisplay';
   ```

2. **Add state to track latest token usage:**
   ```typescript
   const [latestTokenUsage, setLatestTokenUsage] = useState<any>(null);
   ```

3. **Capture usage data from SSE events:**
   ```typescript
   // In the useEventSource onMessage handler
   if (msgData.message?.usage) {
     setLatestTokenUsage(msgData.message.usage);
   }
   ```

4. **Display the component:**
   ```typescript
   <div className="max-w-4xl mx-auto mb-3 flex justify-end">
     <TokenUsageDisplay usageData={latestTokenUsage} />
   </div>
   ```

### 3. Data Flow

```
Claude API Response
  ↓
{
  "usage": {
    "input_tokens": 6,
    "cache_creation_input_tokens": 898,
    "cache_read_input_tokens": 13120,
    "output_tokens": 264
  }
}
  ↓
SSE Stream → EventSource Handler
  ↓
setLatestTokenUsage(usage)
  ↓
TokenUsageDisplay Component
  ↓
Cumulative Calculation
  ↓
Display: "Tokens: 14,288 / 200,000 | Remaining: 185,712 (7.1% used)"
```

### 4. UI Placement

The token usage display appears:
- **Location:** Bottom of the chat interface, above the input field
- **Alignment:** Right-aligned
- **Visibility:** Only shown when there are messages in the conversation

### 5. Example Display

**Compact View:**
```
Tokens: 14,288 / 200,000 | Remaining: 185,712 (7.1% used) ℹ️
```

**Detailed Tooltip (on hover):**
```
Token Usage Breakdown
─────────────────────
Input tokens:         6,000
Output tokens:        5,000
Cached tokens:       13,120
─────────────────────
Total:               24,120
Max context:        200,000

[████████░░░░░░░░░░] 12.1%
```

## Benefits

1. **Transparency** - Users can see exactly how much of their context window is being used
2. **Planning** - Helps users plan when to start a new conversation
3. **Efficiency awareness** - Shows how much context is being cached vs. fresh
4. **Cost awareness** - Since token usage relates to API costs
5. **Real-time monitoring** - Updates live as the conversation progresses

## Technical Details

### Token Calculation
```typescript
const totalTokens = cumulativeUsage.totalInput
                  + cumulativeUsage.totalOutput
                  + cumulativeUsage.totalCached;

const remainingTokens = maxContextTokens - totalTokens;
const percentageUsed = (totalTokens / maxContextTokens) * 100;
```

### Color Logic
```typescript
const getColorClass = () => {
  if (percentageUsed > 90) return 'text-error';      // Red
  if (percentageUsed > 70) return 'text-warning';    // Yellow
  return 'text-success';                              // Green
};
```

## Files Modified

1. **New File:** `website/apps/client/src/components/TokenUsageDisplay.tsx`
2. **Modified:** `website/apps/client/src/pages/Chat.tsx`

## Testing

To test the feature:
1. Start a conversation
2. Look at the bottom right of the chat interface (above the input field)
3. Observe token counts updating as you send messages
4. Hover over the info icon (ℹ️) to see detailed breakdown
5. Continue conversation to see cumulative tracking

## Future Enhancements

Potential improvements:
- Persist cumulative usage to database for session recovery
- Add export/download of usage statistics
- Graph token usage over time
- Per-message token breakdown
- Cost estimation based on pricing tiers
- Warning when approaching context limit
- Auto-suggest starting new conversation at threshold
