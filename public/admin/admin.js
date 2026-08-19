import {
  auth,
  db,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from "../firebase.js?v=11";

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
const ADMIN_EMAIL = "domy.oneplus@gmail.com",
  login = document.querySelector("#login"),
  denied = document.querySelector("#denied"),
  dashboard = document.querySelector("#dashboard"),
  message = document.querySelector("#message");
let archivesPromise;
document.querySelector("#loginButton").onclick = () =>
  signInWithPopup(auth, provider).catch((error) => {
    console.error("Firebase login failed", error);
    message.textContent = `Anmeldung fehlgeschlagen: ${error.code || "unbekannter-fehler"}`;
  });
document.querySelector("#switchAccount").onclick = async () => {
  try {
    await signOut(auth);
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Firebase account switch failed", error);
    message.textContent = `Anmeldung fehlgeschlagen: ${error.code || "unbekannter-fehler"}`;
  }
};
document.querySelector("#logoutButton").onclick = () => signOut(auth);
onAuthStateChanged(auth, async (user) => {
  login.hidden = !!user;
  denied.hidden = true;
  dashboard.hidden = true;
  message.textContent = "";
  if (!user) return;
  if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
    denied.hidden = false;
    return;
  }
  dashboard.hidden = false;
  document.querySelector("#adminName").textContent =
    user.displayName || user.email;
  await Promise.all([loadLogs(), loadArchives()]);
});
async function loadArchives() {
  const grid = document.querySelector("#archiveGrid");
  try {
    const archives = await getArchives();
    grid.replaceChildren();
    archives.forEach((archive) => {
      const card = document.createElement("a");
      card.className = "archiveCard";
      card.href = `../archiv/${archive.file}`;
      card.target = "_blank";
      card.rel = "noopener";
      const image = document.createElement("img");
      image.src = card.href;
      image.alt = `Archivierte Gästebuch-Wand ${archive.label}`;
      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = archive.label;
      const meta = document.createElement("span");
      meta.textContent = `${archive.entries} Kunstwerke · PNG öffnen`;
      text.append(title, meta);
      card.append(image, text);
      grid.append(card);
    });
    if (!archives.length) grid.textContent = "Noch keine Monatsarchive vorhanden.";
    document.querySelector("#archiveCount").textContent = `${archives.length} ${archives.length === 1 ? "Archiv" : "Archive"}`;
  } catch {
    grid.textContent = "Das Archiv konnte nicht geladen werden.";
  }
}
function getArchives() {
  if (!archivesPromise) {
    archivesPromise = fetch(`../archiv/index.json?v=${Date.now()}`).then(
      (response) => {
        if (!response.ok) throw new Error("Archiv nicht erreichbar");
        return response.json();
      },
    );
  }
  return archivesPromise;
}
function createLogTable(items) {
  const wrap = document.createElement("div"),
    table = document.createElement("table"),
    head = document.createElement("thead"),
    headerRow = document.createElement("tr"),
    body = document.createElement("tbody");
  wrap.className = "tableWrap";
  ["Grafik", "Künstlername", "Google-Konto", "Zeitpunkt", "Position", "Eintrags-ID"].forEach(
    (label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.append(th);
    },
  );
  head.append(headerRow);
  items.forEach(({ id, log, entry }) => {
    const tr = document.createElement("tr"),
      preview = document.createElement("canvas");
    if (entry?.pixels) {
      const values = JSON.parse(entry.pixels),
        size = Math.round(Math.sqrt(values.length));
      preview.width = preview.height = size;
      const ctx = preview.getContext("2d");
      values.forEach((color, index) => {
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(index % size, Math.floor(index / size), 1, 1);
        }
      });
    }
    const cells = [
      preview,
      log.artistName || "–",
      `${log.accountName || "–"}\n${log.email || ""}`,
      log.createdAt?.toDate?.().toLocaleString("de-DE") || "–",
      `${log.x}, ${log.y}`,
      id,
    ];
    cells.forEach((value, index) => {
      const td = document.createElement("td");
      if (value instanceof Node) td.append(value);
      else {
        td.textContent = value;
        if (index === 2) td.style.whiteSpace = "pre-line";
      }
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}
async function loadLogs() {
  try {
    const [logsSnap, entriesSnap, archives] = await Promise.all([
        getDocs(
          query(
            collection(db, "logs"),
            orderBy("createdAt", "desc"),
            limit(500),
          ),
        ),
        getDocs(query(collection(db, "entries"), limit(1000))),
        getArchives(),
      ]),
      entries = new Map();
    entriesSnap.forEach((d) => entries.set(d.id, d.data()));
    const items = [];
    logsSnap.forEach((item) => {
      items.push({ id: item.id, log: item.data(), entry: entries.get(item.id) });
    });
    const cutoffs = [...archives].sort(
      (a, b) => new Date(a.archivedAt) - new Date(b.archivedAt),
    );
    const groups = new Map();
    items.forEach((item) => {
      const created = item.log.createdAt?.toDate?.().getTime() || 0;
      const archive = cutoffs.find((candidate) => created <= new Date(candidate.archivedAt).getTime());
      const key = archive?.file || "current";
      const label = archive?.label || `Aktuelle Wand · ${new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date())}`;
      if (!groups.has(key)) groups.set(key, { label, items: [], current: !archive });
      groups.get(key).items.push(item);
    });
    const container = document.querySelector("#logGroups");
    container.replaceChildren();
    [...groups.values()]
      .sort((a, b) => Number(b.current) - Number(a.current))
      .forEach((group) => {
        const details = document.createElement("details"),
          summary = document.createElement("summary"),
          title = document.createElement("strong"),
          count = document.createElement("span");
        details.className = "logGroup";
        details.open = group.current;
        title.textContent = group.label;
        count.textContent = `${group.items.length} ${group.items.length === 1 ? "Eintrag" : "Einträge"}`;
        summary.append(title, count);
        details.append(summary, createLogTable(group.items));
        container.append(details);
      });
    if (!items.length) container.textContent = "Noch keine protokollierten Einträge.";
    document.querySelector("#count").textContent = logsSnap.size;
  } catch (error) {
    message.textContent =
      "Logs konnten nicht geladen werden. Prüfe die Firestore-Regeln.";
  }
}
