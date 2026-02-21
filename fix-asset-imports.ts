import fs from 'fs';
import path from 'path';

function getAllTsFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllTsFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });
  return arrayOfFiles;
}

const files = getAllTsFiles('AtomBase/src');
const importRegex = /(?:import\s+(?:(?:\w+|\{[^}]+\})\s+from\s+)?['"]([^'"]+\.(?:txt|json))['"];?)|(?:require\(['"]([^'"]+\.(?:txt|json))['"]\))/g;

let totalFixes = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const newContent = content.replace(importRegex, (match, importPath1, importPath2) => {
    const importPath = importPath1 || importPath2;
    if (!importPath) return match;

    const currentDir = path.dirname(file);
    const absoluteImportPath = path.resolve(currentDir, importPath);

    if (fs.existsSync(absoluteImportPath)) {
      return match;
    }

    const assetName = path.basename(importPath);

    function findAsset(startPath: string): string | null {
       const dirFiles = fs.readdirSync(startPath);
       for(const f of dirFiles) {
         const fullPath = path.join(startPath, f);
         if (fs.statSync(fullPath).isDirectory()) {
            const result = findAsset(fullPath);
            if (result) return result;
         } else if (f === assetName) {
            return fullPath;
         }
       }
       return null;
    }

    const foundNewPath = findAsset('AtomBase/src');

    if (foundNewPath) {
      let relativePath = path.relative(currentDir, foundNewPath);
      if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
      }
      console.log(`Fixed in ${file}: ${importPath} -> ${relativePath}`);
      changed = true;
      totalFixes++;
      return match.replace(importPath, relativePath);
    }
    
    // Check if the file name matches a specific pattern for runtime prompts
    if (importPath.includes('runtime/')) {
        const runtimeName = path.basename(importPath);
        const resolvedPath = path.resolve('AtomBase/src/core/session/prompt/runtime', runtimeName);
        if (fs.existsSync(resolvedPath)) {
            let relativePath = path.relative(currentDir, resolvedPath);
            if (!relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }
            console.log(`[Heuristic] Fixed in ${file}: ${importPath} -> ${relativePath}`);
            changed = true;
            totalFixes++;
            return match.replace(importPath, relativePath);
        }
    }


    console.log(`[WARNING] Could not find asset ${assetName} for ${file}`);
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, newContent, 'utf8');
  }
}

console.log(`Fixed ${totalFixes} asset imports.`);
