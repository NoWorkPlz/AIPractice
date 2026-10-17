// 서버가 제대로 동작하는지 확인하는 간단한 클라이언트. 실행: node test-client.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["server.js"] });
const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("도구 목록:", tools.map((t) => t.name).join(", "));

for (const [name, args] of [
  ["say_hello", { name: "철수" }],
  ["add", { a: 2, b: 3 }],
  ["current_time", {}],
]) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`${name} →`, result.content[0].text);
}

await client.close();
