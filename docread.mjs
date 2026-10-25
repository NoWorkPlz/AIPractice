// 업로드한 파일을 Claude 메시지의 content 블록으로 바꾼다.
// PDF·이미지는 그대로(이미지는 크기만 줄여서), 문서 파일은 브라우저에서 글자를 뽑아 텍스트 문서로 보낸다.
// 지원: PDF, PNG·JPG·WEBP·GIF·BMP, HWP(한글 5.x), HWPX, DOCX, XLSX, PPTX, TXT·MD·CSV·TSV·JSON

const IMAGE_MAX_EDGE = 1800;      // 긴 변 기준 픽셀
const IMAGE_MAX_COUNT = 40;       // 문서 하나에서 꺼내는 그림 수
const TEXT_MAX_CHARS = 800000;    // 이보다 길면 나눠 올리도록 안내
const SCAN_TEXT_MIN = 80;         // 글자가 이보다 적으면 스캔 문서로 보고 그림을 함께 보냄

export class UploadError extends Error {
  constructor(message) { super(message); this.userMessage = message; }
}

export async function readUpload(file) {
  const name = file.name || "파일";
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
  const type = file.type || "";

  if (type === "application/pdf" || ext === "pdf") {
    return { blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: await toBase64(file) }, title: name }], kind: "PDF" };
  }
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"].includes(ext)) {
    return { blocks: [await imageBlock(file, name)], kind: "그림" };
  }
  if (["doc", "xls", "ppt"].includes(ext)) {
    throw new UploadError(`${name}: 예전 오피스 형식(.${ext})은 읽을 수 없어요. ${ext}x 형식이나 PDF로 저장해서 올려 주세요.`);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  let out, kind;
  try {
    if (ext === "hwp") { out = await readHwp(buf); kind = "한글"; }
    else if (ext === "hwpx") { out = await readZipDoc(buf, "hwpx"); kind = "한글"; }
    else if (ext === "docx") { out = await readZipDoc(buf, "docx"); kind = "워드"; }
    else if (ext === "pptx") { out = await readZipDoc(buf, "pptx"); kind = "파워포인트"; }
    else if (ext === "xlsx") { out = await readXlsx(buf); kind = "엑셀"; }
    else if (["txt", "md", "csv", "tsv", "json", "log", "text"].includes(ext) || type.startsWith("text/")) { out = { text: decodeText(buf) }; kind = "텍스트"; }
    else throw new UploadError(`${name}: 지원하지 않는 파일 형식이에요. PDF, 사진, 한글, 워드, 엑셀, 파워포인트, 텍스트 파일을 올려 주세요.`);
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError(`${name}: 파일을 읽지 못했어요(${e.message}). PDF로 저장해서 올려 주세요.`);
  }

  const images = out.images || [];
  const text = (out.text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > TEXT_MAX_CHARS) {
    throw new UploadError(`${name}: 내용이 너무 길어요(${text.length.toLocaleString()}자). 파일을 나눠서 올려 주세요.`);
  }
  const blocks = [];
  if (text) blocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: name });
  if (text.length < SCAN_TEXT_MIN) {
    for (const img of images.slice(0, IMAGE_MAX_COUNT)) {
      try { blocks.push(await imageBlock(new Blob([img]), name)); } catch (e) { /* 그릴 수 없는 그림(EMF·WMF 등)은 건너뜀 */ }
    }
  }
  if (!blocks.length) throw new UploadError(`${name}: 읽을 수 있는 글자나 그림이 없어요.`);
  return { blocks, kind, chars: text.length };
}

/* ---------- 공통 ---------- */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function imageBlock(blob, name) {
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch (e) { throw new UploadError(`${name}: 그림을 열지 못했어요. JPG나 PNG로 저장해서 올려 주세요.`); }
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // 투명 배경을 흰색으로
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toBase64(out) } };
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
  catch (e) { return new TextDecoder("euc-kr").decode(u8); } // 오래된 한국어 텍스트(CP949)
}

function isImageBytes(u8) {
  if (u8.length < 12) return false;
  return (u8[0] === 0x89 && u8[1] === 0x50) ||                       // PNG
    (u8[0] === 0xff && u8[1] === 0xd8) ||                             // JPEG
    (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) ||           // GIF
    (u8[0] === 0x42 && u8[1] === 0x4d) ||                             // BMP
    (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[9] === 0x45); // WEBP
}

/* ---------- ZIP (DOCX·XLSX·PPTX·HWPX) ---------- */
async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("압축 구조를 찾지 못함");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    entries.set(name, async () => {
      const raw = u8.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error("지원하지 않는 압축 방식");
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// 문단(pTag) 안의 글자(tTag)를 순서대로 이어 붙인다. 표 안 문단도 한 번씩만 나온다.
function xmlParagraphs(xml, tTag, pTag, extra = {}) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const lines = [];
  let cur = null, line = "";
  const walk = (node) => {
    for (let el = node.firstElementChild; el; el = el.nextElementSibling) {
      const ln = el.localName;
      if (ln === tTag) {
        let para = el.parentElement;
        while (para && para.localName !== pTag) para = para.parentElement;
        if (para !== cur) { if (cur) lines.push(line); cur = para; line = ""; }
        line += el.textContent;
      } else if (extra[ln] !== undefined) {
        line += extra[ln];
      } else {
        walk(el);
      }
    }
  };
  walk(doc.documentElement);
  if (cur) lines.push(line);
  return lines.join("\n");
}

const byNumber = (re) => (a, b) => Number(a.match(re)[1]) - Number(b.match(re)[1]);

async function readZipDoc(u8, kind) {
  const zip = await unzip(u8);
  const names = [...zip.keys()];
  const parts = [];
  if (kind === "docx") {
    for (const n of ["word/document.xml", ...names.filter((n) => /^word\/(header|footer|footnotes)\d*\.xml$/.test(n))]) {
      if (zip.has(n)) parts.push(xmlParagraphs(new TextDecoder().decode(await zip.get(n)()), "t", "p", { tab: "\t", br: "\n" }));
    }
  } else if (kind === "pptx") {
    const re = /^ppt\/slides\/slide(\d+)\.xml$/;
    for (const n of names.filter((n) => re.test(n)).sort(byNumber(re))) {
      parts.push(`[슬라이드 ${n.match(re)[1]}]\n` + xmlParagraphs(new TextDecoder().decode(await zip.get(n)()), "t", "p", { br: "\n" }));
    }
  } else if (kind === "hwpx") {
    const re = /^Contents\/section(\d+)\.xml$/i;
    for (const n of names.filter((n) => re.test(n)).sort(byNumber(re))) {
      parts.push(xmlParagraphs(new TextDecoder().decode(await zip.get(n)()), "t", "p", { tab: "\t", lineBreak: "\n" }));
    }
  }
  const text = parts.join("\n\n");
  const images = [];
  if (text.replace(/\s|\[슬라이드 \d+\]/g, "").length < SCAN_TEXT_MIN) {
    const mediaRe = kind === "docx" ? /^word\/media\// : kind === "pptx" ? /^ppt\/media\// : /^BinData\//i;
    for (const n of names.filter((n) => mediaRe.test(n)).sort()) {
      const data = await zip.get(n)();
      if (isImageBytes(data)) images.push(data);
      if (images.length >= IMAGE_MAX_COUNT) break;
    }
  }
  return { text, images };
}

async function readXlsx(u8) {
  const zip = await unzip(u8);
  const dec = new TextDecoder();
  const parse = async (n) => new DOMParser().parseFromString(dec.decode(await zip.get(n)()), "application/xml");
  const shared = [];
  if (zip.has("xl/sharedStrings.xml")) {
    const doc = await parse("xl/sharedStrings.xml");
    for (const si of doc.getElementsByTagNameNS("*", "si")) {
      shared.push([...si.getElementsByTagNameNS("*", "t")].map((t) => t.textContent).join(""));
    }
  }
  // 시트 이름과 파일 연결
  const sheets = [];
  if (zip.has("xl/workbook.xml") && zip.has("xl/_rels/workbook.xml.rels")) {
    const wb = await parse("xl/workbook.xml"), rels = await parse("xl/_rels/workbook.xml.rels");
    const target = {};
    for (const r of rels.getElementsByTagNameNS("*", "Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    for (const s of wb.getElementsByTagNameNS("*", "sheet")) {
      const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id");
      let t = target[rid] || "";
      t = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
      if (zip.has(t)) sheets.push({ name: s.getAttribute("name"), path: t });
    }
  }
  if (!sheets.length) {
    const re = /^xl\/worksheets\/sheet(\d+)\.xml$/;
    [...zip.keys()].filter((n) => re.test(n)).sort(byNumber(re)).forEach((n, i) => sheets.push({ name: `시트${i + 1}`, path: n }));
  }
  const parts = [];
  for (const sh of sheets) {
    const doc = await parse(sh.path);
    const rows = [];
    for (const row of doc.getElementsByTagNameNS("*", "row")) {
      const cells = [];
      for (const c of row.getElementsByTagNameNS("*", "c")) {
        const t = c.getAttribute("t");
        const v = c.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
        let val;
        if (t === "s") val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = [...c.getElementsByTagNameNS("*", "t")].map((x) => x.textContent).join("");
        else val = v;
        const col = colIndex(c.getAttribute("r"));
        if (col >= 0) cells[col] = val; else cells.push(val);
      }
      const line = Array.from(cells, (x) => (x ?? "").replace(/\s+/g, " ").trim()).join("\t").replace(/\t+$/, "");
      if (line) rows.push(line);
    }
    if (rows.length) parts.push(`[시트: ${sh.name}]\n` + rows.join("\n"));
  }
  return { text: parts.join("\n\n") };
}
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------- HWP 5.x (OLE 복합 문서) ---------- */
function readCfb(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((b, i) => u8[i] === b)) throw new UploadError("HWP 5.0 이전 형식이거나 한글 파일이 아니에요. 한글에서 HWP(5.0 이상)나 PDF로 다시 저장해 올려 주세요.");
  const ss = 1 << dv.getUint16(0x1e, true), mss = 1 << dv.getUint16(0x20, true);
  const cutoff = dv.getUint32(0x38, true);
  const END = 0xfffffffe;
  const sectorOff = (id) => (id + 1) * ss;
  // FAT 섹터 목록(DIFAT)
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const id = dv.getUint32(0x4c + i * 4, true); if (id < 0xfffffffa) fatSectors.push(id); }
  let difat = dv.getUint32(0x44, true), guard = 0;
  while (difat < 0xfffffffa && guard++ < 10000) {
    const off = sectorOff(difat);
    for (let i = 0; i < ss / 4 - 1; i++) { const id = dv.getUint32(off + i * 4, true); if (id < 0xfffffffa) fatSectors.push(id); }
    difat = dv.getUint32(off + ss - 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (ss / 4));
  fatSectors.forEach((s, i) => { for (let j = 0; j < ss / 4; j++) fat[i * (ss / 4) + j] = dv.getUint32(sectorOff(s) + j * 4, true); });
  const chain = (start, table) => {
    const out = [];
    for (let id = start, n = 0; id !== END && id < table.length && n < table.length; id = table[id], n++) out.push(id);
    return out;
  };
  const readBig = (start, size) => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const id of chain(start, fat)) {
      if (pos >= size) break;
      const off = sectorOff(id), n = Math.min(ss, size - pos);
      out.set(u8.subarray(off, off + n), pos); pos += n;
    }
    return out;
  };
  // 디렉터리
  const dirBytes = (() => { const ids = chain(dv.getUint32(0x30, true), fat); const b = new Uint8Array(ids.length * ss); ids.forEach((id, i) => b.set(u8.subarray(sectorOff(id), sectorOff(id) + ss), i * ss)); return b; })();
  const ddv = new DataView(dirBytes.buffer);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = ddv.getUint16(off + 64, true);
    entries.push({
      name: new TextDecoder("utf-16le").decode(dirBytes.subarray(off, off + Math.max(0, nameLen - 2))),
      type: dirBytes[off + 66], left: ddv.getUint32(off + 68, true), right: ddv.getUint32(off + 72, true),
      child: ddv.getUint32(off + 76, true), start: ddv.getUint32(off + 116, true), size: ddv.getUint32(off + 120, true)
    });
  }
  const root = entries[0];
  const miniFat = (() => {
    const ids = chain(dv.getUint32(0x3c, true), fat);
    const t = new Uint32Array(ids.length * (ss / 4));
    ids.forEach((s, i) => { for (let j = 0; j < ss / 4; j++) t[i * (ss / 4) + j] = dv.getUint32(sectorOff(s) + j * 4, true); });
    return t;
  })();
  const miniStream = root ? readBig(root.start, root.size) : new Uint8Array(0);
  const readStream = (e) => {
    if (e.size >= cutoff) return readBig(e.start, e.size);
    const out = new Uint8Array(e.size);
    let pos = 0;
    for (const id of chain(e.start, miniFat)) {
      if (pos >= e.size) break;
      const n = Math.min(mss, e.size - pos);
      out.set(miniStream.subarray(id * mss, id * mss + n), pos); pos += n;
    }
    return out;
  };
  // 경로 → 스트림
  const files = new Map();
  const NOSTREAM = 0xffffffff;
  const visit = (id, prefix, depth) => {
    if (id === NOSTREAM || id >= entries.length || depth > 64) return;
    const e = entries[id];
    visit(e.left, prefix, depth + 1);
    visit(e.right, prefix, depth + 1);
    const path = prefix + e.name;
    if (e.type === 2) files.set(path, () => readStream(e));
    else if (e.type === 1) visit(e.child, path + "/", depth + 1);
  };
  if (root) visit(root.child, "", 0);
  return files;
}

async function readHwp(u8) {
  const files = readCfb(u8);
  const header = files.get("FileHeader")?.();
  if (!header || !new TextDecoder().decode(header.subarray(0, 17)).startsWith("HWP Document File")) {
    throw new UploadError("한글 문서 구조를 찾지 못했어요. PDF로 저장해서 올려 주세요.");
  }
  const props = new DataView(header.buffer, header.byteOffset).getUint32(36, true);
  const compressed = !!(props & 1);
  if (props & 2) throw new UploadError("암호가 걸린 한글 문서예요. 암호를 풀고 저장한 뒤 올려 주세요.");
  const unpack = async (data) => { if (!compressed) return data; try { return await inflateRaw(data); } catch (e) { return data; } };

  let text = "";
  if (!(props & 4)) { // 배포용 문서는 본문이 암호화돼 있음
    const re = /^BodyText\/Section(\d+)$/;
    const sections = [...files.keys()].filter((n) => re.test(n)).sort(byNumber(re));
    const parts = [];
    for (const s of sections) parts.push(hwpRecordsText(await unpack(files.get(s)())));
    text = parts.join("\n\n");
  }
  if (!text.trim() && files.has("PrvText")) {
    // 미리보기 텍스트(문서 앞부분)라도 사용
    text = new TextDecoder("utf-16le").decode(files.get("PrvText")()).replace(/\0/g, "");
    if (props & 4) text = "[배포용 문서라 앞부분 미리보기만 읽었어요]\n" + text;
  }
  const images = [];
  if (text.replace(/\s/g, "").length < SCAN_TEXT_MIN) {
    for (const n of [...files.keys()].filter((n) => n.startsWith("BinData/")).sort()) {
      const data = await unpack(files.get(n)());
      if (isImageBytes(data)) images.push(data);
      if (images.length >= IMAGE_MAX_COUNT) break;
    }
  }
  return { text, images };
}

// 본문 레코드에서 문단 글자(HWPTAG_PARA_TEXT = 67)만 꺼낸다
function hwpRecordsText(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lines = [];
  let p = 0;
  while (p + 4 <= u8.length) {
    const h = dv.getUint32(p, true); p += 4;
    const tag = h & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) { if (p + 4 > u8.length) break; size = dv.getUint32(p, true); p += 4; }
    if (p + size > u8.length) break;
    if (tag === 67) lines.push(hwpParaText(dv, p, size));
    p += size;
  }
  return lines.join("\n");
}
function hwpParaText(dv, start, size) {
  let s = "";
  const end = start + size;
  for (let i = start; i + 1 < end;) {
    const c = dv.getUint16(i, true);
    if (c >= 32) { s += String.fromCharCode(c); i += 2; continue; }
    if (c === 0 || c === 10 || c === 13 || (c >= 24 && c <= 31)) { // 한 글자 크기 제어 문자
      if (c === 10) s += "\n"; else if (c >= 24) s += " ";
      i += 2; continue;
    }
    if (c === 9) s += "\t";
    i += 16; // 인라인·확장 제어 문자는 8글자(16바이트)
  }
  return s;
}
