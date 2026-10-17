#!/usr/bin/env node
// 학습용 최소 MCP 서버.
// Claude Code가 이 파일을 자식 프로세스로 실행하고, 표준입출력(stdio)으로 JSON-RPC 메시지를 주고받는다.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1) 서버 객체 만들기: 이름과 버전은 클라이언트(Claude Code)에 표시된다.
const server = new McpServer({
  name: "hello-mcp",
  version: "1.0.0",
});

// 2) 도구(tool) 등록하기
//    - 첫 번째 인자: 도구 이름 (Claude가 호출할 때 쓰는 이름)
//    - description: Claude가 "언제 이 도구를 쓸지" 판단하는 근거이므로 구체적으로 쓴다.
//    - inputSchema: zod로 입력값의 형식을 정한다. Claude는 이 스키마를 보고 인자를 채운다.
server.registerTool(
  "say_hello",
  {
    title: "인사하기",
    description: "이름을 받아 한국어로 인사말을 돌려준다.",
    inputSchema: {
      name: z.string().describe("인사할 사람의 이름"),
    },
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `안녕하세요, ${name}님! hello-mcp 서버에서 인사드려요.` }],
  })
);

server.registerTool(
  "add",
  {
    title: "더하기",
    description: "두 수를 더한 결과를 돌려준다.",
    inputSchema: {
      a: z.number().describe("첫 번째 수"),
      b: z.number().describe("두 번째 수"),
    },
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: `${a} + ${b} = ${a + b}` }],
  })
);

server.registerTool(
  "current_time",
  {
    title: "현재 시각",
    description: "서버가 실행 중인 컴퓨터의 현재 시각을 한국 시간(KST)으로 알려준다.",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text",
        text: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      },
    ],
  })
);

// 3) stdio 전송 계층에 연결하고 요청을 기다린다.
//    주의: stdout은 MCP 메시지 전용이다. 디버그 출력은 반드시 console.error(stderr)로 한다.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("hello-mcp 서버가 stdio에서 대기 중입니다.");
