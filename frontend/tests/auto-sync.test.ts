import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot, makeDeck, makeCard, deleteDeckData, type Snapshot } from '../src/domain.ts';
import { mergeAutoSync, snapshotSignature } from '../src/auto-sync-merge.ts';
import { ensureAutoSyncFile, syncAutoSyncFile } from '../src/auto-sync-drive.ts';

const make = () => { const d = makeDeck('ODE', 'formulas', '2026-01-01T00:00:00Z'); const c = makeCard(d.id, 'q', 'a', '2026-01-01T00:00:00Z');
  return { ...emptySnapshot('2026-01-01T00:00:00Z'), decks: [d], cards: [c] }; };

test('3-way merge transfers remote text edit without updatedAt change', () => {
  const baseline = make();
  const remote = structuredClone(baseline);
  remote.cards[0].front = 'REMOTE EDIT';
  const merged = mergeAutoSync(baseline, remote, baseline);
  assert.equal(merged.cards[0].front, 'REMOTE EDIT');
});
test('3-way merge transfers local text edit', () => {
  const baseline = make();
  const local = structuredClone(baseline);
  local.cards[0].front = 'LOCAL EDIT';
  assert.equal(mergeAutoSync(local, baseline, baseline).cards[0].front, 'LOCAL EDIT');
});
test('3-way merges changes to different records', () => {
  const baseline = make();
  const local = structuredClone(baseline); local.decks[0].name = 'Updated deck';
  const remote = structuredClone(baseline); remote.cards[0].back = 'remote answer';
  const result=mergeAutoSync(local,remote,baseline);
  assert.equal(result.cards[0].back,'remote answer'); assert.equal(result.decks[0].name,'Updated deck');
});
test('same-card concurrent edits cause conflict rather than overwrite', () => {
  const baseline = make();
  const local=structuredClone(baseline); local.cards[0].front='local';
  const remote=structuredClone(baseline); remote.cards[0].front='remote';
  assert.throws(()=>mergeAutoSync(local,remote,baseline),/Auto-sync conflict/);
});
test('deleted deck never resurrects from the unchanged base', () => {
  const baseline = make(); const local = deleteDeckData(baseline,baseline.decks[0].id,'2026-02-01T00:00:00Z');
  const merged = mergeAutoSync(local,baseline,baseline);
  assert.ok(merged.decks[0].deletedAt); assert.equal(merged.cards[0].front,'');
});
test('snapshot content ignores top-level timestamp but detects changed cards', () => {
  const s=make(); const updated={...s,updatedAt:new Date().toISOString()};
  assert.equal(snapshotSignature(s),snapshotSignature(updated));
  updated.cards=[{...s.cards[0],front:'changed'}]; assert.notEqual(snapshotSignature(s),snapshotSignature(updated));
});
test('create folder and visible JSON, then auto-sync uploads changed local data', async () => {
  const old=globalThis.fetch;
  const s=make(); let fileBody=JSON.stringify(s), revision=1;
  const seen:string[]=[];
  globalThis.fetch=(async(input:any, init?:RequestInit) => {
    const url=String(input);const method=init?.method||'GET';seen.push(method+' '+url);
    if(method==='POST'&&url.includes('uploadType=multipart'))return new Response(JSON.stringify({id:'file123'}),{status:200});
    if(method==='POST'&&url.includes('drive/v3/files?'))return new Response(JSON.stringify({id:'folder123'}),{status:200});
    if(url.includes('drive/v3/files?'))return new Response(JSON.stringify({files:[]}),{status:200});
    if(method==='PATCH'&&url.includes('/file123?')){fileBody=String(init?.body);revision++;return new Response(JSON.stringify({id:'file123'}),{status:200});}
    if(url.includes('/file123?')&&url.includes('alt=media'))return new Response(fileBody,{status:200});
    if(url.includes('/file123?'))return new Response(JSON.stringify({id:'file123',name:'flashcards.json',modifiedTime:`rev${revision}`,mimeType:'application/json'}),{status:200});
    return new Response('bad', {status:500});
  }) as typeof fetch;
  try {
    const {target,created}=await ensureAutoSyncFile('token',s);
    assert.equal(created,true); assert.equal(target.name,'diy-flashcard/flashcards.json');
    const local=structuredClone(s);local.cards[0].front='UPDATED';
    const result=await syncAutoSyncFile('token',target,local,s);
    assert.equal(result.uploaded,true);assert.equal(JSON.parse(fileBody).cards[0].front,'UPDATED');
    const again=await syncAutoSyncFile('token',target,result.snapshot,result.baseline);
    assert.equal(again.uploaded,false);
    assert.equal(seen.filter(x=>x.startsWith('PATCH')).length,1);
  }finally{globalThis.fetch=old;}
});
