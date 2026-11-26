import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { decrypt, encrypt, q } from './db.js';

// Login state of one linked WhatsApp, kept in Postgres (wl_auth) instead of
// files, so a server restart / redeploy does not log anyone out. Every value
// is encrypted (see db.js). Same shape as Baileys' useMultiFileAuthState.

export async function usePgAuthState(accountId) {
  const read = async (k) => {
    const r = await q('SELECT v FROM wl_auth WHERE account_id = $1 AND k = $2', [accountId, k]);
    if (!r.rows[0]) return null;
    try { return JSON.parse(decrypt(r.rows[0].v), BufferJSON.reviver); } catch (e) {
      console.error(`[auth ${accountId}] unreadable key ${k}:`, e.message);
      return null;
    }
  };
  const write = (k, value) => q(
    'INSERT INTO wl_auth (account_id, k, v) VALUES ($1, $2, $3) ON CONFLICT (account_id, k) DO UPDATE SET v = EXCLUDED.v',
    [accountId, k, encrypt(JSON.stringify(value, BufferJSON.replacer))],
  );
  const remove = (k) => q('DELETE FROM wl_auth WHERE account_id = $1 AND k = $2', [accountId, k]);

  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          if (!ids.length) return out;
          const r = await q('SELECT k, v FROM wl_auth WHERE account_id = $1 AND k = ANY($2::text[])', [accountId, ids.map((id) => `${type}-${id}`)]);
          const byKey = new Map(r.rows.map((row) => [row.k, row.v]));
          for (const id of ids) {
            const blob = byKey.get(`${type}-${id}`);
            let value = null;
            if (blob) { try { value = JSON.parse(decrypt(blob), BufferJSON.reviver); } catch { value = null; } }
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              tasks.push(value ? write(`${category}-${id}`, value) : remove(`${category}-${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

/** Forgets a linked WhatsApp's login (after log out). */
export const clearAuth = (accountId) => q('DELETE FROM wl_auth WHERE account_id = $1', [accountId]);
