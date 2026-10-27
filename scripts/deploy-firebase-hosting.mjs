// Official Hosting REST deployment. Uses the operator's existing gcloud login;
// access tokens remain in memory and are never written to source or arguments.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const project = process.env.GCLOUD_PROJECT || 'gen-lang-client-0444960702';
const config = JSON.parse(await readFile('firebase.json', 'utf8')).hosting;
const site = process.env.FIREBASE_SITE || config.site;
if (!/^[a-z0-9-]+$/.test(site)) throw new Error('Invalid Firebase site ID');
const directory = resolve(config.public);
await stat(resolve(directory, 'index.html'));
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const auth = { Authorization: `Bearer ${token}`, 'x-goog-user-project': project };
const base = 'https://firebasehosting.googleapis.com/v1beta1/';
async function request(path, method, body) {
  const response = await fetch(base + path, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Hosting ${method} failed (${response.status}): ${result.error?.message || 'unknown error'}`);
  return result;
}
const servingConfig = {
  rewrites: config.rewrites.map(rule => ({ glob: rule.source, ...(rule.run ? { run: rule.run } : { path: rule.destination }) })),
  headers: config.headers.map(rule => ({ glob: rule.source, headers: Object.fromEntries(rule.headers.map(h => [h.key, h.value])) })),
};
const version = await request(`sites/${site}/versions`, 'POST', { config: servingConfig });
const files = {};
const blobs = new Map();
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) {
      if (/\.(map|pem|env)$/.test(entry.name)) throw new Error('Unexpected private or debug artifact in web build');
      const compressed = gzipSync(await readFile(path), { level: 9 });
      const hash = createHash('sha256').update(compressed).digest('hex');
      files['/' + relative(directory, path).replaceAll('\\', '/')] = hash;
      blobs.set(hash, compressed);
    }
  }
}
await walk(directory);
const population = await request(`${version.name}:populateFiles`, 'POST', { files });
for (const hash of population.uploadRequiredHashes || []) {
  const response = await fetch(`${population.uploadUrl}/${hash}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: blobs.get(hash), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Hosting upload failed (${response.status})`);
}
await request(`${version.name}?update_mask=status`, 'PATCH', { status: 'FINALIZED' });
const release = await request(`sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`, 'POST');
const proof = { deployedAt: release.releaseTime, url: `https://${site}.web.app`, version: version.name, release: release.name, files: Object.keys(files).length };
await mkdir('evidence', { recursive: true });
await writeFile('evidence/firebase-deployment.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof, null, 2));
