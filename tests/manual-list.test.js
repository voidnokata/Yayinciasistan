const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/ui/manual-list.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);

const parsed = context.window.BTGManualListParser.parse(
  "resool0728\u200b\nmiar_mobel\u2060\n@miranalan21\nRESOOL0728\n\ngeçersiz isim"
);

assert.deepEqual(Array.from(parsed.valid), ["resool0728", "miar_mobel", "miranalan21"]);
assert.deepEqual(Array.from(parsed.invalid), ["geçersiz isim"]);

console.log("Alt alta liste, görünmez karakter temizliği ve tekilleştirme testi geçti.");
