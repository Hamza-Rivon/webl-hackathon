#!/usr/bin/env node
/**
 * Post-build script to reorganize TypeScript output
 * Moves files from dist/apps/api/src/* to dist/*
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, 'dist');
const nestedPath = path.join(distPath, 'apps', 'api', 'src');

if (fs.existsSync(nestedPath)) {
  // Move files from dist/apps/api/src to dist
  function moveRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const items = fs.readdirSync(src);
    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      const stat = fs.statSync(srcPath);
      
      if (stat.isDirectory()) {
        moveRecursive(srcPath, destPath);
        fs.rmdirSync(srcPath);
      } else {
        fs.renameSync(srcPath, destPath);
      }
    }
  }
  
  moveRecursive(nestedPath, distPath);
  
  // Clean up empty directories
  try {
    fs.rmdirSync(path.join(distPath, 'apps', 'api'));
    fs.rmdirSync(path.join(distPath, 'apps'));
  } catch (e) {
    // Ignore if not empty
  }
  
  // Remove packages directory if it exists
  const packagesPath = path.join(distPath, 'packages');
  if (fs.existsSync(packagesPath)) {
    fs.rmSync(packagesPath, { recursive: true, force: true });
  }
  
  console.log('✅ Build output reorganized');
} else if (fs.existsSync(path.join(distPath, 'index.js'))) {
  console.log('✅ Build output already in correct location');
} else {
  console.log('⚠️  No build output found');
}
