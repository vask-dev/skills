#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const DEFAULT_BASE_URL = 'https://vask.dev';
const SSHSIG_NAMESPACE = 'vask-register';

function usage() {
  return `Usage:
  node scripts/vask-agent-signup.mjs --github USER [options]

Options:
  --github, --github-username USER  GitHub username to register or recover
  --ssh-key, -i PATH                SSH private key to sign with
  --identity-file PATH              Alias for --ssh-key
  --base-url URL                    Vask base URL (default: https://vask.dev)
  --json                            Print the raw JSON response
  --help                            Show this help

Environment fallbacks:
  GITHUB_USERNAME, VASK_GITHUB_USERNAME, SSH_KEY, VASK_SSH_KEY, BASE_URL,
  VASK_BASE_URL`;
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error('');
  console.error(usage());
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: process.env.BASE_URL || process.env.VASK_BASE_URL || DEFAULT_BASE_URL,
    github: process.env.GITHUB_USERNAME || process.env.VASK_GITHUB_USERNAME || '',
    json: false,
    sshKey: process.env.SSH_KEY || process.env.VASK_SSH_KEY || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    const name = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const takesValue = [
      '--github',
      '--github-username',
      '--ssh-key',
      '--identity-file',
      '--base-url',
      '-i',
    ];

    if (!takesValue.includes(name)) {
      fail(`Unknown option: ${arg}`);
    }

    const value = inlineValue ?? argv[i + 1];
    if (!value || value.startsWith('--')) {
      fail(`${name} requires a value`);
    }

    if (inlineValue === undefined) {
      i += 1;
    }

    if (name === '--github' || name === '--github-username') {
      parsed.github = value;
    } else if (name === '--ssh-key' || name === '--identity-file' || name === '-i') {
      parsed.sshKey = value;
    } else if (name === '--base-url') {
      parsed.baseUrl = value;
    }
  }

  return parsed;
}

function defaultSshKey() {
  const ed25519 = resolve(homedir(), '.ssh/id_ed25519');
  if (existsSync(ed25519)) {
    return ed25519;
  }

  const rsa = resolve(homedir(), '.ssh/id_rsa');
  if (existsSync(rsa)) {
    return rsa;
  }

  return ed25519;
}

function expandHome(path) {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }

  return result.stdout;
}

function endpointFor(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail(`Invalid --base-url: ${baseUrl}`);
  }

  return new URL('/api/agent-signup', url).toString();
}

function isGithubUsername(value) {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value);
}

function dotenvLines(credentials) {
  return Object.entries(credentials)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');
}

async function main() {
  if (typeof fetch !== 'function') {
    fail('This helper requires Node.js 18+ with global fetch support');
  }

  const args = parseArgs(process.argv.slice(2));
  const github = args.github.trim();

  if (!github) {
    fail('Set --github to the user\'s GitHub username');
  }

  if (!isGithubUsername(github)) {
    fail('--github must be a GitHub username, not an email address or URL');
  }

  const sshKey = resolve(expandHome(args.sshKey || defaultSshKey()));
  if (!existsSync(sshKey)) {
    fail(`No SSH key found at ${sshKey}; pass --ssh-key to choose one`);
  }

  const payload = JSON.stringify({
    github_username: github,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    intent: 'register',
  });

  let signature;
  let pubkey;

  try {
    signature = run('ssh-keygen', ['-Y', 'sign', '-f', sshKey, '-n', SSHSIG_NAMESPACE], payload).trim();
    pubkey = run('ssh-keygen', ['-y', '-f', sshKey]).trim();
  } catch (error) {
    fail(error.message);
  }

  const response = await fetch(endpointFor(args.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload,
      signature,
      claimed_pubkey: pubkey,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(`Vask agent signup failed with HTTP ${response.status}.`);
    console.error(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const credentials = data?.app?.credentials;

  console.log(`Vask agent signup succeeded for ${data?.user?.github_username ?? github}.`);
  if (typeof data?.user?.is_new_account === 'boolean') {
    console.log(`Account: ${data.user.is_new_account ? 'created' : 'recovered'}`);
  }

  if (credentials && typeof credentials === 'object') {
    console.log('');
    console.log('Credentials:');
    console.log(dotenvLines(credentials));
  } else {
    console.log('');
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
