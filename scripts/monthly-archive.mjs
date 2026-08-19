import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const WIDTH = 1920;
const HEIGHT = 1080;
const TIME_ZONE = "Europe/Berlin";
const secret = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!secret?.client_email || !secret?.private_key || !secret?.project_id) {
  throw new Error("GitHub-Secret FIREBASE_SERVICE_ACCOUNT fehlt oder ist ungültig.");
}

function dateParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

const now = new Date();
const local = dateParts(now);
const forced = process.argv.includes("--force");
if (!forced && local.day !== 1) {
  console.log("Heute ist in Berlin nicht der erste Monatstag – nichts zu tun.");
  process.exit(0);
}
let archiveYear = local.year;
let archiveMonth = forced ? local.month : local.month - 1;
if (archiveMonth === 0) {
  archiveMonth = 12;
  archiveYear -= 1;
}
const monthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(
  new Date(Date.UTC(archiveYear, archiveMonth - 1, 15)),
);
const label = `${monthName} ${archiveYear}`;
const file = `${archiveYear}-${String(archiveMonth).padStart(2, "0")}_${monthName}.png`;

const b64url = (value) => Buffer.from(value).toString("base64url");
async function accessToken() {
  const issued = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: secret.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: issued,
      exp: issued + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(secret.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google-Anmeldung fehlgeschlagen: ${await response.text()}`);
  return (await response.json()).access_token;
}

const token = await accessToken();
const api = `https://firestore.googleapis.com/v1/projects/${secret.project_id}/databases/(default)/documents`;
async function loadEntries() {
  const documents = [];
  let pageToken = "";
  do {
    const url = new URL(`${api}/entries`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Einträge konnten nicht geladen werden: ${await response.text()}`);
    const page = await response.json();
    documents.push(...(page.documents || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return documents;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}
function png(entries) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
  for (let y = 0; y < HEIGHT; y += 32) {
    for (let x = 0; x < WIDTH; x += 32) {
      const i = (y * WIDTH + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 27;
    }
  }
  for (const document of entries) {
    const fields = document.fields || {};
    const x = Number(fields.x?.integerValue || 0);
    const y = Number(fields.y?.integerValue || 0);
    let art;
    try { art = JSON.parse(fields.pixels?.stringValue || "[]"); } catch { continue; }
    const size = Math.round(Math.sqrt(art.length));
    art.forEach((color, index) => {
      if (!/^#[0-9a-f]{6}$/i.test(color)) return;
      const px = x + (index % size);
      const py = y + Math.floor(index / size);
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
      const target = (py * WIDTH + px) * 4;
      pixels[target] = parseInt(color.slice(1, 3), 16);
      pixels[target + 1] = parseInt(color.slice(3, 5), 16);
      pixels[target + 2] = parseInt(color.slice(5, 7), 16);
    });
  }
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) pixels.copy(raw, y * (WIDTH * 4 + 1) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

await mkdir("docs/archiv", { recursive: true });
await mkdir("public/archiv", { recursive: true });
const manifestPath = "docs/archiv/index.json";
let manifest = [];
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
if (manifest.some((item) => item.file === file)) {
  console.log(`${label} wurde bereits archiviert.`);
  process.exit(0);
}
const entries = await loadEntries();
const image = png(entries);
await writeFile(`docs/archiv/${file}`, image);
await writeFile(`public/archiv/${file}`, image);
manifest.unshift({ file, label, entries: entries.length, archivedAt: now.toISOString() });
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile("docs/archiv/index.json", manifestJson);
await writeFile("public/archiv/index.json", manifestJson);

for (let offset = 0; offset < entries.length; offset += 20) {
  await Promise.all(
    entries.slice(offset, offset + 20).map(async (document) => {
      const response = await fetch(`https://firestore.googleapis.com/v1/${document.name}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Löschen fehlgeschlagen: ${await response.text()}`);
    }),
  );
}
console.log(`${label}: ${entries.length} Einträge archiviert und die Wand geleert.`);
