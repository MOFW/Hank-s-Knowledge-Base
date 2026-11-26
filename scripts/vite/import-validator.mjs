import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standalone from "ajv/dist/standalone/index.js";

const moduleId = "virtual:question-import-validators";
const schemas = ["question-import-v1", "question-import-v1.1", "learning-import-v1.2"].map((name) =>
  new URL(`../../contracts/${name}.schema.json`, import.meta.url));

export function importValidator() {
  return {
    name: "hkb-import-validator",
    resolveId(id) {
      if (id === moduleId) return "\0" + id;
    },
    load(id) {
      if (id !== "\0" + moduleId) return;
      const ajv = addFormats(new Ajv2020({ strictRequired: false, code: { source: true, esm: true } }));
      for (const path of schemas) {
        this.addWatchFile(fileURLToPath(path));
        ajv.addSchema(JSON.parse(readFileSync(path, "utf8")));
      }
      // Compile in Node at build time. The Worker only executes the resulting validation functions.
      const code = standalone(ajv, {
        validateV1: "urn:hkb:question-import:1.0",
        validateV11: "urn:hkb:question-import:1.1",
        validateV12: "urn:hkb:learning-import:1.2",
      }).replaceAll('require("ajv/dist/runtime/ucs2length").default', "ucs2length")
        .replaceAll('require("ajv/dist/runtime/equal").default', "equal")
        .replaceAll('require("ajv-formats/dist/formats").fullFormats', "fullFormats");
      if (code.includes("require(")) throw new Error("Unexpected CommonJS dependency in the import validators.");
      return `import ucs2lengthModule from "ajv/dist/runtime/ucs2length.js";
import equalModule from "ajv/dist/runtime/equal.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
// Development and bundled Worker builds wrap the CommonJS default differently.
const ucs2length = typeof ucs2lengthModule === "function" ? ucs2lengthModule : ucs2lengthModule.default;
const equal = typeof equalModule === "function" ? equalModule : equalModule.default;
${code}`;
    },
  };
}
