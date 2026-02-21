import fs from 'fs';
import path from 'path';

function getAllTsFiles(dirPath, arrayOfFiles = []) {
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
const importRegex = /from\s+['"]([^'"]+\.(txt|json))['"]/g;

let totalFixes = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const newContent = content.replace(importRegex, (match, importPath) => {
    const currentDir = path.dirname(file);
    const absoluteImportPath = path.resolve(currentDir, importPath);

    if (fs.existsSync(absoluteImportPath)) {
      return match; // Path is already correct
    }

    // Path is broken. Let's find where the asset actually is in AtomBase/src
    const assetName = path.basename(importPath);
    let foundNewPath = null;
    
    // Quick search for the asset by name in all of src
    function findAsset(startPath) {
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

    foundNewPath = findAsset('AtomBase/src');

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

    console.log(`[WARNING] Could not find asset ${assetName} for ${file}`);
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, newContent, 'utf8');
  }
}

console.log(`Fixed ${totalFixes} asset imports.`);
