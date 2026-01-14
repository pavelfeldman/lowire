#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const bumpType = process.argv[2] || 'patch';
const root = path.join(__dirname, '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const loopPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/loop/package.json'), 'utf8'));

const bump = (v, t) => {
  const [a, b, c] = v.split('.').map(Number);
  return t === 'major' ? `${a + 1}.0.0` : t === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
};

const newVersion = bump(rootPkg.version, bumpType);
rootPkg.version = newVersion;
loopPkg.version = newVersion;

fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'packages/loop/package.json'), JSON.stringify(loopPkg, null, 2) + '\n');

execSync('npm i', { cwd: root, stdio: 'inherit' });
