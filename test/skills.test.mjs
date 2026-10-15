import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The two skill sets the user asked for. opencode scans ~/.agents/skills; the user archives
// niche skills into ~/.agents/skills-archive-<date> and restores them with Move-Item, so an
// archived copy still counts as installed (the test reports which root it found).
const skills = [
  "reverse-engineer-anything",
  "rea-tool-design",
  "rea-ci-tests-audit",
  "rea-changelog-update",
  "gpt-image-2",
  "beautiful-article",
  "kb-retriever",
  "motion-showreel",
  "web-design-engineer",
  "web-video-presentation",
];

function skillsRoots() {
  const base = path.join(os.homedir(), ".agents");
  const roots = [path.join(base, "skills")];
  if (fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base)) {
      if (entry.startsWith("skills-archive")) roots.push(path.join(base, entry));
    }
  }
  return roots;
}

for (const name of skills) {
  test(`${name}/SKILL.md is installed (active or archived)`, () => {
    const roots = skillsRoots();
    const hits = roots.map((root) => path.join(root, name, "SKILL.md")).filter((file) => fs.existsSync(file));
    assert.ok(hits.length > 0, `missing ${name}/SKILL.md in any of: ${roots.join(", ")}`);
    for (const hit of hits) {
      const stat = fs.statSync(hit);
      assert.ok(stat.isFile() && stat.size > 0, `empty or not a file: ${hit}`);
    }
  });
}
