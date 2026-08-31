// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 peyote
import {build} from "esbuild";
import {mkdir} from "node:fs/promises";
import {spawn} from "node:child_process";
await mkdir(".artifacts",{recursive:true});
for(const name of ['core','filesystem']) {
  await build({entryPoints:[`test/${name}.test.ts`],outfile:`.artifacts/${name}.test.cjs`,bundle:true,platform:"node",format:"cjs",target:"node20"});
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,["--test",`.artifacts/${name}.test.cjs`],{stdio:"inherit"});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error("Plugin tests failed")));});
}
