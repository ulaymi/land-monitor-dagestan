import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryName = "land-monitor-dagestan";
const chunksDirectory = resolve("out", "_next", "static", "chunks");
const cssFiles = (await readdir(chunksDirectory)).filter((file) =>
  file.endsWith(".css"),
);

for (const file of cssFiles) {
  const path = join(chunksDirectory, file);
  const css = await readFile(path, "utf8");
  await writeFile(
    path,
    css.replaceAll("url(/fonts/", `url(/${repositoryName}/fonts/`),
  );
}

console.log(`GitHub Pages paths updated in ${cssFiles.length} CSS file(s).`);
