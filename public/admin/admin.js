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
} from "../firebase.js?v=6";

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
const ADMIN_EMAIL = "domy.oneplus@gmail.com",
  login = document.querySelector("#login"),
  denied = document.querySelector("#denied"),
  dashboard = document.querySelector("#dashboard"),
  message = document.querySelector("#message");
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
  await loadLogs();
});
async function loadLogs() {
  try {
    const [logsSnap, entriesSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "logs"),
            orderBy("createdAt", "desc"),
            limit(500),
          ),
        ),
        getDocs(query(collection(db, "entries"), limit(1000))),
      ]),
      entries = new Map();
    entriesSnap.forEach((d) => entries.set(d.id, d.data()));
    const body = document.querySelector("#logs");
    body.replaceChildren();
    logsSnap.forEach((item) => {
      const log = item.data(),
        entry = entries.get(item.id),
        tr = document.createElement("tr"),
        preview = document.createElement("canvas");
      if (entry?.pixels) {
        const values = JSON.parse(entry.pixels),
          size = Math.round(Math.sqrt(values.length));
        preview.width = preview.height = size;
        const ctx = preview.getContext("2d");
        values.forEach((c, i) => {
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
          }
        });
      }
      const cells = [
        preview,
        log.artistName || "–",
        `${log.accountName || "–"}\n${log.email || ""}`,
        log.createdAt?.toDate?.().toLocaleString("de-DE") || "–",
        `${log.x}, ${log.y}`,
        item.id,
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
    document.querySelector("#count").textContent = logsSnap.size;
  } catch (error) {
    message.textContent =
      "Logs konnten nicht geladen werden. Prüfe die Firestore-Regeln.";
  }
}
