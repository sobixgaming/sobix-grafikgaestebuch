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
} from "./firebase.js?v=11";

const ART_SIZE = 128;
const ART_PIXELS = ART_SIZE * ART_SIZE;
const MAX_X = 1920 - ART_SIZE;
const MAX_Y = 1080 - ART_SIZE;
const WALL_TIME_ZONE = "Europe/Berlin";

function berlinParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: WALL_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function berlinMidnightUtc(year, month) {
  const guess = new Date(Date.UTC(year, month - 1, 1));
  const zone = berlinParts(guess).timeZoneName;
  const match = zone.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offset = match
    ? (match[1] === "+" ? 1 : -1) *
      (Number(match[2]) * 60 + Number(match[3])) *
      60000
    : 0;
  return Date.UTC(year, month - 1, 1) - offset;
}

function updateWallClock() {
  const now = new Date();
  const parts = berlinParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const beforeMonthlyReset = Number(parts.day) === 1 && Number(parts.hour) === 0 && Number(parts.minute) < 7;
  let wallYear = year;
  let wallMonth = month;
  if (beforeMonthlyReset) {
    wallMonth -= 1;
    if (wallMonth === 0) {
      wallMonth = 12;
      wallYear -= 1;
    }
  }
  const nextMonth = beforeMonthlyReset ? month : month === 12 ? 1 : month + 1;
  const nextYear = beforeMonthlyReset ? year : month === 12 ? year + 1 : year;
  const resetAt = berlinMidnightUtc(nextYear, nextMonth) + 7 * 60000;
  const remainingMinutes = Math.max(0, Math.ceil((resetAt - now.getTime()) / 60000));
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  document.querySelector("#currentMonth").textContent = new Intl.DateTimeFormat(
    "de-DE",
    { month: "long", year: "numeric", timeZone: WALL_TIME_ZONE },
  ).format(new Date(Date.UTC(wallYear, wallMonth - 1, 15)));
  document.querySelector("#resetDate").textContent = new Intl.DateTimeFormat(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: WALL_TIME_ZONE,
    },
  ).format(new Date(resetAt));
  document.querySelector("#countdown").textContent = `${days} T · ${hours} Std · ${minutes} Min`;
}

updateWallClock();
setInterval(updateWallClock, 30000);

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
  brushSizeInput = document.querySelector("#brushSize"),
  brushValue = document.querySelector("#brushValue"),
  nameInput = document.querySelector("#name"),
  placing = document.querySelector("#placing"),
  toast = document.querySelector("#toast");
let currentUser = null;
let pixels = Array(ART_PIXELS).fill(""),
  tool = "pen",
  brushSize = 1,
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
  ctx.clearRect(0, 0, ART_SIZE, ART_SIZE);
  pixels.forEach((c, i) => {
    if (c) {
      ctx.fillStyle = c;
      ctx.fillRect(i % ART_SIZE, Math.floor(i / ART_SIZE), 1, 1);
    }
  });
}
function point(e) {
  const r = canvas.getBoundingClientRect();
  return [
    Math.max(
      0,
      Math.min(
        ART_SIZE - 1,
        Math.floor(((e.clientX - r.left) * ART_SIZE) / r.width),
      ),
    ),
    Math.max(
      0,
      Math.min(
        ART_SIZE - 1,
        Math.floor(((e.clientY - r.top) * ART_SIZE) / r.height),
      ),
    ),
  ];
}
function flood(x, y, replacement) {
  const target = pixels[y * ART_SIZE + x];
  if (target === replacement) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [a, b] = stack.pop(),
      i = b * ART_SIZE + a;
    if (
      a < 0 ||
      a >= ART_SIZE ||
      b < 0 ||
      b >= ART_SIZE ||
      pixels[i] !== target
    )
      continue;
    pixels[i] = replacement;
    stack.push([a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]);
  }
}
function paint(e) {
  const [x, y] = point(e);
  if (tool === "fill") flood(x, y, color.value);
  else {
    const replacement = tool === "eraser" ? "" : color.value;
    const start = -Math.floor((brushSize - 1) / 2);
    for (let dy = start; dy < start + brushSize; dy++) {
      for (let dx = start; dx < start + brushSize; dx++) {
        const px = x + dx,
          py = y + dy;
        if (px >= 0 && px < ART_SIZE && py >= 0 && py < ART_SIZE)
          pixels[py * ART_SIZE + px] = replacement;
      }
    }
  }
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
brushSizeInput.addEventListener("input", () => {
  brushSize = Number(brushSizeInput.value);
  brushValue.value = `${brushSize} px`;
});
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  document.querySelector("#userStatus").textContent = user
    ? `Angemeldet als: ${user.displayName || user.email}`
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
  pixels = Array(ART_PIXELS).fill("");
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
  preview.width = preview.height = ART_SIZE;
  preview.className = "placement-preview";
  preview.style.width = `${ART_SIZE}px`;
  preview.style.height = `${ART_SIZE}px`;
  const pc = preview.getContext("2d");
  pixels.forEach((v, i) => {
    if (v) {
      pc.fillStyle = v;
      pc.fillRect(i % ART_SIZE, Math.floor(i / ART_SIZE), 1, 1);
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
        MAX_X,
        Math.round(((e.clientX - r.left) * 1920) / r.width / 8) * 8,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        MAX_Y,
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
  const wrapper = document.createElement("div");
  const c = document.createElement("canvas");
  const values = JSON.parse(entry.pixels);
  const size = Math.round(Math.sqrt(values.length));
  c.width = c.height = size;
  wrapper.className = "entry";
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  wrapper.style.left = `${entry.x}px`;
  wrapper.style.top = `${entry.y}px`;
  const d = new Date(entry.created_at).toLocaleString("de-DE");
  wrapper.dataset.label = entry.name;
  wrapper.title = `${entry.name} · ${d}`;
  const cx = c.getContext("2d");
  values.forEach((v, i) => {
    if (v) {
      cx.fillStyle = v;
      cx.fillRect(i % size, Math.floor(i / size), 1, 1);
    }
  });
  wrapper.append(c);
  wall.append(wrapper);
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
