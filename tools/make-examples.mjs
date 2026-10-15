#!/usr/bin/env node
// Regenerates the shipped example themes from the same code path the UI uses.
//   node tools/make-examples.mjs
// writes examples/glass.json (V2 native) and examples/glass-v1.json (legacy flat, for older opencode).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTheme, designToCss, resolveTheme, validateTheme } from "../lib/schema.mjs";
import { interpretPrompt } from "../lib/designer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const prompt = "nord blue frosted glass, rounded corners, jetbrains mono";

const { design, ui } = interpretPrompt(prompt);
design.transparency = { dark: 45, light: 22 };
const theme = buildTheme(design);
const validation = validateTheme(theme);
if (!validation.ok) {
  console.error("refusing to write an invalid theme:", validation.errors);
  process.exit(1);
}

const v1Paths = {
  primary: "text.action.primary.base", secondary: "text.action.secondary.base", accent: "markdown.heading",
  error: "text.feedback.error.base", warning: "text.feedback.warning.base", success: "text.feedback.success.base", info: "text.feedback.info.base",
  text: "text.base", textMuted: "text.muted", selectedListItemText: "text.base",
  background: "background.base", backgroundPanel: "background.raised.base", backgroundElement: "background.raised.high", backgroundMenu: "background.raised.max",
  border: "border.base", borderActive: "border.base", borderSubtle: "border.base",
  diffAdded: "diff.text.added", diffRemoved: "diff.text.removed", diffContext: "diff.text.context", diffHunkHeader: "diff.text.hunkHeader",
  diffHighlightAdded: "diff.highlight.added", diffHighlightRemoved: "diff.highlight.removed",
  diffAddedBg: "diff.background.added", diffRemovedBg: "diff.background.removed", diffContextBg: "diff.background.context",
  diffLineNumber: "diff.lineNumber.text", diffAddedLineNumberBg: "diff.lineNumber.background.added", diffRemovedLineNumberBg: "diff.lineNumber.background.removed",
  markdownText: "markdown.text", markdownHeading: "markdown.heading", markdownLink: "markdown.link", markdownLinkText: "markdown.linkText",
  markdownCode: "markdown.code", markdownBlockQuote: "markdown.blockQuote", markdownEmph: "markdown.emphasis", markdownStrong: "markdown.strong",
  markdownHorizontalRule: "markdown.horizontalRule", markdownListItem: "markdown.listItem", markdownListEnumeration: "markdown.listEnumeration",
  markdownImage: "markdown.image", markdownImageText: "markdown.imageText", markdownCodeBlock: "markdown.codeBlock",
  syntaxComment: "syntax.comment", syntaxKeyword: "syntax.keyword", syntaxFunction: "syntax.function", syntaxVariable: "syntax.variable",
  syntaxString: "syntax.string", syntaxNumber: "syntax.number", syntaxType: "syntax.type", syntaxOperator: "syntax.operator", syntaxPunctuation: "syntax.punctuation",
};

const resolved = { dark: resolveTheme(theme, "dark"), light: resolveTheme(theme, "light") };
const legacy = { $schema: "https://opencode.ai/theme.json", theme: {} };
for (const [token, tokenPath] of Object.entries(v1Paths)) {
  legacy.theme[token] = {
    dark: resolved.dark[tokenPath] ?? resolved.dark["text.base"],
    light: resolved.light[tokenPath] ?? resolved.light["text.base"],
  };
}

const write = (file, data) => {
  fs.writeFileSync(path.join(repo, "examples", file), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`wrote examples/${file}`);
};

write("glass.json", theme);
write("glass-v1.json", legacy);
fs.writeFileSync(path.join(repo, "examples", "preview.css"), designToCss({ ...ui, customCss: "" }, resolved.dark) + "\n", "utf8");
console.log("wrote examples/preview.css");
