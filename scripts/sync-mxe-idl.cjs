#!/usr/bin/env node
/**
 * Copies the MXE scaffold IDL into the app bundle. If the MXE hasn't been built
 * yet (arcium build not run), writes a stub so the frontend build still works
 * and detects that MPC queueing is unavailable.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(
  __dirname,
  "..",
  "mxe",
  "poi_mxe",
  "target",
  "idl",
  "poi_mxe_scaffold.json"
);
const dest = path.join(__dirname, "..", "app", "src", "mxe_idl.json");

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log(`[sync-mxe-idl] copied ${src} -> ${dest}`);
} else {
  const stub = {
    _stub: true,
    _note:
      "Placeholder. Run `arcium build` in mxe/poi_mxe then `npm run sync-idl` to populate.",
  };
  fs.writeFileSync(dest, JSON.stringify(stub, null, 2) + "\n");
  console.log(
    `[sync-mxe-idl] MXE IDL not built; wrote stub to ${dest}. ` +
      `Frontend will skip MXE queueing until a real IDL is present.`
  );
}
