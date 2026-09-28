import { readFile } from 'node:fs/promises';

const defaultPath = new URL('../.local/config.json', import.meta.url);
const keys = new Set(['port', 'expectedRepublicAccount', 'expectedXAccount']);

function account(value, kind) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`Expected ${kind} account must be a string.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (kind === 'Republic') return normalized;
  if (!/^@?[A-Za-z0-9_]{1,15}$/.test(normalized)) throw new Error('Expected X account must be a valid handle.');
  return '@' + normalized.replace(/^@/, '').toLowerCase();
}

export async function loadConfig({ env = process.env, configPath = defaultPath } = {}) {
  let contents;
  try {
    contents = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read local configuration.');
  }
  let local = {};
  if (contents !== undefined) {
    try { local = JSON.parse(contents); }
    catch { throw new Error('Local configuration must contain valid JSON.'); }
    if (!local || typeof local !== 'object' || Array.isArray(local)) {
      throw new Error('Local configuration must be a JSON object.');
    }
    if (Object.keys(local).some(key => !keys.has(key))) throw new Error('Local configuration contains unsupported keys.');
  }
  const rawPort = env.RAID_CDP_PORT !== undefined ? env.RAID_CDP_PORT
    : Object.hasOwn(local, 'port') ? local.port : 19227;
  if ((typeof rawPort !== 'number' && typeof rawPort !== 'string') ||
      (typeof rawPort === 'string' && !/^\d+$/.test(rawPort.trim()))) {
    throw new Error('RAID_CDP_PORT must be an integer from 1024 to 65535.');
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('RAID_CDP_PORT must be an integer from 1024 to 65535.');
  }
  return {
    port,
    expectedXAccount: account(env.RAID_EXPECTED_X_ACCOUNT ?? local.expectedXAccount, 'X'),
    expectedRepublicAccount: account(env.RAID_EXPECTED_REPUBLIC_ACCOUNT ?? local.expectedRepublicAccount, 'Republic'),
  };
}
