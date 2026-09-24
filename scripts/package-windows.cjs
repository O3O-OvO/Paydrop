const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repository = process.env.GITHUB_REPOSITORY || process.env.PAYDROP_GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
  console.error('Set GITHUB_REPOSITORY=owner/repo (the public GitHub repository) before packaging.');
  process.exit(1);
}

const publish = process.argv.slice(2);
if (publish.length && (publish.length !== 2 || publish[0] !== '--publish' || publish[1] !== 'always')) {
  console.error('Only --publish always is supported; local builds never upload automatically.');
  process.exit(1);
}

const [owner, repo] = repository.split('/');
const builder = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
const args = [
  builder,
  '--win', 'nsis',
  `--config.publish.owner=${owner}`,
  `--config.publish.repo=${repo}`,
  '--publish', publish.length ? 'always' : 'never',
];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
