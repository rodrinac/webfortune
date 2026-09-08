// Browser-native cowsay: text stays text, and the speech bubble fits the viewport.
export function wrapFortune(text, width = 44) {
  if (!Number.isInteger(width) || width < 1)
    throw new Error("Width must be a positive integer");
  const normalized = text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\t/g, "    ")
    .trim();
  return normalized.split("\n").flatMap((paragraph) => {
    if (!paragraph.trim()) return [""];
    const lines = [];
    let line = "";
    for (let word of paragraph.trim().split(/\s+/)) {
      if (line && Array.from(line + " " + word).length > width) {
        lines.push(line);
        line = "";
      }
      let chars = Array.from(word);
      while (chars.length > width) {
        lines.push(chars.slice(0, width).join(""));
        chars = chars.slice(width);
      }
      word = chars.join("");
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  });
}

export function cowsay(text, width = 44) {
  const lines = wrapFortune(text, width);
  const size = Math.max(...lines.map((line) => Array.from(line).length));
  const bubble = lines.map((line, index) => {
    const borders =
      lines.length === 1
        ? ["<", ">"]
        : index === 0
          ? ["/", "\\"]
          : index === lines.length - 1
            ? ["\\", "/"]
            : ["|", "|"];
    return `${borders[0]} ${line}${" ".repeat(size - Array.from(line).length)} ${borders[1]}`;
  });
  return [
    ` ${"_".repeat(size + 2)}`,
    ...bubble,
    ` ${"-".repeat(size + 2)}`,
    String.raw`        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||`,
  ].join("\n");
}
