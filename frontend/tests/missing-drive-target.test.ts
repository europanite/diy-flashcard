import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot } from '../src/domain.ts';
import { MissingAutoSyncTargetError, syncAutoSyncFile } from '../src/auto-sync-drive.ts';

const target = { id: 'dead123', name: 'diy-flashcard/flashcards.json' };

test('deleted Drive JSON is reported without touching the local snapshot', async () => {
  const old = globalThis.fetch;
  const local = emptySnapshot('2026-01-01T00:00:00Z');
  globalThis.fetch = (async () => new Response('Not Found', {status: 404})) as typeof fetch;
  try {
    await assert.rejects(syncAutoSyncFile('token', target, local, null), error =>
      error instanceof MissingAutoSyncTargetError && /preserved/.test(error.message));
    assert.equal(local.decks.length, 0);
  } finally { globalThis.fetch = old; }
});

test('trashed Drive JSON produces missing-target error', async () => {
  const old=globalThis.fetch;
  globalThis.fetch=(async () => new Response(JSON.stringify({
    id:'dead123',mimeType:'application/json',trashed:true
  }),{status:200})) as typeof fetch;
  try {
    await assert.rejects(syncAutoSyncFile('token',target,emptySnapshot(),null), MissingAutoSyncTargetError);
  }finally{globalThis.fetch=old;}
});

test('403 permission error does not masquerade as deleted file',async () => {
  const old=globalThis.fetch;
  globalThis.fetch=(async () => new Response('Forbidden',{status:403})) as typeof fetch;
  try {
    await assert.rejects(syncAutoSyncFile('token',target,emptySnapshot(),null), error =>
      error instanceof Error && !(error instanceof MissingAutoSyncTargetError) && /denied/.test(error.message));
  }finally{globalThis.fetch=old;}
});
