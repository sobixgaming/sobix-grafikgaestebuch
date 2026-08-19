import {
  auth,
  db,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
} from "./firebase.js?v=5";

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

const wall = document.querySelector("#wall"),
  viewport = document.querySelector("#viewport"),
  empty = document.querySelector("#empty"),
  dialog = document.querySelector("#editor"),
  canvas = document.querySelector("#pixelCanvas"),
  ctx = canvas.getContext("2d"),
  color = document.querySelector("#color"),
  nameInput = document.querySelector("#name"),
  placing = document.querySelector("#placing"),
  toast = document.querySelector("#toast");
let currentUser = null;
let pixels = Array(4096).fill(""),
  tool = "pen",
  drawing = false,
  pending = null,
  preview = null,
  history = [];
ctx.imageSmoothingEnabled = false;
function saveHistory() {
  history.push([...pixels]);
  if (history.length > 50) history.shift();
  document.querySelector("#undo").disabled = false;
}
function draw() {
  ctx.clearRect(0, 0, 64, 64);
  pixels.forEach((c, i) => {
    if (c) {
      ctx.fillStyle = c;
      ctx.fillRect(i % 64, Math.floor(i / 64), 1, 1);
    }
  });
}
function point(e) {
  const r = canvas.getBoundingClientRect();
  return [
    Math.max(
      0,
      Math.min(63, Math.floor(((e.clientX - r.left) * 64) / r.width)),
    ),
    Math.max(
      0,
      Math.min(63, Math.floor(((e.clientY - r.top) * 64) / r.height)),
    ),
  ];
}
function flood(x, y, replacement) {
  const target = pixels[y * 64 + x];
  if (target === replacement) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [a, b] = stack.pop(),
      i = b * 64 + a;
    if (a < 0 || a > 63 || b < 0 || b > 63 || pixels[i] !== target) continue;
    pixels[i] = replacement;
    stack.push([a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]);
  }
}
function paint(e) {
  const [x, y] = point(e);
  if (tool === "fill") flood(x, y, color.value);
  else pixels[y * 64 + x] = tool === "eraser" ? "" : color.value;
  draw();
}
canvas.addEventListener("pointerdown", (e) => {
  saveHistory();
  drawing = tool !== "fill";
  canvas.setPointerCapture(e.pointerId);
  paint(e);
});
canvas.addEventListener("pointermove", (e) => drawing && paint(e));
canvas.addEventListener("pointerup", () => (drawing = false));
canvas.addEventListener("pointercancel", () => (drawing = false));
canvas.addEventListener("touchstart", (e) => e.preventDefault(), {
  passive: false,
});
canvas.addEventListener("touchmove", (e) => e.preventDefault(), {
  passive: false,
});
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  document.querySelector("#userStatus").textContent = user
    ? user.displayName || user.email
    : "Nicht angemeldet";
  document.querySelector("#logout").hidden = !user;
});
document.querySelector("#logout").onclick = () => signOut(auth);
document.querySelector("#add").onclick = async () => {
  if (!currentUser) {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Firebase login failed", error);
      notify(
        error.code === "auth/popup-closed-by-user"
          ? "Anmeldung abgebrochen."
          : `Google-Anmeldung fehlgeschlagen: ${error.code || "unbekannter-fehler"}`,
      );
      return;
    }
  }
  pixels = Array(4096).fill("");
  history = [];
  document.querySelector("#undo").disabled = true;
  draw();
  nameInput.value =
    localStorage.getItem("guestName") || currentUser?.displayName || "";
  dialog.showModal();
};
document.querySelectorAll("[data-tool]").forEach(
  (b) =>
    (b.onclick = () => {
      tool = b.dataset.tool;
      document
        .querySelectorAll("[data-tool]")
        .forEach((x) => x.classList.toggle("active", x === b));
    }),
);
document.querySelector("#undo").onclick = () => {
  const previous = history.pop();
  if (!previous) return;
  pixels = previous;
  document.querySelector("#undo").disabled = history.length === 0;
  draw();
};
document.querySelector("#clear").onclick = () => {
  if (!pixels.some(Boolean)) return;
  saveHistory();
  pixels.fill("");
  draw();
};
document.querySelector("#editorForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.submitter?.value === "cancel") dialog.close("cancel");
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  nameInput.blur();
});
document.querySelector("#place").onclick = () => {
  if (!nameInput.reportValidity()) return;
  if (!pixels.some(Boolean)) return notify("Zeichne zuerst etwas.");
  localStorage.setItem("guestName", nameInput.value.trim());
  pending = { name: nameInput.value.trim(), pixels: JSON.stringify(pixels) };
  dialog.close();
  preview = document.createElement("canvas");
  preview.width = preview.height = 64;
  preview.className = "placement-preview";
  const pc = preview.getContext("2d");
  pixels.forEach((v, i) => {
    if (v) {
      pc.fillStyle = v;
      pc.fillRect(i % 64, Math.floor(i / 64), 1, 1);
    }
  });
  wall.append(preview);
  placing.classList.add("show");
  wall.style.cursor = "crosshair";
};
document.querySelector("#cancelPlace").onclick = () => stopPlace();
function stopPlace() {
  pending = null;
  preview?.remove();
  preview = null;
  placing.classList.remove("show");
  wall.style.cursor = "";
}
function wallPoint(e) {
  const r = wall.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        1856,
        Math.round(((e.clientX - r.left) * 1920) / r.width / 8) * 8,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        1016,
        Math.round(((e.clientY - r.top) * 1080) / r.height / 8) * 8,
      ),
    ),
  };
}
function fitWall() {
  if (window.innerWidth < 900) {
    wall.classList.remove("fit-screen");
    wall.style.transform = "";
    wall.style.left = "";
    wall.style.top = "";
    return;
  }
  const scale = Math.min(
    viewport.clientWidth / 1920,
    viewport.clientHeight / 1080,
  );
  wall.classList.add("fit-screen");
  wall.style.transform = `scale(${scale})`;
  wall.style.left = `${(viewport.clientWidth - 1920 * scale) / 2}px`;
  wall.style.top = `${(viewport.clientHeight - 1080 * scale) / 2}px`;
}
window.addEventListener("resize", fitWall);
wall.addEventListener("pointermove", (e) => {
  if (!preview) return;
  const { x, y } = wallPoint(e);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
});
wall.addEventListener("click", async (e) => {
  if (!pending) return;
  const { x, y } = wallPoint(e);
  const payload = { ...pending, x, y };
  stopPlace();
  try {
    if (!currentUser) throw new Error("Bitte erneut anmelden.");
    const today = new Date().toISOString().slice(0, 10);
    const entryRef = doc(collection(db, "entries"));
    const logRef = doc(db, "logs", entryRef.id);
    const limitRef = doc(db, "limits", `${currentUser.uid}_${today}`);
    const limitSnap = await getDoc(limitRef);
    const used = limitSnap.exists() ? Number(limitSnap.data().count || 0) : 0;
    if (used >= 100)
      throw new Error(
        "Das vorübergehende Limit von 100 Einträgen pro Tag ist erreicht.",
      );
    const batch = writeBatch(db);
    batch.set(entryRef, {
      name: payload.name,
      pixels: payload.pixels,
      x,
      y,
      createdAt: serverTimestamp(),
    });
    batch.set(logRef, {
      entryId: entryRef.id,
      limitId: limitRef.id,
      uid: currentUser.uid,
      email: currentUser.email || "",
      accountName: currentUser.displayName || "",
      artistName: payload.name,
      x,
      y,
      createdAt: serverTimestamp(),
    });
    batch.set(limitRef, {
      uid: currentUser.uid,
      count: used + 1,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    render({
      ...payload,
      id: entryRef.id,
      created_at: new Date().toISOString(),
    });
    notify("Eintrag veröffentlicht. Danke!");
  } catch (err) {
    notify(err.message || "Speichern fehlgeschlagen.");
  }
});
function render(entry) {
  empty.hidden = true;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  c.className = "entry";
  c.style.left = `${entry.x}px`;
  c.style.top = `${entry.y}px`;
  const d = new Date(entry.created_at).toLocaleString("de-DE");
  c.dataset.label = `${entry.name} · ${d}`;
  const cx = c.getContext("2d");
  JSON.parse(entry.pixels).forEach((v, i) => {
    if (v) {
      cx.fillStyle = v;
      cx.fillRect(i % 64, Math.floor(i / 64), 1, 1);
    }
  });
  wall.append(c);
}
function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}
async function load() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "entries"),
        orderBy("createdAt", "asc"),
        limit(1000),
      ),
    );
    snapshot.forEach((item) => {
      const data = item.data();
      render({
        id: item.id,
        ...data,
        created_at:
          data.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
      });
    });
    fitWall();
    viewport.scrollTo(0, 0);
  } catch {
    notify("Einträge konnten nicht geladen werden.");
  }
}
load();
