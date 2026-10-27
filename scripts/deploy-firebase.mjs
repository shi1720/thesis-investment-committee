import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const project = process.env.GCLOUD_PROJECT || 'gen-lang-client-0444960702';
const environment = process.env.THESIS_CLOUD_ENV;
if (!environment || !existsSync(environment)) throw new Error('Set THESIS_CLOUD_ENV to the private Cloud Run environment YAML. See docs/firebase-deployment.md.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const tag = new Date().toISOString().replaceAll(/[^0-9]/g, '').slice(0, 14);
const image = `us-central1-docker.pkg.dev/${project}/thesis/api:${tag}`;
run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'build:web']);
run('gcloud', ['builds', 'submit', `--project=${project}`, '--config=cloudbuild.api.yaml', `--substitutions=_IMAGE=${image}`, '--quiet']);
run('gcloud', ['run', 'deploy', 'thesis-api', `--project=${project}`, '--region=us-central1', `--image=${image}`, `--service-account=thesis-runtime@${project}.iam.gserviceaccount.com`, '--allow-unauthenticated', '--memory=512Mi', '--cpu=1', '--concurrency=16', '--timeout=600', '--max-instances=2', '--min-instances=0', `--env-vars-file=${environment}`, '--set-secrets=NIGHTSHIFT_API_KEY=thesis-provider-gateway:1,ZETARIS_API_KEY=thesis-provider-gateway:1', '--quiet']);
// Hosting release follows a healthy API deployment, never races its creation.
run('node', ['scripts/deploy-firebase-hosting.mjs']);
run('npm', ['run', 'test:firebase']);
console.log('Thesis Firebase deployment and isolated hosted verification completed.');
