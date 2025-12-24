# Claude Web CLI Example Runs

This document contains example outputs from the Claude Web CLI commands and test scenarios.

## Table of Contents

- [Execute Command](#execute-command)
  - [Basic Execute with JSONL Output](#basic-execute-with-jsonl-output)
  - [Execute with Quiet Mode](#execute-with-quiet-mode)
  - [Execute with JSON Output](#execute-with-json-output)
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

---

## Execute Command

### Basic Execute with JSONL Output

Streams events as JSON Lines (one JSON object per line).

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --jsonl
```

```
{"data":{"category":"init","content":"Using existing Claude Code installation (version 2.0.59)","extra":{},"level":"debug","timestamp":"2025-12-24T16:37:51.630133963Z"},"type":"env_manager_log","uuid":"0f15c518-2237-480e-b796-f2f31f5f253e"}
{"data":{"category":"init","content":"Initializing environment","extra":{},"level":"info","timestamp":"2025-12-24T16:37:51.900585558Z"},"type":"env_manager_log","uuid":"3d97734f-5908-44c3-8244-f6007ba03183"}
{"data":{"category":"init","content":"Fetching repository webedt/hello-world","extra":{},"level":"info","timestamp":"2025-12-24T16:37:52.071994142Z"},"type":"env_manager_log","uuid":"ef0f036e-dfd7-4d3b-a78e-e45eed4d91d8"}
{"data":{"category":"init","content":"Starting Claude Code","extra":{"args":["claude","--output-format=stream-json","..."]},"level":"info","timestamp":"2025-12-24T16:37:53.999027473Z"},"type":"env_manager_log","uuid":"1ea3f7f4-ffe6-4610-9c24-76a5e2cd0f03"}
{"agents":["general-purpose","statusline-setup","Explore","Plan","claude-code-guide"],"apiKeySource":"none","claude_code_version":"2.0.59","cwd":"/home/user/hello-world","model":"claude-sonnet-4-20250514","session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","subtype":"init","type":"system","uuid":"c7167795-162a-4ac2-b924-2d6cfca14a94"}
{"isReplay":true,"message":{"content":"Hello world","role":"user"},"session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","type":"user","uuid":"6500505c-4029-4621-a6cc-d0a4e08a24a2"}
{"message":{"content":[{"text":"Hello! I'm Claude Code, ready to help you with your software engineering tasks.","type":"text"}],"model":"claude-sonnet-4-20250514","role":"assistant"},"session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","type":"assistant","uuid":"12bd70cd-edad-42c1-a2d2-ce3acdaa1da1"}
{"duration_api_ms":6814,"duration_ms":5982,"is_error":false,"num_turns":1,"result":"Hello! I'm Claude Code, ready to help you...","session_id":"b33bc460-769d-42a3-a984-f88597f7b3e8","subtype":"success","total_cost_usd":0.068,"type":"result","uuid":"d13dc555-c293-4b1c-9d0a-b4d1349a9717"}
```

### Execute with Quiet Mode

Only shows the final result, suppressing streaming events.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --quiet
```

```
Session created: session_018n1hwM32Hxa8p2bEMphjqb
Web URL: https://claude.ai/remote-sessions/session_018n1hwM32Hxa8p2bEMphjqb

Result: Hello! I'm Claude Code, ready to help you with your software engineering tasks. I can assist with coding, debugging, file operations, git workflows, and much more.

What would you like to work on today?

Cost: $0.068 | Duration: 5.9s | Turns: 1
```

### Execute with JSON Output

Outputs raw JSON result instead of formatted text.

```bash
npm run dev -- claude web execute https://github.com/webedt/hello-world "Hello world" --json
```

```json
{
  "sessionId": "session_018n1hwM32Hxa8p2bEMphjqb",
  "webUrl": "https://claude.ai/remote-sessions/session_018n1hwM32Hxa8p2bEMphjqb",
  "result": "Hello! I'm Claude Code, ready to help you with your software engineering tasks...",
  "status": "completed",
  "cost": 0.068,
  "duration": 5982,
  "turns": 1
}
```

---

## Test Scenarios

All test scenarios use `https://github.com/anthropics/claude-code` as the default test repository.

### Scenario 1: Execute + Wait + Resume

Creates a session, waits for completion, then resumes with a follow-up message.

```bash
npm run dev -- claude web test scenario1 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n2abc123def456","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario1.txt with the text \"Hello from scenario 1\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll create that file for you.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario1.txt","content":"Hello from scenario 1"},"uuid":"..."}
{"type":"tool_result","content":"File created successfully","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I've created test-scenario1.txt with your requested content.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"I've created test-scenario1.txt...","uuid":"..."}
{"type":"user","message":{"content":"Now add a second line to test-scenario1.txt that says \"Resumed successfully\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll add that second line.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario1.txt","old_string":"Hello from scenario 1","new_string":"Hello from scenario 1\nResumed successfully"},"uuid":"..."}
{"type":"tool_result","content":"Edit successful","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Done! I've added the second line.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Done! I've added the second line.","uuid":"..."}
```

### Scenario 2: Execute + Early Terminate + Interrupt

Starts a long-running task, aborts polling after 5 seconds, then sends an interrupt signal.

```bash
npm run dev -- claude web test scenario2 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n2xyz789ghi012","uuid":"..."}
{"type":"user","message":{"content":"Create a comprehensive README.md file with multiple sections...","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll create a detailed README.md for this project.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Read","input":{"file_path":"."},"uuid":"..."}
{"type":"tool_result","content":"Found project files...","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Planning README structure...","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"interrupted","result":"Session was interrupted","uuid":"..."}
```

### Scenario 3: Execute + Early Terminate + Queue Resume

Stops polling early (without interrupting), queues a resume message while session continues, then re-polls.

```bash
npm run dev -- claude web test scenario3 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n3abc456def789","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario3.txt with some initial content.","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Creating the file now.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario3.txt","content":"Initial content"},"uuid":"..."}
{"type":"tool_result","content":"File created","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"File created successfully.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"File created successfully.","uuid":"..."}
{"type":"user","message":{"content":"After you finish, also add a second line saying \"Queued message received\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll add that line now.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario3.txt","old_string":"Initial content","new_string":"Initial content\nQueued message received"},"uuid":"..."}
{"type":"tool_result","content":"Edit complete","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Done! Added the queued message.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Done! Added the queued message.","uuid":"..."}
```

### Scenario 4: Execute + Terminate + Interrupt + Resume

Polls briefly, interrupts the session, then resumes with a new prompt.

```bash
npm run dev -- claude web test scenario4 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n4def012ghi345","uuid":"..."}
{"type":"user","message":{"content":"Create a detailed file called test-scenario4.txt explaining what you are doing step by step.","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll create a detailed step-by-step explanation file.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario4.txt","content":"Step 1: Starting..."},"uuid":"..."}
{"type":"tool_result","content":"File created","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Step 1: Created the file...","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario4.txt","old_string":"Step 1: Starting...","new_string":"Step 1: Starting...\nStep 2: Adding more content..."},"uuid":"..."}
{"type":"result","subtype":"interrupted","result":"Session was interrupted","uuid":"..."}
{"type":"user","message":{"content":"Please continue and add \"Resumed after interrupt\" to the file.","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll add that message to the file.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario4.txt","old_string":"...","new_string":"...\nResumed after interrupt"},"uuid":"..."}
{"type":"tool_result","content":"Edit successful","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Added the resume message.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Added the resume message.","uuid":"..."}
```

### Scenario 5: Double-Queue

Queues multiple resume messages while the session is running.

```bash
npm run dev -- claude web test scenario5 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n5ghi678jkl901","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario5.txt with \"Step 1 content\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Creating the file.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario5.txt","content":"Step 1 content"},"uuid":"..."}
{"type":"tool_result","content":"File created","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"File created with Step 1 content.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"File created with Step 1 content.","uuid":"..."}
{"type":"user","message":{"content":"Add \"Step 2 - first queued message\" to the file","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Adding the first queued message.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario5.txt","old_string":"Step 1 content","new_string":"Step 1 content\nStep 2 - first queued message"},"uuid":"..."}
{"type":"tool_result","content":"Edit successful","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Added Step 2 content.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Added Step 2 content.","uuid":"..."}
{"type":"user","message":{"content":"Add \"Step 3 - second queued message\" to the file","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Adding the second queued message.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Edit","input":{"file_path":"test-scenario5.txt","old_string":"Step 2 - first queued message","new_string":"Step 2 - first queued message\nStep 3 - second queued message"},"uuid":"..."}
{"type":"tool_result","content":"Edit successful","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Added Step 3 content.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Added Step 3 content.","uuid":"..."}
```

### Scenario 6: Execute + Rename

Creates a session and renames it while it's still running.

```bash
npm run dev -- claude web test scenario6 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n6jkl234mno567","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario6.txt with \"Testing rename feature\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Creating the file.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario6.txt","content":"Testing rename feature"},"uuid":"..."}
{"type":"tool_result","content":"File created","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"File created successfully.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"File created successfully.","uuid":"..."}
```

### Scenario 7: Execute + Complete + Archive

Runs to completion and then archives the session.

```bash
npm run dev -- claude web test scenario7 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n7mno890pqr123","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario7.txt with \"Testing archive feature\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"I'll create that file.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario7.txt","content":"Testing archive feature"},"uuid":"..."}
{"type":"tool_result","content":"File created successfully","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Done! File created.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"Done! File created.","uuid":"..."}
```

### Scenario 8: WebSocket Streaming

Uses WebSocket streaming instead of HTTP polling for real-time events.

```bash
npm run dev -- claude web test scenario8 --jsonl
```

```
{"type":"system","subtype":"init","session_id":"session_018n8pqr456stu789","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario8.txt with \"Testing WebSocket streaming\"","role":"user"},"uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"Creating the file now.","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"tool_use","name":"Write","input":{"file_path":"test-scenario8.txt","content":"Testing WebSocket streaming"},"uuid":"..."}
{"type":"tool_result","content":"File created","uuid":"..."}
{"type":"assistant","message":{"content":[{"text":"File created successfully with WebSocket streaming!","type":"text"}],"role":"assistant"},"uuid":"..."}
{"type":"result","subtype":"success","result":"File created successfully with WebSocket streaming!","uuid":"..."}
```

### All Scenarios

Runs all 8 scenarios sequentially with summary statistics.

```bash
npm run dev -- claude web test all --jsonl
```

```
{"scenario":1,"status":"running"}
{"type":"system","subtype":"init","session_id":"session_018n2abc123def456","uuid":"..."}
{"type":"user","message":{"content":"Create a file called test-scenario1.txt...","role":"user"},"uuid":"..."}
...
{"type":"result","subtype":"success","result":"...","uuid":"..."}
{"scenario":1,"status":"success","timeMs":10500}
{"scenario":2,"status":"running"}
{"type":"system","subtype":"init","session_id":"session_018n2xyz789ghi012","uuid":"..."}
...
{"scenario":2,"status":"success","timeMs":8400}
{"scenario":3,"status":"running"}
...
{"scenario":8,"status":"success","timeMs":4700}
{"summary":{"scenarios":[{"scenario":1,"status":"success","timeMs":10500},{"scenario":2,"status":"success","timeMs":8400},{"scenario":3,"status":"success","timeMs":11500},{"scenario":4,"status":"success","timeMs":22400},{"scenario":5,"status":"success","timeMs":15500},{"scenario":6,"status":"success","timeMs":6000},{"scenario":7,"status":"success","timeMs":5900},{"scenario":8,"status":"success","timeMs":4700}],"totalTimeMs":84900,"success":8,"failed":0,"skipped":0}}
```

#### Skipping Scenarios

Use `--skip` to skip specific scenarios:

```bash
npm run dev -- claude web test all --skip 4,5,8 --jsonl
```

```
{"scenario":1,"status":"running"}
...
{"scenario":1,"status":"success","timeMs":10500}
{"scenario":2,"status":"running"}
...
{"scenario":2,"status":"success","timeMs":8400}
{"scenario":3,"status":"running"}
...
{"scenario":3,"status":"success","timeMs":11500}
{"scenario":4,"status":"skipped","timeMs":0}
{"scenario":5,"status":"skipped","timeMs":0}
{"scenario":6,"status":"running"}
...
{"scenario":6,"status":"success","timeMs":6000}
{"scenario":7,"status":"running"}
...
{"scenario":7,"status":"success","timeMs":5900}
{"scenario":8,"status":"skipped","timeMs":0}
{"summary":{"scenarios":[{"scenario":1,"status":"success","timeMs":10500},{"scenario":2,"status":"success","timeMs":8400},{"scenario":3,"status":"success","timeMs":11500},{"scenario":4,"status":"skipped","timeMs":0},{"scenario":5,"status":"skipped","timeMs":0},{"scenario":6,"status":"success","timeMs":6000},{"scenario":7,"status":"success","timeMs":5900},{"scenario":8,"status":"skipped","timeMs":0}],"totalTimeMs":42700,"success":5,"failed":0,"skipped":3}}
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

### Test Options

| Option | Description |
|--------|-------------|
| `--git-url <url>` | Git URL to use (default: anthropics/claude-code) |
| `--wait-ms <ms>` | How long to wait before stopping/interrupting |
| `--skip <scenarios>` | Comma-separated list of scenarios to skip (all command only) |
| `--json` | Output results as JSON |
| `--jsonl` | Stream events as JSON Lines |
