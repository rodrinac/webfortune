import "./style.css";
import { cowsay } from "./cowsay.js";

const api = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const cow = $("cow");
const stage = $("fortune-stage");
const category = $("category");
const refresh = $("refresh");
const copy = $("copy");
const screenshot = $("screenshot");
let fortune = "";
let displayed = "Give me a moment. I’m chewing on a thought.";
let busy = false;
let copyTimer;
let screenshotTimer;

function renderCow() {
  const charWidth = parseFloat(getComputedStyle(cow).fontSize) * 0.61;
  const width = Math.max(
    20,
    Math.min(52, Math.floor(stage.clientWidth / charWidth) - 5),
  );
  cow.textContent = cowsay(displayed, width);
}
new ResizeObserver(renderCow).observe(stage);
renderCow();

async function request(path) {
  const response = await fetch(`${api}${path}`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("The pasture is busy. Give it a moment and try again.");
    throw new Error("The cow couldn’t reach the pasture. Please try again.");
  }
  return response;
}

async function loadFortune() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  category.disabled = true;
  copy.disabled = true;
  screenshot.disabled = true;
  clearTimeout(copyTimer);
  clearTimeout(screenshotTimer);
  $("copy-label").textContent = "Copy";
  $("screenshot-label").textContent = "Copy screenshot";
  stage.setAttribute("aria-busy", "true");
  $("error").hidden = true;
  $("status").textContent = "Chewing on a thought…";
  $("command").textContent =
    `fortune${category.value ? ` ${category.value}` : ""} | cowsay`;
  try {
    const response = await request(
      `/${category.value ? `?category=${encodeURIComponent(category.value)}` : ""}`,
    );
    const text = (await response.text()).trim();
    if (!text) throw new Error("An unusually quiet cow. Try another fortune.");
    fortune = displayed = text;
    $("fortune-text").textContent = fortune;
    $("status").textContent = "Fresh from the pasture";
    renderCow();
  } catch (error) {
    $("error").textContent =
      error.name === "TimeoutError"
        ? "The cow is taking its time. Please try again."
        : error.message;
    $("error").hidden = false;
    $("status").textContent = fortune
      ? "Keeping your last fortune"
      : "The pasture is out of reach";
    if (!fortune) {
      displayed = "Even a wise cow needs a second try.";
      renderCow();
    }
  } finally {
    busy = false;
    refresh.disabled = false;
    category.disabled = category.options.length < 2;
    copy.disabled = !fortune;
    screenshot.disabled = !fortune;
    stage.setAttribute("aria-busy", "false");
  }
}

async function loadCategories() {
  try {
    const categories = await (await request("/categories")).json();
    if (
      !Array.isArray(categories) ||
      !categories.every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value),
      )
    )
      throw new Error("Invalid categories");
    for (const value of [...new Set(categories)].sort())
      category.add(new Option(value.replace(/[-_]/g, " "), value));
    category.disabled = busy || category.options.length < 2;
  } catch {
    // Random fortunes remain usable if only the category endpoint is unavailable.
    category.options[0].textContent = "Everything (categories unavailable)";
  }
}

refresh.addEventListener("click", loadFortune);
category.addEventListener("change", loadFortune);
copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(cow.textContent);
    $("copy-label").textContent = "Copied!";
    copyTimer = setTimeout(() => {
      $("copy-label").textContent = "Copy";
    }, 2000);
  } catch {
    $("error").textContent =
      "Clipboard unavailable. You can select and copy the fortune directly.";
    $("error").hidden = false;
  }
});
screenshot.addEventListener("click", () => {
  const lines = cowsay(fortune || displayed, 48).split("\n");
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const width = 1200;
  const lineHeight = 27;
  const height = 230 + lines.length * lineHeight;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = "#1e1e2e";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#cba6f7";
  context.font = "600 18px 'DM Sans', sans-serif";
  context.fillText("webfortune.", 68, 70);
  context.fillStyle = "#a6adc8";
  context.font = "13px 'JetBrains Mono', monospace";
  context.fillText("fortune | cowsay", 68, 105);
  context.fillStyle = "#181825";
  context.strokeStyle = "#45475a";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(52, 132, width - 104, height - 180, 16);
  context.fill();
  context.stroke();
  context.fillStyle = "#cba6f7";
  context.font = "400 20px 'JetBrains Mono', monospace";
  lines.forEach((line, index) =>
    context.fillText(line, 92, 185 + index * lineHeight),
  );
  context.fillStyle = "#6c7086";
  context.font = "11px 'JetBrains Mono', monospace";
  context.fillText("Fresh from the pasture · UTF-8 · 100% grass-fed", 68, height - 22);
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem)
        throw new Error("Image clipboard is unavailable");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      $("screenshot-label").textContent = "Copied!";
    } catch {
      const link = document.createElement("a");
      link.download = `webfortune-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      $("screenshot-label").textContent = "Downloaded";
    }
    screenshotTimer = setTimeout(() => {
      $("screenshot-label").textContent = "Copy screenshot";
    }, 2000);
  }, "image/png");
});
document.addEventListener("keydown", (event) => {
  if (
    event.code === "Space" &&
    event.target === document.body &&
    !event.repeat
  ) {
    event.preventDefault();
    loadFortune();
  }
});
loadFortune();
loadCategories();
