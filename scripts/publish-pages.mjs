// Builds Daybook for GitHub Pages and copies the finished site into the repository root,
// so it works whether Pages publishes "from a branch" or "from GitHub Actions".
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.env.BASE_PATH || '/daybook/';
execSync('npx vite build', { stdio: 'inherit', env: { ...process.env, BASE_PATH: base } });

// remove the previous published copy (only files this script creates)
const manifestFile = '.published-files';
if (existsSync(manifestFile)) for (const f of readFileSync(manifestFile, 'utf8').split('\n').filter(Boolean)) rmSync(f, { recursive: true, force: true });

const files = readdirSync('dist');
for (const f of files) cpSync(`dist/${f}`, f, { recursive: true });
cpSync('dist/index.html', '404.html');           // lets deep links like /daybook/tasks open the app
writeFileSync('.nojekyll', '');                   // serve files as-is
writeFileSync(manifestFile, [...files, '404.html'].join('\n') + '\n');
console.log(`Published ${files.length} files to the repo root for ${base}`);
