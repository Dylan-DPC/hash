/** @todo - This code shares a lot of similarities with the `status` package's codegen. These should be consolidated. */

import { glob } from "glob";
import * as path from "node:path";
import { argv } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";

import execa from "execa";
import yargs from "yargs";

const postProcess = async (files: string[]) => {
  const names = files.map((filePath) => {
    const parsedPath = path.parse(filePath);
    // Capitalize first letter
    let name = parsedPath.dir.split(path.sep).pop()!;
    name = name.charAt(0).toUpperCase() + name.slice(1);

    // Remove extension from path for relative import
    const importPath = `${parsedPath.dir}/${parsedPath.name}`;

    return {
      importMapping: { Input: `${name}Input`, Output: `${name}Output` },
      name,
      importPath,
    };
  });

  const outputMapping = (
    objectMapping: Record<string, string>,
    delimiter: string,
  ) =>
    Object.entries(objectMapping)
      .map(([name, alias]) => `${name}${delimiter}${alias}`)
      .join(", ");

  const importLines = names.map(
    ({ importMapping, importPath }) =>
      `import {${outputMapping(
        importMapping,
        " as ",
      )}} from "../${importPath}";`,
  );

  const aliasedExports = Object.fromEntries(
    names.map(({ name, importMapping }) => [
      name,
      `{ ${outputMapping(importMapping, ": ")} }`,
    ]),
  );

  const typeReexport = `export type AgentTypes = { ${outputMapping(
    aliasedExports,
    ": ",
  )} }`;

  const result = importLines + "\n\n" + typeReexport;

  await mkdir("./src/", { recursive: true });
  await writeFile("./src/types.ts", result);
};

/**
 *  @todo - Consider using `quicktype-core` and orchestrating ourselves from TS instead of calling
 *    the CLI (https://blog.quicktype.io/customizing-quicktype/)
 */
const codegen = async ({ globPattern }: { globPattern: string }) => {
  const files = await glob(globPattern);
  for (const filePath of files) {
    const fileName = path.parse(filePath).name;
    const fileExtension = path.extname(filePath);

    if (fileExtension === ".ts") {
      const outputPath = path.join(path.dirname(filePath), `${fileName}.py`);
      await execa("quicktype", [
        "--lang",
        "py",
        "--src",
        filePath,
        "-o",
        outputPath,
      ]);
    } else {
      throw new Error(`Unsupported quicktype input format: ${fileExtension}`);
    }
  }

  await postProcess(files);
};

void (async () => {
  const args = yargs(argv.slice(2))
    .usage("Usage: $0 <glob>")
    .positional("glob", {
      describe: "Glob pointing to the files where TypeScript types are defined",
      type: "string",
      normalize: true,
    })
    .demandCommand(1)
    .help("h")
    .alias("h", "help")
    .parseSync();

  const [entryPointDir] = args._;

  console.log("Running codegen");
  await codegen({
    globPattern: entryPointDir as string,
  });
})();
