# Claude Web CLI Example Runs

This document contains example outputs from the Claude Web CLI commands and test scenarios.

## Table of Contents

- [Execute Command](#execute-command)
  - [Default Output (Formatted)](#default-output-formatted)
  - [JSON Output](#json-output)
  - [JSONL Output](#jsonl-output)
  - [Raw Output](#raw-output)
- [Test Scenarios](#test-scenarios)
  - [Scenario 1: Execute + Wait + Resume](#scenario-1-execute--wait--resume)
  - [Scenario 2: Execute + Early Terminate + Interrupt](#scenario-2-execute--early-terminate--interrupt)
  - [Scenario 3: Execute + Early Terminate + Queue Resume](#scenario-3-execute--early-terminate--queue-resume)
  - [Scenario 4: Execute + Terminate + Interrupt + Resume](#scenario-4-execute--terminate--interrupt--resume)
  - [Scenario 5: Double-Queue](#scenario-5-double-queue)
  - [Scenario 6: Execute + Rename](#scenario-6-execute--rename)
  - [Scenario 7: Execute + Complete + Archive](#scenario-7-execute--complete--archive)
  - [Scenario 8: WebSocket Streaming](#scenario-8-websocket-streaming)
  - [All Scenarios](#all-scenarios)
- [Command Reference](#command-reference)

---

## Execute Command

The `execute` command supports four output modes:

| Flag | Description |
|------|-------------|
| (default) | Human-readable formatted output with timestamps |
| `--json` | Pretty-printed JSON of the final result |
| `--jsonl` | JSON Lines stream (one parsed event per line) |
| `--raw` | Raw WebSocket frames before any processing |

### Default Output (Formatted)

Human-readable output with timestamps, thinking blocks, and informative event details.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world"
```

```
Creating session for: https://github.com/webedt/hello-world
Prompt: Hello world
--------------------------------------------------------------------------------
[17:11:09] ENV: Using existing Claude Code installation (version 2.0.59)
[17:11:09] ENV: Initializing environment
[17:11:09] ENV: Fetching repository webedt/hello-world
[17:11:11] ENV: Starting Claude Code
[17:11:12] SYSTEM: v2.0.59 | claude-sonnet-4-20250514 | /home/user/hello-world
[17:11:12] USER: Hello world
[17:11:14] THINKING: The user just sent me "Hello world" - this seems like a gree...
[17:11:18] ASSISTANT: Hello! I see we're working in the "hello-world" repository....
[17:11:18] TOOL_USE: Glob: **/*
[17:11:20] THINKING: I see the directory has a lot of files. Let me look at just t...
[17:11:20] ASSISTANT: Let me look at the main project files to understand what we ...
[17:11:21] TOOL_USE: Read: README.md
[17:11:21] TOOL_USE: Read: package.json
[17:11:23] THINKING: I can see this is already a "Hello World" project! It has a R...
[17:11:25] ASSISTANT: Hello! I can see we're in a "Hello World" project that's alr...
[17:11:25] RESULT: $0.0680 | 14s | 5 turns
--------------------------------------------------------------------------------

Result:
  Session ID: session_01KqkDcgaRGoNihkPyfDzdVf
  Status:     completed
  Title:      Hello world...
  Branch:     claude/hello-world-f4iOB
  Cost:       $0.0680
  Duration:   14s
  Web URL:    https://claude.ai/code/session_01KqkDcgaRGoNihkPyfDzdVf
```

**Key features of formatted output:**
- `ENV:` environment manager log content
- `SYSTEM:` Claude Code version, model, and working directory
- `THINKING:` extended thinking block previews
- `ASSISTANT:` text response previews
- `TOOL_USE:` tool name with file path, pattern, or command
- `RESULT:` cost, duration, and turn count
- Tool result messages (blank user messages) are hidden

### JSON Output

Pretty-printed JSON of the final result event or session result.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --json
```

```json
{
  "duration_api_ms": 6814,
  "duration_ms": 5982,
  "is_error": false,
  "num_turns": 1,
  "result": "Hello! I'm Claude Code, ready to help you...",
  "session_id": "b33bc460-769d-42a3-a984-f88597f7b3e8",
  "subtype": "success",
  "total_cost_usd": 0.068,
  "type": "result",
  "uuid": "d13dc555-c293-4b1c-9d0a-b4d1349a9717"
}
```

### JSONL Output

JSON Lines stream - one parsed event object per line. Events are unwrapped from the WebSocket envelope and deduplicated.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --jsonl
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"2025-12-24T16:37:51.630Z"},"type":"env_manager_log","uuid":"0f15c518-2237-480e-b796-f2f31f5f253e"}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"2025-12-24T16:37:51.900Z"},"type":"env_manager_log","uuid":"3d97734f-5908-44c3-8244-f6007ba03183"}
{"data":{"category":"init","content":"Fetching repository webedt/hello-world","extra":{},"level":"info","timestamp":"2025-12-24T16:37:52.071Z"},"type":"env_manager_log","uuid":"ef0f036e-dfd7-4d3b-a78e-e45eed4d91d8"}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":["claude","--output-format=stream-json","..."]},"level":"info","timestamp":"2025-12-24T16:37:53.999Z"},"type":"env_manager_log","uuid":"1ea3f7f4-ffe6-4610-9c24-76a5e2cd0f03"}
{"agents":["general-purpose","statusline-setup","Explore","Plan","claude-code-guide"],"apiKeySource":"none","claude_code_version":"2.0.59","cwd":"/home/user/hello-world","model":"claude-sonnet-4-20250514","session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","subtype":"init","type":"system","uuid":"c7167795-162a-4ac2-b924-2d6cfca14a94"}
{"isReplay":true,"message":{"content":"Hello world","role":"user"},"session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","type":"user","uuid":"6500505c-4029-4621-a6cc-d0a4e08a24a2"}
{"message":{"content":[{"text":"Hello! I'm Claude Code, ready to help you with your software engineering tasks.","type":"text"}],"model":"claude-sonnet-4-20250514","role":"assistant"},"session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","type":"assistant","uuid":"12bd70cd-edad-42c1-a2d2-ce3acdaa1da1"}
{"duration_api_ms":6814,"duration_ms":5982,"is_error":false,"num_turns":1,"result":"Hello! I'm Claude Code, ready to help you...","session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","subtype":"success","total_cost_usd":0.068,"type":"result","uuid":"d13dc555-c293-4b1c-9d0a-b4d1349a9717"}
```

### Raw Output

Raw WebSocket frames exactly as received from `wss://api.anthropic.com/v1/sessions/ws/{sessionId}/subscribe`, before JSON parsing, envelope unwrapping, or deduplication.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"2025-12-24T17:11:09.345139277Z"},"type":"env_manager_log","uuid":"055898dc-26f2-4bc5-b992-8a2fc8fa7b0a"}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"2025-12-24T17:11:09.635941047Z"},"type":"env_manager_log","uuid":"c205a173-b328-4052-93ed-1a52d8ce247c"}
{"data":{"category":"init","content":"Fetching repository webedt/hello-world","extra":{},"level":"info","timestamp":"2025-12-24T17:11:09.80468886Z"},"type":"env_manager_log","uuid":"219ddaa7-ab75-4405-b06d-eeec8e3cb34d"}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":["claude","--output-format=stream-json","--verbose","--replay-user-messages","--input-format=stream-json","--debug-to-stderr","--allowed-tools","Task,Bash,Glob,Grep,Read,Edit,MultiEdit,Write,NotebookEdit,WebFetch,TodoWrite,WebSearch,BashOutput,KillBash,Tmux,mcp__codesign__sign_file","--append-system-prompt","\nYou are Claude...","--model","claude-sonnet-4-20250514","--add-dir","/home/user/hello-world","--sdk-url","wss://api.anthropic.com/v1/session_ingress/ws/session_01KqkDcgaRGoNihkPyfDzdVf","--resume=https://api.anthropic.com/v1/session_ingress/session/session_01KqkDcgaRGoNihkPyfDzdVf","--debug"]},"level":"info","timestamp":"2025-12-24T17:11:11.795292414Z"},"type":"env_manager_log","uuid":"5e7da59a-bb4d-4305-bbc2-46e9c2da6c96"}
{"agents":["general-purpose","statusline-setup","Explore","Plan","claude-code-guide"],"apiKeySource":"none","claude_code_version":"2.0.59","cwd":"/home/user/hello-world","mcp_servers":[],"model":"claude-sonnet-4-20250514","output_style":"default","permissionMode":"default","plugins":[],"session_id":"1e787964-05da-4528-88d3-2bdfc25a8d66","skills":["session-start-hook"],"slash_commands":["session-start-hook","compact","cost","init","pr-comments","release-notes","review","security-review"],"subtype":"init","tools":["Task","Bash","Glob","Grep","ExitPlanMode","Read","Edit","Write","NotebookEdit","WebFetch","TodoWrite","WebSearch","BashOutput","KillShell","Skill","SlashCommand","EnterPlanMode"],"type":"system","uuid":"0ca7ed46-78f2-4724-b3ca-c4b2f9e8404f"}
{"isReplay":true,"message":{"content":"Hello world","role":"user"},"parent_tool_use_id":null,"session_id":"1e787964-05da-4528-88d3-2bdfc25a8d66","type":"user","uuid":"8d3c1631-f689-4fc4-ae1a-d34a7cf999fd"}
{"message":{"content":[{"signature":"EvIECkYICxgC...","thinking":"The user just sent me \"Hello world\"...","type":"thinking"}],"context_management":null,"id":"msg_01G3Ttk13DPt1qDN91RDD5x1","model":"claude-sonnet-4-20250514","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","usage":{"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":17396},"cache_creation_input_tokens":17396,"cache_read_input_tokens":0,"input_tokens":10,"output_tokens":3,"service_tier":"standard"}},"parent_tool_use_id":null,"session_id":"1e787964-05da-4528-88d3-2bdfc25a8d66","type":"assistant","uuid":"d8401822-28fd-422f-b1c3-ae76099b0367"}
{"message":{"content":[{"text":"Hello! I'm Claude Code, ready to help you with your software engineering tasks.","type":"text"}],"context_management":null,"id":"msg_01G3Ttk13DPt1qDN91RDD5x1","model":"claude-sonnet-4-20250514","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","usage":{...}},"parent_tool_use_id":null,"session_id":"1e787964-05da-4528-88d3-2bdfc25a8d66","type":"assistant","uuid":"a233f3e5-f2b4-4c5c-9306-a36d55b678bc"}
...
{"duration_api_ms":14234,"duration_ms":13982,"is_error":false,"num_turns":1,"result":"Perfect! I can see you're working on a \"Hello World\" project...","session_id":"1e787964-05da-4528-88d3-2bdfc25a8d66","subtype":"success","total_cost_usd":0.068,"type":"result","uuid":"f1234567-89ab-cdef-0123-456789abcdef"}
```

**Key differences in raw output:**
- Full `timestamp` precision (nanoseconds): `2025-12-24T17:11:09.345139277Z`
- Full `args` array in env_manager_log (not truncated)
- Extended `system` event with `mcp_servers`, `plugins`, `skills`, `slash_commands`, `tools`, `output_style`, `permissionMode`
- `parent_tool_use_id` field on events
- Full `message` structure with `context_management`, `id`, `stop_reason`, `stop_sequence`, `usage` details
- `thinking` blocks with signatures (extended thinking)
- `isReplay: true` flag on user messages replayed from session creation

---

## Test Scenarios

All test scenarios use `https://github.com/anthropics/claude-code` as the default test repository.

### Scenario 1: Execute + Wait + Resume

Creates a session, waits for completion, then resumes with a follow-up message.

```bash
npm run dev -- claude web test scenario1 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"2025-12-24T18:00:01.123456789Z"},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"2025-12-24T18:00:01.234567890Z"},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"2025-12-24T18:00:01.345678901Z"},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":["claude","--output-format=stream-json","--verbose","--replay-user-messages",...]},"level":"info","timestamp":"2025-12-24T18:00:03.456789012Z"},"type":"env_manager_log","uuid":"..."}
{"agents":["general-purpose","statusline-setup","Explore","Plan","claude-code-guide"],"apiKeySource":"none","claude_code_version":"2.0.59","cwd":"/home/user/claude-code","mcp_servers":[],"model":"claude-sonnet-4-20250514","output_style":"default","permissionMode":"default","plugins":[],"session_id":"abc12345-...","skills":[...],"slash_commands":[...],"subtype":"init","tools":[...],"type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario1.txt with the text \"Hello from scenario 1\"","role":"user"},"parent_tool_use_id":null,"session_id":"abc12345-...","type":"user","uuid":"..."}
{"message":{"content":[{"signature":"...","thinking":"I need to create a file...","type":"thinking"}],"context_management":null,"id":"msg_...","model":"claude-sonnet-4-20250514","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","usage":{...}},"parent_tool_use_id":null,"session_id":"abc12345-...","type":"assistant","uuid":"..."}
{"message":{"content":[{"text":"I'll create that file for you.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Hello from scenario 1","file_path":"test-scenario1.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created successfully","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},"parent_tool_use_id":null,"session_id":"abc12345-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"I've created test-scenario1.txt with your requested content.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":5234,"duration_ms":4982,"is_error":false,"num_turns":1,"result":"I've created test-scenario1.txt...","session_id":"abc12345-...","subtype":"success","total_cost_usd":0.045,"type":"result","uuid":"..."}
{"isReplay":false,"message":{"content":"Now add a second line to test-scenario1.txt that says \"Resumed successfully\"","role":"user"},"parent_tool_use_id":null,"session_id":"abc12345-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"I'll add that second line.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario1.txt","new_string":"Hello from scenario 1\nResumed successfully","old_string":"Hello from scenario 1"},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Edit successful","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Done! I've added the second line.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":3456,"duration_ms":3234,"is_error":false,"num_turns":1,"result":"Done! I've added the second line.","session_id":"abc12345-...","subtype":"success","total_cost_usd":0.032,"type":"result","uuid":"..."}
```

### Scenario 2: Execute + Early Terminate + Interrupt

Starts a long-running task, aborts polling after 5 seconds, then sends an interrupt signal.

```bash
npm run dev -- claude web test scenario2 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"2025-12-24T18:05:01.123456789Z"},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"apiKeySource":"none","claude_code_version":"2.0.59","cwd":"/home/user/claude-code","mcp_servers":[],"model":"claude-sonnet-4-20250514","output_style":"default","permissionMode":"default","plugins":[],"session_id":"def67890-...","skills":[...],"slash_commands":[...],"subtype":"init","tools":[...],"type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a comprehensive README.md file with multiple sections about this project. Make it detailed with at least 500 words.","role":"user"},"parent_tool_use_id":null,"session_id":"def67890-...","type":"user","uuid":"..."}
{"message":{"content":[{"signature":"...","thinking":"I'll create a detailed README.md for this project...","type":"thinking"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"text":"I'll create a detailed README.md for this project.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":".","pattern":"*"},"name":"Glob","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Found project files...","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Planning README structure...","type":"text"}],...},"type":"assistant","uuid":"..."}
```

*Note: Polling aborted after 5s, interrupt signal sent. Session status changes to interrupted.*

### Scenario 3: Execute + Early Terminate + Queue Resume

Stops polling early (without interrupting), queues a resume message while session continues, then re-polls.

```bash
npm run dev -- claude web test scenario3 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"ghi11111-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario3.txt with some initial content.","role":"user"},"parent_tool_use_id":null,"session_id":"ghi11111-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Creating the file now.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Initial content","file_path":"test-scenario3.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"File created successfully.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":4567,"duration_ms":4345,"is_error":false,"num_turns":1,"result":"File created successfully.","session_id":"ghi11111-...","subtype":"success","total_cost_usd":0.038,"type":"result","uuid":"..."}
{"isReplay":false,"message":{"content":"After you finish, also add a second line saying \"Queued message received\"","role":"user"},"parent_tool_use_id":null,"session_id":"ghi11111-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"I'll add that line now.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario3.txt","new_string":"Initial content\nQueued message received","old_string":"Initial content"},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Edit complete","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Done! Added the queued message.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":3210,"duration_ms":2987,"is_error":false,"num_turns":1,"result":"Done! Added the queued message.","session_id":"ghi11111-...","subtype":"success","total_cost_usd":0.029,"type":"result","uuid":"..."}
```

### Scenario 4: Execute + Terminate + Interrupt + Resume

Polls briefly, interrupts the session, then resumes with a new prompt.

```bash
npm run dev -- claude web test scenario4 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"jkl22222-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a detailed file called test-scenario4.txt explaining what you are doing step by step.","role":"user"},"parent_tool_use_id":null,"session_id":"jkl22222-...","type":"user","uuid":"..."}
{"message":{"content":[{"signature":"...","thinking":"I'll create a detailed step-by-step explanation file.","type":"thinking"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"text":"I'll create a detailed step-by-step explanation file.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Step 1: Starting...","file_path":"test-scenario4.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Step 1: Created the file...","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario4.txt","new_string":"Step 1: Starting...\nStep 2: Adding more content...","old_string":"Step 1: Starting..."},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
```

*Interrupt sent after 15s wait. Session resumes:*

```
{"isReplay":false,"message":{"content":"Please continue and add \"Resumed after interrupt\" to the file.","role":"user"},"parent_tool_use_id":null,"session_id":"jkl22222-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"I'll add that message to the file.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario4.txt","new_string":"...\nResumed after interrupt","old_string":"..."},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Edit successful","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Added the resume message.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":2890,"duration_ms":2678,"is_error":false,"num_turns":1,"result":"Added the resume message.","session_id":"jkl22222-...","subtype":"success","total_cost_usd":0.025,"type":"result","uuid":"..."}
```

### Scenario 5: Double-Queue

Queues multiple resume messages while the session is running.

```bash
npm run dev -- claude web test scenario5 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"mno33333-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario5.txt with \"Step 1 content\"","role":"user"},"parent_tool_use_id":null,"session_id":"mno33333-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Creating the file.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Step 1 content","file_path":"test-scenario5.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"File created with Step 1 content.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":3456,"duration_ms":3234,"is_error":false,"num_turns":1,"result":"File created with Step 1 content.","session_id":"mno33333-...","subtype":"success","total_cost_usd":0.031,"type":"result","uuid":"..."}
{"isReplay":false,"message":{"content":"Add \"Step 2 - first queued message\" to the file","role":"user"},"parent_tool_use_id":null,"session_id":"mno33333-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Adding the first queued message.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario5.txt","new_string":"Step 1 content\nStep 2 - first queued message","old_string":"Step 1 content"},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Edit successful","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Added Step 2 content.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":2890,"duration_ms":2678,"is_error":false,"num_turns":1,"result":"Added Step 2 content.","session_id":"mno33333-...","subtype":"success","total_cost_usd":0.027,"type":"result","uuid":"..."}
{"isReplay":false,"message":{"content":"Add \"Step 3 - second queued message\" to the file","role":"user"},"parent_tool_use_id":null,"session_id":"mno33333-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Adding the second queued message.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"file_path":"test-scenario5.txt","new_string":"Step 2 - first queued message\nStep 3 - second queued message","old_string":"Step 2 - first queued message"},"name":"Edit","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"Edit successful","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Added Step 3 content.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":2567,"duration_ms":2345,"is_error":false,"num_turns":1,"result":"Added Step 3 content.","session_id":"mno33333-...","subtype":"success","total_cost_usd":0.024,"type":"result","uuid":"..."}
```

### Scenario 6: Execute + Rename

Creates a session and renames it while it's still running.

```bash
npm run dev -- claude web test scenario6 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"pqr44444-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario6.txt with \"Testing rename feature\"","role":"user"},"parent_tool_use_id":null,"session_id":"pqr44444-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Creating the file.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Testing rename feature","file_path":"test-scenario6.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"File created successfully.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":3123,"duration_ms":2901,"is_error":false,"num_turns":1,"result":"File created successfully.","session_id":"pqr44444-...","subtype":"success","total_cost_usd":0.028,"type":"result","uuid":"..."}
```

*Session renamed via PATCH /v1/sessions/{id} during execution.*

### Scenario 7: Execute + Complete + Archive

Runs to completion and then archives the session.

```bash
npm run dev -- claude web test scenario7 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"stu55555-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario7.txt with \"Testing archive feature\"","role":"user"},"parent_tool_use_id":null,"session_id":"stu55555-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"I'll create that file.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Testing archive feature","file_path":"test-scenario7.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created successfully","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"Done! File created.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":2890,"duration_ms":2678,"is_error":false,"num_turns":1,"result":"Done! File created.","session_id":"stu55555-...","subtype":"success","total_cost_usd":0.026,"type":"result","uuid":"..."}
```

*Session archived via POST /v1/sessions/{id}/archive after completion.*

### Scenario 8: WebSocket Streaming

Uses WebSocket streaming instead of HTTP polling for real-time events.

```bash
npm run dev -- claude web test scenario8 --raw
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Fetching repository anthropics/claude-code","extra":{},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":[...]},"level":"info","timestamp":"..."},"type":"env_manager_log","uuid":"..."}
{"agents":[...],"session_id":"vwx66666-...","subtype":"init","type":"system","uuid":"..."}
{"isReplay":true,"message":{"content":"Create a file called test-scenario8.txt with \"Testing WebSocket streaming\"","role":"user"},"parent_tool_use_id":null,"session_id":"vwx66666-...","type":"user","uuid":"..."}
{"message":{"content":[{"text":"Creating the file now.","type":"text"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"id":"toolu_...","input":{"content":"Testing WebSocket streaming","file_path":"test-scenario8.txt"},"name":"Write","type":"tool_use"}],...},"type":"assistant","uuid":"..."}
{"message":{"content":[{"content":"File created","tool_use_id":"toolu_...","type":"tool_result"}],"role":"user"},...,"type":"user","uuid":"..."}
{"message":{"content":[{"text":"File created successfully with WebSocket streaming!","type":"text"}],...},"type":"assistant","uuid":"..."}
{"duration_api_ms":2456,"duration_ms":2234,"is_error":false,"num_turns":1,"result":"File created successfully with WebSocket streaming!","session_id":"vwx66666-...","subtype":"success","total_cost_usd":0.023,"type":"result","uuid":"..."}
```

### All Scenarios

Runs all 8 scenarios sequentially with summary statistics.

```bash
npm run dev -- claude web test all --raw
```

*Outputs raw WebSocket frames for each scenario in sequence, followed by summary.*

#### Skipping Scenarios

Use `--skip` to skip specific scenarios:

```bash
npm run dev -- claude web test all --skip 4,5,8 --raw
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `claude web execute <gitUrl> <prompt>` | Execute a prompt against a repository |
| `claude web test scenario1` | Execute + wait + resume |
| `claude web test scenario2` | Execute + early terminate + interrupt |
| `claude web test scenario3` | Execute + early terminate + queue resume |
| `claude web test scenario4` | Execute + terminate + interrupt + resume |
| `claude web test scenario5` | Double-queue messages |
| `claude web test scenario6` | Execute + rename session |
| `claude web test scenario7` | Execute + complete + archive |
| `claude web test scenario8` | WebSocket streaming |
| `claude web test all` | Run all scenarios sequentially |

### Execute Options

| Option | Description |
|--------|-------------|
| `-m, --model <model>` | Model to use (default: claude-sonnet-4-20250514) |
| `-b, --branch-prefix <prefix>` | Branch prefix (default: claude/{prompt-words}) |
| `--title <title>` | Session title |
| `--quiet` | Only show final result |
| `--json` | Output raw JSON result |
| `--jsonl` | Stream events as JSON Lines |
| `--raw` | Stream raw WebSocket frames |

### Test Options

| Option | Description |
|--------|-------------|
| `--git-url <url>` | Git URL to use (default: anthropics/claude-code) |
| `--wait-ms <ms>` | How long to wait before stopping/interrupting |
| `--skip <scenarios>` | Comma-separated list of scenarios to skip (all command only) |
| `--json` | Output results as JSON |
| `--jsonl` | Stream events as JSON Lines |
| `--raw` | Stream raw WebSocket frames |

## Event Types Reference

| Event Type | Description | Key Fields |
|------------|-------------|------------|
| `env_manager_log` | Environment manager logs | `data.category`, `data.content`, `data.level`, `data.timestamp` |
| `system` | Session initialization | `agents`, `claude_code_version`, `cwd`, `model`, `session_id`, `tools` |
| `user` | User message | `message.content`, `message.role`, `isReplay`, `parent_tool_use_id` |
| `assistant` | Assistant response | `message.content`, `message.model`, `message.usage` |
| `result` | Session completion | `duration_api_ms`, `duration_ms`, `is_error`, `num_turns`, `result`, `total_cost_usd` |

### Raw-Only Fields

These fields are only visible with `--raw` output:

| Field | Description |
|-------|-------------|
| `parent_tool_use_id` | Links tool results to their tool_use |
| `context_management` | Context window management info |
| `stop_reason`, `stop_sequence` | Why generation stopped |
| `usage.cache_creation`, `usage.cache_read_input_tokens` | Caching statistics |
| `message.content[].signature` | Cryptographic signature for thinking blocks |
| `message.content[].thinking` | Extended thinking content |
| `mcp_servers`, `plugins`, `skills` | Extended system capabilities |
| `output_style`, `permissionMode` | Session configuration |
