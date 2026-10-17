# hello-mcp: 첫 MCP 서버 만들기

Claude Code에 직접 만든 도구를 붙여 보는 가장 작은 예제입니다.
이 서버는 세 가지 도구를 제공합니다.

| 도구 | 하는 일 | 예시 |
| --- | --- | --- |
| `say_hello` | 이름을 받아 인사말을 돌려줌 | "철수에게 인사해줘" |
| `add` | 두 수를 더함 | "hello-mcp로 2 더하기 3 해줘" |
| `current_time` | 현재 시각(KST)을 알려줌 | "지금 몇 시야? hello-mcp로 확인해줘" |

---

## 0. MCP가 뭔가요?

**MCP(Model Context Protocol)** 는 AI 앱(클라이언트)과 외부 기능(서버)을 잇는 표준 규약입니다.
USB-C처럼 "규격만 맞추면 어떤 AI 앱에도 꽂을 수 있는 플러그"라고 생각하면 됩니다.

```
┌──────────────┐   JSON-RPC (stdin/stdout)   ┌──────────────┐
│ Claude Code  │ ──────────────────────────▶ │  hello-mcp   │
│ (클라이언트)  │ ◀────────────────────────── │  (서버)       │
└──────────────┘                             └──────────────┘
```

- **클라이언트**: Claude Code, Claude Desktop 같은 AI 앱
- **서버**: 우리가 만드는 프로그램. 도구(tools), 리소스(resources), 프롬프트(prompts)를 제공
- **전송 방식(transport)**: 이 예제는 `stdio` 방식입니다. Claude Code가 `node server.js`를 직접 실행하고, 표준입출력으로 대화합니다.

이 예제에서는 MCP의 세 가지 기능 중 가장 많이 쓰는 **도구(tools)** 만 다룹니다.

---

## 1. 준비물

- **Node.js 18 이상** (`node -v`로 확인)
- **Claude Code** (`claude --version`으로 확인)

## 2. 설치

```bash
git clone https://github.com/NoWorkPlz/AIPractice.git
cd AIPractice/mcp/hello-mcp
npm install
```

## 3. 서버가 잘 도는지 먼저 확인하기

Claude Code에 붙이기 전에, 포함된 테스트 클라이언트로 서버를 직접 호출해 봅니다.

```bash
npm test
```

이렇게 나오면 성공입니다.

```
hello-mcp 서버가 stdio에서 대기 중입니다.
도구 목록: say_hello, add, current_time
say_hello → 안녕하세요, 철수님! hello-mcp 서버에서 인사드려요.
add → 2 + 3 = 5
current_time → 2026. 10. 17. 오후 1:52:22
```

> 참고: `npm start`로 서버만 실행하면 아무 반응 없이 멈춰 있는 것처럼 보입니다.
> 정상입니다. 클라이언트의 메시지를 stdin으로 기다리는 중이니 `Ctrl+C`로 끄면 됩니다.

## 4. Claude Code에 연결하기

### 방법 A: 명령어로 추가 (추천)

`hello-mcp` 폴더 안에서 아래를 실행합니다. `$(pwd)`가 현재 폴더의 절대 경로로 바뀝니다.

```bash
claude mcp add hello-mcp -- node "$(pwd)/server.js"
```

- `hello-mcp`: Claude Code 안에서 부를 서버 이름
- `--` 뒤: 서버를 실행하는 명령어 (경로는 **절대 경로**로 주는 것이 안전합니다)

Windows PowerShell이라면 이렇게 씁니다.

```powershell
claude mcp add hello-mcp -- node "$PWD\server.js"
```

### 등록 범위(scope) 고르기

`--scope` 옵션으로 이 서버를 어디서 쓸지 정할 수 있습니다.

| scope | 저장 위치 | 쓰임 |
| --- | --- | --- |
| `local` (기본값) | `~/.claude.json`의 현재 프로젝트 항목 | 이 폴더에서 나만 사용 |
| `project` | 프로젝트 루트의 `.mcp.json` | git에 올려 팀원과 공유. 처음 쓸 때 승인 창이 뜸 |
| `user` | `~/.claude.json` | 내 컴퓨터의 모든 프로젝트에서 사용 |

```bash
# 예: 어느 폴더에서든 쓰고 싶을 때
claude mcp add --scope user hello-mcp -- node "/절대/경로/AIPractice/mcp/hello-mcp/server.js"
```

### 방법 B: `.mcp.json` 파일 직접 쓰기

`--scope project`로 추가하면 아래 파일이 생깁니다. 직접 만들어도 똑같이 동작합니다.

```json
{
  "mcpServers": {
    "hello-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/절대/경로/AIPractice/mcp/hello-mcp/server.js"],
      "env": {}
    }
  }
}
```

## 5. 연결 확인

터미널에서:

```bash
claude mcp list
```

```
hello-mcp: node /.../hello-mcp/server.js - ✓ Connected
```

Claude Code 대화창 안에서는 `/mcp`를 입력하면 연결된 서버와 도구 목록을 볼 수 있습니다.

## 6. 써 보기

Claude Code를 실행하고 이렇게 말해 보세요.

```
hello-mcp로 영희에게 인사해줘
```

Claude가 `say_hello` 도구를 쓰겠다고 허락을 구하면 승인합니다.
도구 이름은 Claude Code 안에서 `mcp__hello-mcp__say_hello` 형태로 보입니다.

---

## 7. 코드 읽어 보기

[`server.js`](./server.js)는 세 단계로 되어 있습니다.

```js
// 1) 서버 만들기
const server = new McpServer({ name: "hello-mcp", version: "1.0.0" });

// 2) 도구 등록하기
server.registerTool(
  "add",                                   // 도구 이름
  {
    title: "더하기",
    description: "두 수를 더한 결과를 돌려준다.",   // Claude가 언제 쓸지 판단하는 근거
    inputSchema: { a: z.number(), b: z.number() }, // 입력 형식 (zod)
  },
  async ({ a, b }) => ({                   // 실제 동작
    content: [{ type: "text", text: `${a} + ${b} = ${a + b}` }],
  })
);

// 3) stdio로 연결
await server.connect(new StdioServerTransport());
```

꼭 기억할 점 세 가지:

1. **`description`이 중요합니다.** Claude는 이 설명만 보고 도구를 고릅니다. 모호하면 안 쓰거나 엉뚱할 때 씁니다.
2. **`inputSchema`로 입력을 정합니다.** `.describe()`로 각 값에 설명을 달아 주면 Claude가 인자를 더 정확히 채웁니다.
3. **`console.log`를 쓰면 안 됩니다.** stdout은 MCP 메시지 전용 통로라서, 여기에 다른 글자가 섞이면 연결이 깨집니다. 디버그 출력은 `console.error`로 하세요.

## 8. 도구 하나 추가해 보기 (연습 문제)

`server.js`에 아래 코드를 `server.connect(...)` 위에 붙여 넣어 보세요.

```js
server.registerTool(
  "reverse",
  {
    title: "뒤집기",
    description: "문자열을 거꾸로 뒤집는다.",
    inputSchema: { text: z.string().describe("뒤집을 문자열") },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: [...text].reverse().join("") }],
  })
);
```

서버 코드를 바꾼 뒤에는 Claude Code를 다시 시작하거나, `/mcp`에서 서버를 다시 연결해야 반영됩니다.

## 9. 문제가 생겼을 때

| 증상 | 확인할 것 |
| --- | --- |
| `claude mcp list`에서 `Failed to connect` | `npm install`을 했는지, 경로가 절대 경로인지, `node server.js`가 혼자서 에러 없이 뜨는지 |
| `Pending approval` | `--scope project`로 추가한 경우입니다. 그 폴더에서 `claude`를 실행해 승인하세요 |
| 도구를 안 씀 | 프롬프트에 "hello-mcp로"를 붙여 명시하거나 `description`을 더 구체적으로 |
| 코드를 고쳤는데 그대로 | Claude Code 재시작 또는 `/mcp`에서 재연결 |

브라우저에서 서버를 직접 눌러 보고 싶다면 공식 디버깅 도구 MCP Inspector를 씁니다.

```bash
npm run inspect
```

## 10. 정리(삭제)

```bash
claude mcp remove hello-mcp
```

## 더 읽어 보기

- MCP 공식 문서: https://modelcontextprotocol.io
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Code의 MCP 문서: https://docs.claude.com/en/docs/claude-code/mcp
