const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");

const sourcePath = path.join(__dirname, "..", "finance-manager_2.jsx");
const source = fs.readFileSync(sourcePath, "utf8");
parse(source, { sourceType: "module", plugins: ["jsx"] });
assert.match(source, /from ["']\.\/project-core\.mjs["']/);
assert.match(source, /fm_projects/);
console.log("React source JSX syntax and shared project calculations passed.");
