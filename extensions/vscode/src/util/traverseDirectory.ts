import ignore from "ignore";
import * as path from "path";
import * as vscode from "vscode";
import { uriFromFilePath } from "./vscode";

const DEFAULT_IGNORE_FILETYPES = [
  "*.DS_Store",
  "*-lock.json",
  "*.lock",
  "*.log",
  "*.ttf",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.mp4",
  "*.svg",
  "*.ico",
  "*.pdf",
  "*.zip",
  "*.gz",
  "*.tar",
  "*.dmg",
  "*.tgz",
  "*.rar",
  "*.7z",
  "*.exe",
  "*.dll",
  "*.obj",
  "*.o",
  "*.a",
  "*.lib",
  "*.so",
  "*.dylib",
  "*.ncb",
  "*.sdf",
  "*.woff",
  "*.woff2",
  "*.eot",
  "*.cur",
  "*.avi",
  "*.mpg",
  "*.mpeg",
  "*.mov",
  "*.mp3",
  "*.mp4",
  "*.mkv",
  "*.mkv",
  "*.webm",
  "*.jar",
  "*.onnx",
];
export const defaultIgnoreFile = ignore().add(DEFAULT_IGNORE_FILETYPES);
const DEFAULT_IGNORE_DIRS = [
  ".git",
  ".vscode",
  ".idea",
  ".vs",
  "venv",
  ".venv",
  "env",
  ".env",
  "node_modules",
  "dist",
  "build",
  "target",
  "out",
  "bin",
  ".pytest_cache",
  ".vscode-test",
  ".continue",
  "__pycache__",
];
const defaultIgnoreDir = ignore().add(DEFAULT_IGNORE_DIRS);

function isIgnoreFilepath(filepath: string): boolean {
  return (
    filepath.endsWith(".gitignore") || filepath.endsWith(".continueignore")
  );
}

/**
 * Given glob pattern, returns first non-wildcard path, rest of glob, and whether there was a leading wildcard
 */
function splitGlob(glob: string): [string | undefined, string, boolean] {
  const segs = glob.split("/");
  let wildcards = 0;
  while (segs[0] === "**") {
    segs.shift();
    wildcards++;
  }
  return [segs.shift(), segs.join("/"), wildcards > 0];
}

export async function* traverseDirectory(
  directory: string,
  gitIgnorePatterns: string[],
  returnFiles: boolean = true
): AsyncGenerator<string> {
  const nodes = await vscode.workspace.fs.readDirectory(
    uriFromFilePath(directory)
  );
  const files: string[] = [];
  const dirs: string[] = [];
  const ignorePatterns: string[] = [];
  for (const [name, type] of nodes) {
    switch (type) {
      case vscode.FileType.Directory:
        if (!defaultIgnoreDir.ignores(name)) {
          dirs.push(name);
        }
        break;
      case vscode.FileType.File:
        if (!defaultIgnoreFile.ignores(name)) {
          if (isIgnoreFilepath(name)) {
            // Make sure you are respecting windows with linux dev container
            const bytes = await vscode.workspace.fs.readFile(
              uriFromFilePath(path.join(directory, name))
            );
            const contents = new TextDecoder().decode(bytes);
            ignorePatterns.push(
              ...contents.split("\n").filter((p) => p.trim() !== "")
            );
          } else {
            files.push(name);
          }
        }
        break;
      case vscode.FileType.SymbolicLink:
        break;
      case vscode.FileType.Unknown:
        break;
    }
  }

  const allIgnorePatterns = [...gitIgnorePatterns, ...ignorePatterns];
  const ig = ignore().add(allIgnorePatterns);

  for (const node of returnFiles ? files : dirs) {
    if (!ig.ignores(node)) {
      yield path.join(directory, node);
    }
  }

  const subDirIgnorePatterns: { [key: string]: string[] } = {};
  const wildcardPatterns: string[] = [];
  for (const ignorePattern of allIgnorePatterns) {
    const [first, rest, leadingWildcard] = splitGlob(ignorePattern);
    if (leadingWildcard) {
      wildcardPatterns.push("**/" + rest);
    }
    if (first) {
      if (subDirIgnorePatterns[first] === undefined) {
        subDirIgnorePatterns[first] = [];
      }
      subDirIgnorePatterns[first].push(rest);
    }
  }
  const entries = Object.entries(subDirIgnorePatterns);

  for (const dir of dirs) {
    // Recurse if not ignored
    if (!ig.ignores(dir)) {
      // For patterns who can potentially match items of this subdir, strip the subdir from the start
      const keepPatterns = [...wildcardPatterns];
      for (const [startPattern, subDirPatterns] of entries) {
        if (ignore().add(startPattern).ignores(dir)) {
          keepPatterns.push(...subDirPatterns);
        }
      }
      for await (const file of traverseDirectory(
        path.join(directory, dir),
        keepPatterns,
        returnFiles
      )) {
        yield file;
      }
    }
  }
}
