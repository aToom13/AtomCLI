import fs from 'fs';
import path from 'path';

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const importRegex = /from\s+['"]([^'"]+\.(txt|json))['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        const currentDir = path.dirname(filePath);
        const absolutePath = path.resolve(currentDir, importPath);
        if (!fs.existsSync(absolutePath)) {
            console.log(`[BROKEN] ${filePath}: ${importPath}`);
        }
    }
}

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            scanDir(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            checkFile(fullPath);
        }
    }
}

scanDir('AtomBase/src');
