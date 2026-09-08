import "./style.css";
import { cowsay } from "./cowsay.js";

const api = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const cow = $("cow");
const stage = $("fortune-stage");
const locale = $("locale");
const category = $("category");
const refresh = $("refresh");
const copy = $("copy");
const screenshot = $("screenshot");
let fortune = "";
let displayed = "Give me a moment. I'm chewing on a thought.";
let busy = false;
let copyTimer;
let screenshotTimer;

const translations = {
  en: {
    name: "English",
    title: "webfortune — wisdom, with a moo",
    source: "View source",
    eyebrow: "SMALL WORDS. BIG PASTURE.",
    headlineFirst: "A little wisdom.",
    headlineSecond: "A lot of",
    moo: "moo.",
    descriptionFirst: "A pocket-sized pause in your day.",
    descriptionSecond: "Let the cow do the talking.",
    terminal: "Fortune terminal",
    pasture: "~ / pasture",
    statusWaking: "Waking up the cow…",
    statusChewing: "Chewing on a thought…",
    statusFresh: "Fresh from the pasture",
    statusLast: "Keeping your last fortune",
    statusAway: "The pasture is out of reach",
    language: "Language",
    category: "A little about",
    everything: "Everything",
    copy: "Copy",
    copied: "Copied!",
    copyScreenshot: "Copy screenshot",
    downloaded: "Downloaded",
    refresh: "Another fortune",
    hintFirst: "Good things come to those who",
    hintSecond: "Press",
    hintThird: "for another.",
    footer: "A small corner of the internet, just for you.",
    encoding: "UTF-8 · 100% grass-fed",
    timeout: "The cow is taking its time. Please try again.",
    busy: "The pasture is busy. Give it a moment and try again.",
    unreachable: "The cow couldn't reach the pasture. Please try again.",
    quiet: "An unusually quiet cow. Try another fortune.",
    fallback: "Even a wise cow needs a second try.",
    unavailable: "Everything (categories unavailable)",
    clipboard:
      "Clipboard unavailable. You can select and copy the fortune directly.",
  },
  de: {
    name: "Deutsch",
    title: "webfortune — Weisheit mit Muh",
    source: "Quellcode ansehen",
    eyebrow: "KLEINE WORTE. GROSSE WEIDE.",
    headlineFirst: "Ein wenig Weisheit.",
    headlineSecond: "Eine Menge",
    moo: "Muh.",
    descriptionFirst: "Eine kleine Pause für deinen Tag.",
    descriptionSecond: "Lass die Kuh reden.",
    terminal: "Weisheits-Terminal",
    pasture: "~ / weide",
    statusWaking: "Die Kuh wacht auf…",
    statusChewing: "Denkt nach…",
    statusFresh: "Frisch von der Weide",
    statusLast: "Die letzte Weisheit bleibt",
    statusAway: "Die Weide ist nicht erreichbar",
    language: "Sprache",
    category: "Ein wenig über",
    everything: "Alles",
    copy: "Kopieren",
    copied: "Kopiert!",
    copyScreenshot: "Screenshot kopieren",
    downloaded: "Heruntergeladen",
    refresh: "Neue Weisheit",
    hintFirst: "Gute Dinge kommen zu denen, die",
    hintSecond: "Drücke",
    hintThird: "für eine neue.",
    footer: "Eine kleine Ecke des Internets, nur für dich.",
    encoding: "UTF-8 · 100% grasgefüttert",
    timeout: "Die Kuh lässt sich Zeit. Bitte versuche es erneut.",
    busy: "Die Weide ist voll. Versuch es gleich noch einmal.",
    unreachable: "Die Kuh erreicht die Weide nicht. Bitte versuche es erneut.",
    quiet: "Eine ungewöhnlich stille Kuh. Versuch eine andere Weisheit.",
    fallback: "Auch eine weise Kuh braucht manchmal einen zweiten Versuch.",
    unavailable: "Alles (Kategorien nicht verfügbar)",
    clipboard: "Zwischenablage nicht verfügbar. Kopiere den Text direkt.",
  },
  es: {
    name: "Español",
    title: "webfortune — sabiduría con muu",
    source: "Ver código fuente",
    eyebrow: "PALABRAS PEQUEÑAS. PRADERA ENORME.",
    headlineFirst: "Un poco de sabiduría.",
    headlineSecond: "Mucho",
    moo: "muu.",
    descriptionFirst: "Una pequeña pausa para tu día.",
    descriptionSecond: "Deja que hable la vaca.",
    terminal: "Terminal de fortuna",
    pasture: "~ / pradera",
    statusWaking: "Despertando a la vaca…",
    statusChewing: "Pensando un poco…",
    statusFresh: "Recién salida de la pradera",
    statusLast: "Conservando tu fortuna anterior",
    statusAway: "La pradera no responde",
    language: "Idioma",
    category: "Un poco sobre",
    everything: "Todo",
    copy: "Copiar",
    copied: "¡Copiado!",
    copyScreenshot: "Copiar captura",
    downloaded: "Descargada",
    refresh: "Otra fortuna",
    hintFirst: "Las cosas buenas llegan a quienes",
    hintSecond: "Pulsa",
    hintThird: "para otra.",
    footer: "Un pequeño rincón de internet, solo para ti.",
    encoding: "UTF-8 · 100% alimentada con pasto",
    timeout: "La vaca se está tomando su tiempo. Inténtalo de nuevo.",
    busy: "La pradera está ocupada. Inténtalo en un momento.",
    unreachable: "La vaca no pudo llegar a la pradera. Inténtalo de nuevo.",
    quiet: "Una vaca inusualmente silenciosa. Prueba otra fortuna.",
    fallback: "Hasta una vaca sabia necesita un segundo intento.",
    unavailable: "Todo (categorías no disponibles)",
    clipboard: "Portapapeles no disponible. Copia la fortuna directamente.",
  },
  pt: {
    name: "Português",
    title: "webfortune — sabedoria com muu",
    source: "Ver código-fonte",
    eyebrow: "PALAVRAS PEQUENAS. PASTO IMENSO.",
    headlineFirst: "Um pouco de sabedoria.",
    headlineSecond: "Muito",
    moo: "muu.",
    descriptionFirst: "Uma pequena pausa no seu dia.",
    descriptionSecond: "Deixe a vaca falar.",
    terminal: "Terminal da fortuna",
    pasture: "~ / pasto",
    statusWaking: "Acordando a vaca…",
    statusChewing: "Matutando uma ideia…",
    statusFresh: "Fresca do pasto",
    statusLast: "Mantendo sua fortuna anterior",
    statusAway: "O pasto está fora do alcance",
    language: "Idioma",
    category: "Um pouco sobre",
    everything: "Tudo",
    copy: "Copiar",
    copied: "Copiado!",
    copyScreenshot: "Copiar captura",
    downloaded: "Baixada",
    refresh: "Outra fortuna",
    hintFirst: "Coisas boas chegam para quem",
    hintSecond: "Pressione",
    hintThird: "para outra.",
    footer: "Um pequeno canto da internet, só para você.",
    encoding: "UTF-8 · 100% alimentada com capim",
    timeout: "A vaca está demorando. Tente novamente.",
    busy: "O pasto está ocupado. Tente novamente em instantes.",
    unreachable: "A vaca não conseguiu chegar ao pasto. Tente novamente.",
    quiet: "Uma vaca silenciosa demais. Tente outra fortuna.",
    fallback: "Até uma vaca sábia precisa de uma segunda tentativa.",
    unavailable: "Tudo (categorias indisponíveis)",
    clipboard:
      "Área de transferência indisponível. Copie a fortuna diretamente.",
  },
};

let currentLocale = detectLocale();

function detectLocale() {
  const language = (navigator.language || "en").slice(0, 2).toLowerCase();
  return translations[language] ? language : "en";
}

function strings() {
  return translations[currentLocale];
}

function setText(id, text) {
  $(id).textContent = text;
}

function applyLocale() {
  const text = strings();
  document.documentElement.lang = currentLocale;
  document.title = text.title;
  setText("source-label", text.source);
  setText("eyebrow", text.eyebrow);
  setText("headline-first", text.headlineFirst);
  setText("headline-second-prefix", text.headlineSecond);
  setText("headline-moo", text.moo);
  setText("description-first", text.descriptionFirst);
  setText("description-second", text.descriptionSecond);
  $("terminal").setAttribute("aria-label", text.terminal);
  setText("terminal-label", text.pasture);
  setText("locale-label", text.language);
  setText("category-label", text.category);
  setText("copy-label", text.copy);
  setText("screenshot-label", text.copyScreenshot);
  setText("refresh-label", text.refresh);
  setText("hint-first", text.hintFirst);
  setText("hint-second", text.hintSecond);
  setText("hint-third", text.hintThird);
  setText("footer-label", text.footer);
  setText("encoding", text.encoding);
}

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
    if (response.status === 429) throw new Error(strings().busy);
    throw new Error(strings().unreachable);
  }
  return response;
}

async function loadFortune() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  locale.disabled = true;
  category.disabled = true;
  copy.disabled = true;
  screenshot.disabled = true;
  clearTimeout(copyTimer);
  clearTimeout(screenshotTimer);
  $("copy-label").textContent = strings().copy;
  $("screenshot-label").textContent = strings().copyScreenshot;
  stage.setAttribute("aria-busy", "true");
  $("error").hidden = true;
  $("status").textContent = strings().statusChewing;
  $("command").textContent =
    `fortune${category.value ? ` ${category.value}` : ""} | cowsay`;
  const params = new URLSearchParams({ locale: currentLocale });
  if (category.value) params.set("category", category.value);
  try {
    const response = await request(`/?${params}`);
    const text = (await response.text()).trim();
    if (!text) throw new Error(strings().quiet);
    fortune = displayed = text;
    $("fortune-text").textContent = fortune;
    $("status").textContent = strings().statusFresh;
    renderCow();
  } catch (error) {
    $("error").textContent =
      error.name === "TimeoutError" ? strings().timeout : error.message;
    $("error").hidden = false;
    $("status").textContent = fortune
      ? strings().statusLast
      : strings().statusAway;
    if (!fortune) {
      displayed = strings().fallback;
      renderCow();
    }
  } finally {
    busy = false;
    refresh.disabled = false;
    locale.disabled = false;
    category.disabled = category.options.length < 2;
    copy.disabled = !fortune;
    screenshot.disabled = !fortune;
    stage.setAttribute("aria-busy", "false");
  }
}

async function loadCategories() {
  category.replaceChildren();
  try {
    const categories = await (
      await request(`/categories?locale=${currentLocale}`)
    ).json();
    if (
      !Array.isArray(categories) ||
      !categories.every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9_.-]+$/.test(value),
      )
    )
      throw new Error("Invalid categories");
    category.add(new Option(strings().everything, ""));
    for (const value of [...new Set(categories)].sort())
      category.add(new Option(value.replace(/[._-]/g, " "), value));
    category.disabled = busy || category.options.length < 2;
  } catch {
    // Random fortunes remain usable if only the category endpoint is unavailable.
    category.replaceChildren(new Option(strings().unavailable, ""));
  }
}

async function loadLocales() {
  try {
    const available = await (await request("/locales")).json();
    if (
      !Array.isArray(available) ||
      !available.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          translations[item.id],
      )
    )
      throw new Error("Invalid locales");
    locale.replaceChildren(
      ...available.map((item) => new Option(item.name, item.id)),
    );
  } catch {
    locale.replaceChildren(
      ...Object.entries(translations).map(
        ([id, text]) => new Option(text.name, id),
      ),
    );
  }
  if (!translations[currentLocale]) currentLocale = "en";
  locale.value = currentLocale;
  applyLocale();
}

refresh.addEventListener("click", loadFortune);
category.addEventListener("change", loadFortune);
locale.addEventListener("change", async () => {
  currentLocale = locale.value;
  applyLocale();
  await loadCategories();
  await loadFortune();
});
copy.addEventListener("click", async () => {
  try {
    const websiteUrl = window.location.href.split(/[?#]/, 1)[0];
    await navigator.clipboard.writeText(`${fortune}\n\n${websiteUrl}`);
    $("copy-label").textContent = strings().copied;
    copyTimer = setTimeout(() => {
      $("copy-label").textContent = strings().copy;
    }, 2000);
  } catch {
    $("error").textContent = strings().clipboard;
    $("error").hidden = false;
  }
});
screenshot.addEventListener("click", async () => {
  await document.fonts.ready;
  const lines = cowsay(fortune || displayed, 48).split("\n");
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const size = 900;
  const margin = 28;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = "#1e1e2e";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#cba6f7";
  context.font = "600 18px 'DM Sans', sans-serif";
  context.fillText("webfortune.", 68, 70);
  context.fillStyle = "#a6adc8";
  context.font = "13px 'JetBrains Mono', monospace";
  context.fillText("fortune | cowsay", 68, 110);
  context.fillStyle = "#181825";
  context.strokeStyle = "#45475a";
  context.lineWidth = 1;
  context.beginPath();
  const cardTop = 132;
  const cardBottom = size - 28;
  context.roundRect(
    margin,
    cardTop,
    size - margin * 2,
    cardBottom - cardTop,
    16,
  );
  context.fill();
  context.stroke();
  context.fillStyle = "#cba6f7";
  const longestLine = Math.max(...lines.map((line) => Array.from(line).length));
  const cowFontSize = Math.max(
    17,
    Math.min(23, (size - 120) / (longestLine * 0.61)),
  );
  const lineHeight = Math.ceil(cowFontSize * 1.4);
  context.font = `400 ${cowFontSize}px 'JetBrains Mono', monospace`;
  const contentHeight = lines.length * lineHeight;
  const contentTop = cardTop + 42;
  const contentBottom = cardBottom - 82;
  const startY =
    contentTop + Math.max(0, (contentBottom - contentTop - contentHeight) / 2);
  lines.forEach((line, index) =>
    context.fillText(line, 60, startY + index * lineHeight),
  );
  context.fillStyle = "#6c7086";
  context.font = "11px 'JetBrains Mono', monospace";
  context.fillText(strings().statusFresh, 60, cardBottom - 28);
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem)
        throw new Error("Image clipboard is unavailable");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      $("screenshot-label").textContent = strings().copied;
    } catch {
      const link = document.createElement("a");
      link.download = `webfortune-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      $("screenshot-label").textContent = strings().downloaded;
    }
    screenshotTimer = setTimeout(() => {
      $("screenshot-label").textContent = strings().copyScreenshot;
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
async function initialize() {
  await loadLocales();
  await loadCategories();
  await loadFortune();
}

initialize();
