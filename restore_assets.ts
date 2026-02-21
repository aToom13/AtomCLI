import fs from 'fs';
import path from 'path';
import { $ } from 'bun';

// 1. Get the list of deleted files from the last commit
const deletedFilesOutput = await $`git log -1 --name-status | grep ^D`.text();
const deletedFiles = deletedFilesOutput.split('\n')
  .map(line => line.split('\t')[1])
  .filter(Boolean)
  .filter(file => file.endsWith('.txt') || file.endsWith('.json'));

// 2. Restore each from HEAD~1
for (const file of deletedFiles) {
  try {
    await $`git checkout HEAD~1 -- ${file}`.quiet();
    console.log(`Restored: ${file}`);
  } catch (e) {
    console.error(`Failed to restore ${file}`);
  }
}

// 3. Move them to their new categories
const mapping = {
  core: ['bus', 'config', 'env', 'global', 'id', 'memory', 'session', 'snapshot', 'storage', 'types'],
  services: ['auth', 'file', 'installation', 'learning', 'patch', 'project', 'worktree'],
  interfaces: ['cli', 'command', 'flag', 'format', 'presentation', 'pty', 'question', 'shell', 'ui'],
  integrations: ['acp', 'agent', 'browser', 'flow', 'ide', 'lsp', 'mcp', 'plugin', 'provider', 'skill', 'tool'],
  util: ['util', 'utils', 'bun', 'share', 'permission']
};

for (const file of deletedFiles) {
  if (!file.startsWith('AtomBase/src/')) continue;
  
  const parts = file.split('/');
  // AtomBase/src/FOLDER/...
  const folder = parts[2];
  
  let targetCategory = '';
  for (const [cat, folders] of Object.entries(mapping)) {
    if (folders.includes(folder)) {
      targetCategory = cat;
      break;
    }
  }
  
  if (targetCategory) {
    let newFolder = folder;
    if (folder === 'utils') newFolder = 'util'; // mapped
    
    parts[2] = `${targetCategory}/${newFolder}`;
    const newPath = parts.join('/');
    
    // Create dir if needed
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    // Move
    if (fs.existsSync(file)) {
      fs.renameSync(file, newPath);
      console.log(`Moved: ${file} -> ${newPath}`);
    }
  }
}

// Clean up old directories
try {
  await $`find AtomBase/src -type d -empty -delete`.quiet();
} catch (e) {}

console.log("Assets restored and moved successfully!");
