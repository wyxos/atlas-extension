import fs from 'node:fs';
import path from 'node:path';

export function copyStaticAssets({ buildOutputPath, root }) {
  const copied = [];

  for (const directory of ['icons']) {
    const sourcePath = path.join(root, directory);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    for (const file of walkFiles(sourcePath)) {
      const relativePath = path.join(directory, path.relative(sourcePath, file));
      const destinationPath = path.join(buildOutputPath, relativePath);

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(file, destinationPath);
      copied.push(relativePath.replaceAll(path.sep, '/'));
    }
  }

  return copied.sort((left, right) => left.localeCompare(right));
}

function* walkFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
