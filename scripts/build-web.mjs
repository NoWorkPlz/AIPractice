// 안드로이드 앱에 넣을 웹 파일을 www/ 로 복사한다.
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const f of ["index.html", "manifest.webmanifest", "sw.js"]) cpSync(f, `www/${f}`);
cpSync("icons", "www/icons", { recursive: true });
console.log("www/ ready");
