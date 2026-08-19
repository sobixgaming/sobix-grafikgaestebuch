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
const demoMode = location.hostname.endsWith("github.io");
let pixels = Array(4096).fill(""),
  tool = "pen",
  drawing = false,
  pending = null,
  preview = null;
ctx.imageSmoothingEnabled = false;
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
document.querySelector("#add").onclick = () => {
  pixels = Array(4096).fill("");
  draw();
  nameInput.value = localStorage.getItem("guestName") || "";
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
document.querySelector("#clear").onclick = () => {
  pixels.fill("");
  draw();
};
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
wall.addEventListener("pointermove", (e) => {
  if (!preview) return;
  const r = wall.getBoundingClientRect();
  preview.style.left = `${Math.max(0, Math.min(1856, Math.round((e.clientX - r.left) / 8) * 8))}px`;
  preview.style.top = `${Math.max(0, Math.min(1016, Math.round((e.clientY - r.top) / 8) * 8))}px`;
});
wall.addEventListener("click", async (e) => {
  if (!pending) return;
  const r = wall.getBoundingClientRect(),
    x = Math.max(0, Math.min(1856, Math.round((e.clientX - r.left) / 8) * 8)),
    y = Math.max(0, Math.min(1016, Math.round((e.clientY - r.top) / 8) * 8));
  const payload = { ...pending, x, y };
  stopPlace();
  try {
    if (demoMode) {
      const today = new Date().toISOString().slice(0, 10);
      const daily = JSON.parse(localStorage.getItem("guestDailyCount") || "{}");
      const usedToday = Number(daily[today] || 0);
      if (usedToday >= 100)
        throw new Error("Das vorübergehende Limit von 100 Einträgen pro Tag ist erreicht.");
      const entry = {
        ...payload,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      const saved = JSON.parse(localStorage.getItem("demoEntries") || "[]");
      saved.push(entry);
      localStorage.setItem("demoEntries", JSON.stringify(saved));
      daily[today] = usedToday + 1;
      localStorage.setItem("guestDailyCount", JSON.stringify(daily));
      render(entry);
      notify("Demo-Eintrag in diesem Browser gespeichert.");
      return;
    }
    const res = await fetch("api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await res.json();
    if (!res.ok) throw new Error(data.error);
    render(data.entry);
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
    if (demoMode) {
      JSON.parse(localStorage.getItem("demoEntries") || "[]")
        .filter((e) => e.x <= 1856 && e.y <= 1016)
        .forEach(render);
      notify("Demomodus: Einträge bleiben nur in diesem Browser.");
    } else {
      const r = await fetch("api/entries"),
        d = await r.json();
      d.entries.forEach(render);
    }
    viewport.scrollTo(0, 0);
  } catch {
    notify("Einträge konnten nicht geladen werden.");
  }
}
load();
