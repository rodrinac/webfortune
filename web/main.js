import "./style.css";
import { cowsay } from "./cowsay.js";

const api = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const cow = $("cow");
const stage = $("fortune-stage");
const category = $("category");
const refresh = $("refresh");
const copy = $("copy");
let fortune = "";
let displayed = "Give me a moment. I’m chewing on a thought.";
let busy = false;
let copyTimer;

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
  clearTimeout(copyTimer);
  $("copy-label").textContent = "Copy";
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
