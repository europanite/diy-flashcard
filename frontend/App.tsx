import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView, Share,
  StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import {
  activeCards, activeDecks, dailyReviewCounts, dueCards, emptySnapshot,
  makeCard, makeDeck, mergeSnapshots, progress, rateCard, validateSnapshot,
  type Card, type Deck, type Grade, type Snapshot,
} from './src/domain';
import { loadSnapshot, saveSnapshot } from './src/storage';
import { useGoogleDriveAuth } from './src/google';
import { syncDrive } from './src/drive';

const C = {
  bg: '#0B0912', panel: '#181425', panel2: '#231C34', border: '#352B4C',
  purple: '#A98DFF', purpleDark: '#6D51B7', yellow: '#F5D46A',
  white: '#F8F6FF', muted: '#A79FB9', green: '#8FE0AC', red: '#FF9E9E',
};
type Tab = 'home' | 'decks' | 'study' | 'settings';

function Button({ label, onPress, variant = 'primary', disabled = false, small = false }: {
  label: string; onPress: () => void; variant?: 'primary' | 'subtle' | 'danger' | 'yellow'; disabled?: boolean; small?: boolean;
}) {
  const backgroundColor = variant === 'primary' ? C.purple : variant === 'yellow' ? C.yellow : variant === 'danger' ? '#4B2736' : C.panel2;
  const color = variant === 'primary' || variant === 'yellow' ? C.bg : variant === 'danger' ? C.red : C.white;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [{ backgroundColor, paddingVertical: small ? 10 : 14, paddingHorizontal: small ? 14 : 18, borderRadius: 13, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, alignItems: 'center', justifyContent: 'center' }] }>
    <Text style={{ color, fontWeight: '800', fontSize: small ? 13 : 15 }}>{label}</Text>
  </Pressable>;
}
function Field({ label, value, onChangeText, placeholder, multiline = false }: { label: string; value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return <View style={{ gap: 7 }}>
    <Text style={styles.formLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} style={[styles.input, multiline && { minHeight: 110, textAlignVertical: 'top' }]}
      placeholder={placeholder} placeholderTextColor="#776E8A" value={value} onChangeText={onChangeText} multiline={multiline} />
  </View>;
}
function SectionTitle({ title, caption }: { title: string; caption?: string }) {
  return <View style={{ marginTop: 22, marginBottom: 13 }}><Text style={styles.sectionTitle}>{title}</Text>{caption && <Text style={styles.muted}>{caption}</Text>}</View>;
}
function Pill({ text, color = C.yellow }: { text: string; color?: string }) {
  return <View style={{ backgroundColor: C.panel2, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12 }}><Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text></View>;
}
function Metric({ value, label, color = C.white }: { value: string | number; label: string; color?: string }) {
  return <View style={styles.metric}><Text style={{ color, fontSize: 27, fontWeight: '900' }}>{value}</Text><Text style={styles.muted}>{label}</Text></View>;
}

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [tab, setTab] = useState<Tab>('home');
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot());
  const snapshotRef = useRef(snapshot);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [studyDeck, setStudyDeck] = useState<string | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = useGoogleDriveAuth();
  const notify = (message: string) => setNotice(message);

  useEffect(() => {
    let live = true;
    loadSnapshot().then(s => {
      if (live) { snapshotRef.current = s; setSnapshot(s); }
    }).catch(e => { if (live) notify(String(e.message || e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const mutate = useCallback((fn: (s: Snapshot) => Snapshot) => {
    const updated = fn(snapshotRef.current);
    const next = { ...updated, updatedAt: new Date().toISOString() };
    snapshotRef.current = next;
    setSnapshot(next);
    saving.current = saving.current.catch(() => {}).then(() => saveSnapshot(next));
    void saving.current.catch(error => notify(`Save failed: ${String(error.message || error)}`));
  }, []);
  const decks = activeDecks(snapshot);
  const cards = activeCards(snapshot);
  const due = dueCards(snapshot);
  const stats = progress(snapshot);
  const selected = decks.find(d => d.id === selectedDeck);
  const selectedCards = activeCards(snapshot, selectedDeck || undefined).filter(c => c.deckId === selectedDeck);
  const queue = dueCards(snapshot, studyDeck);
  const current = queue[0];

  function addDeck() {
    try {
      const newDeck = makeDeck(deckName, deckDescription);
      mutate(s => ({ ...s, decks: [...s.decks, newDeck] }));
      setDeckName(''); setDeckDescription(''); setSelectedDeck(newDeck.id);
      notify('Deck created.');
    } catch (error) { notify(String((error as Error).message)); }
  }
  function addOrUpdateCard() {
    try {
      if (!selectedDeck) return;
      if (!front.trim() || !back.trim()) throw new Error('Enter both the front and back of the card.');
      const now = new Date().toISOString();
      if (editingCard) {
        mutate(s => ({ ...s, cards: s.cards.map(c => c.id === editingCard ? { ...c, front: front.trim(), back: back.trim(), updatedAt: now } : c) }));
      } else {
        const newCard = makeCard(selectedDeck, front, back, now);
        mutate(s => ({ ...s, cards: [...s.cards, newCard] }));
      }
      setFront(''); setBack(''); setEditingCard(null);
      notify(editingCard ? 'Card updated.' : 'Card added.');
    } catch (error) { notify(String((error as Error).message)); }
  }
  function confirmDelete(message: string, action: () => void) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) action();
      return;
    }
    Alert.alert('Confirm deletion', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: action },
    ]);
  }
  function removeCard(card: Card) {
    confirmDelete('Delete this card?', () => {
      const now = new Date().toISOString();
      mutate(s => ({ ...s, cards: s.cards.map(c => c.id === card.id ? { ...c, deletedAt: now, updatedAt: now } : c) }));
      if (editingCard === card.id) { setEditingCard(null); setFront(''); setBack(''); }
      notify('Card deleted. The deletion will be preserved during sync.');
    });
  }
  function removeDeck(deck: Deck) {
    confirmDelete(`Delete "${deck.name}" and hide its cards?`, () => {
      const now = new Date().toISOString();
      mutate(s => ({ ...s, decks: s.decks.map(d => d.id === deck.id ? { ...d, deletedAt: now, updatedAt: now } : d) }));
      setSelectedDeck(null);
      notify('Deck deleted.');
    });
  }
  function review(grade: Grade) {
    if (!current) return;
    const { card, review } = rateCard(current, grade);
    mutate(s => ({ ...s, cards: s.cards.map(c => c.id === card.id ? card : c), reviews: [...s.reviews, review] }));
    setRevealed(false);
  }
  function startStudy(deckId?: string) { setStudyDeck(deckId); setRevealed(false); setTab('study'); }
  async function driveSync() {
    if (!auth.token) { notify('Connect to Google Drive first.'); return; }
    setBusy(true);
    try {
      // Persist the merged result only after Drive confirms the upload.
      const synced = await syncDrive(auth.token, snapshotRef.current);
      mutate(s => mergeSnapshots(s, synced));
      notify('Google Drive sync completed.');
    } catch (error) { notify(`Sync failed: ${String((error as Error).message)}`); }
    finally { setBusy(false); }
  }
  async function exportJson() {
    const json = JSON.stringify(snapshotRef.current, null, 2);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'service-backup.json'; a.click();
      URL.revokeObjectURL(url);
      notify('JSON backup exported.');
    } else {
      try { await Share.share({ message: json, title: 'You FrashCard backup' }); }
      catch (error) { notify(String((error as Error).message)); }
    }
  }
  function importJson() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') { notify('JSON import is currently supported on Web only.'); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw new Error('The file must be 20 MB or smaller.');
        const data: unknown = JSON.parse(await file.text());
        validateSnapshot(data);
        mutate(s => mergeSnapshots(s, data));
        notify('Backup imported and merged with existing data.');
      } catch (error) { notify(String((error as Error).message)); }
    };
    input.click();
  }
  function addSample() {
    const deck = makeDeck('Math Fundamentals', 'Example flashcards');
    const samples = [
      makeCard(deck.id, 'What is the geometric meaning of the dot product?', 'a · b = |a||b|cos θ. It relates two vectors through the angle between them.'),
      makeCard(deck.id, 'What is the product rule for differentiation?', "(fg)' = f'g + fg'"),
      makeCard(deck.id, 'What does det(A) = 0 mean?', 'The matrix is singular (not invertible), and its columns are linearly dependent.'),
    ];
    mutate(s => ({ ...s, decks: [...s.decks, deck], cards: [...s.cards, ...samples] }));
    notify('Example cards added.');
  }
  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator color={C.purple} size="large" style={{ marginTop: 130 }}/></SafeAreaView>;

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}>
      <Pressable onPress={() => { setTab('home'); setSelectedDeck(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={styles.logo}><Text style={{ color: C.bg, fontWeight: '900', fontSize: 20 }}>R</Text></View>
        <View><Text style={styles.brand}>RECALL <Text style={{ color: C.purple }}>DECK</Text></Text><Text style={styles.brandCaption}>Remember what matters.</Text></View>
      </Pressable>
      <Pill text={`${stats.due} due`} />
    </View>
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
      {wide && <View style={styles.sidebar}>
        {nav('home', '◈', 'Dashboard')}
        {nav('decks', '▤', 'Decks')}
        {nav('study', '✦', 'Study')}
        {nav('settings', '⚙', 'Settings & Sync')}
        <View style={{ flex: 1 }}/><Text style={[styles.muted, { fontSize: 11 }]}>LOCAL FIRST · FREE TIER</Text>
      </View>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ width: '100%', maxWidth: 1060, alignSelf: 'center', paddingHorizontal: wide ? 32 : 18, paddingTop: 25, paddingBottom: 80 }}>
        {notice !== '' && <Pressable onPress={() => setNotice('')} style={styles.notice}><Text style={{ color: C.yellow, flex: 1 }}>{notice}</Text><Text style={{ color: C.yellow }}>×</Text></Pressable>}
        {tab === 'home' && <>
          <Text style={styles.eyebrow}>LEARNING OVERVIEW</Text>
          <Text style={styles.pageTitle}>Build your knowledge, one card at a time.</Text>
          <Text style={[styles.muted, { marginTop: 7, marginBottom: 25 }]}>Review what you learn before you forget it.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
            <Metric value={stats.due} label="Due Cards" color={C.yellow}/>
            <Metric value={stats.reviewsToday} label="Reviews Today" color={C.purple}/>
            <Metric value={`${stats.retention}%`} label="Retention" color={C.green}/>
            <Metric value={stats.streak} label="Day Streak"/>
          </View>
          <View style={[styles.hero, { flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch' }]}>
            <View style={{ flex: 1, gap: 9 }}><Text style={styles.heroTitle}>{stats.due ? `${stats.due} cards are ready for review` : 'All caught up for today!'}</Text>
              <Text style={styles.muted}>{stats.due ? 'Start with your toughest cards and strengthen your recall.' : 'Add new cards to keep learning.'}</Text></View>
            <Button label={stats.due ? 'Start Studying →' : 'Create a Deck →'} onPress={() => stats.due ? startStudy() : setTab('decks')} variant="yellow" />
          </View>
          <SectionTitle title="Last 7 Days" caption="Reviews completed each day" />
          <View style={styles.panel}>
            <View style={{ height: 138, flexDirection: 'row', alignItems: 'flex-end', gap: 11, paddingVertical: 5 }}>
              {dailyReviewCounts(snapshot).map((day, i, all) => {
                const max = Math.max(1, ...all.map(x => x.count));
                return <View key={i} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
                  <Text style={{ color: C.white, fontSize: 11 }}>{day.count || ''}</Text>
                  <View style={{ width: '100%', maxWidth: 55, height: 92, justifyContent: 'flex-end' }}><View style={{ height: Math.max(5, 92 * day.count / max), backgroundColor: i === 6 ? C.yellow : C.purpleDark, borderTopLeftRadius: 5, borderTopRightRadius: 5 }}/></View>
                  <Text style={{ color: C.muted, fontSize: 11 }}>{day.date}</Text>
                </View>;
              })}
            </View>
          </View>
          <SectionTitle title="My Decks" caption={`${stats.total} cards · ${stats.learned} mastered`} />
          {decks.length ? decks.map(d => deckTile(d)) : <View style={styles.empty}><Text style={styles.emptyTitle}>No decks yet</Text><Text style={styles.muted}>Create a deck or try the example cards.</Text><View style={styles.buttonRow}><Button label="Create Deck" onPress={() => setTab('decks')} small/><Button label="Add Examples" onPress={addSample} variant="subtle" small/></View></View>}
        </>}

        {tab === 'decks' && <>
          <Text style={styles.eyebrow}>COLLECTION</Text>
          <Text style={styles.pageTitle}>{selected ? selected.name : 'Manage Decks'}</Text>
          {!selected ? <>
            <Text style={[styles.muted, { marginVertical: 14 }]}>Organize your flashcards by subject or topic.</Text>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>New Deck</Text>
              <Field label="Deck Name" value={deckName} onChangeText={setDeckName} placeholder="e.g. Calculus / Vocabulary / AI Research" />
              <Field label="Description (Optional)" value={deckDescription} onChangeText={setDeckDescription} placeholder="e.g. Your learning goals" />
              <Button label="+ Create Deck" onPress={addDeck} />
            </View>
            <SectionTitle title="Your Decks" />
            {decks.length ? decks.map(d => deckTile(d)) : <View style={styles.empty}><Text style={styles.muted}>You have not created any decks yet.</Text><Button label="Create Example Deck" onPress={addSample} variant="subtle" small/></View>}
          </> : <>
            <View style={[styles.buttonRow, { marginTop: 17, marginBottom: 18 }]}>
              <Button label="← All Decks" variant="subtle" small onPress={() => { setSelectedDeck(null); setEditingCard(null); setFront(''); setBack(''); }}/>
              <Button label="Study This Deck" small onPress={() => startStudy(selected.id)}/>
              <Button label="Delete Deck" variant="danger" small onPress={() => removeDeck(selected)}/>
            </View>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{editingCard ? 'Edit Card' : 'Add a Card'}</Text>
              <Field label="Front (Question)" value={front} onChangeText={setFront} placeholder="Enter a question to remember" multiline/>
              <Field label="Back (Answer)" value={back} onChangeText={setBack} placeholder="Enter the answer or explanation" multiline/>
              <View style={styles.buttonRow}>
                <Button label={editingCard ? 'Save Changes' : '＋ Add Card'} onPress={addOrUpdateCard} />
                {editingCard && <Button label="Cancel" variant="subtle" onPress={() => { setEditingCard(null); setFront(''); setBack(''); }}/>}
              </View>
            </View>
            <SectionTitle title={`Cards (${selectedCards.length})`} />
            {selectedCards.map((card, index) => <View key={card.id} style={styles.cardListItem}>
              <View style={{ flex: 1, gap: 5 }}><Text style={styles.muted}>#{index + 1} · {card.dueAt <= new Date().toISOString() ? 'Due' : 'Next: ' + new Date(card.dueAt).toLocaleDateString('en-US')}</Text>
                <Text style={styles.itemTitle}>{card.front}</Text><Text style={styles.muted} numberOfLines={2}>{card.back}</Text></View>
              <View style={{ gap: 7 }}><Button label="Edit" variant="subtle" small onPress={() => { setEditingCard(card.id); setFront(card.front); setBack(card.back); }}/>
                <Button label="Delete" variant="danger" small onPress={() => removeCard(card)}/></View>
            </View>)}
            {selectedCards.length === 0 && <Text style={styles.muted}>Added cards will appear here.</Text>}
          </>}
        </>}

        {tab === 'study' && <>
          <Text style={styles.eyebrow}>FOCUS SESSION</Text>
          <Text style={styles.pageTitle}>Review Session</Text>
          <View style={[styles.buttonRow, { marginTop: 17, marginBottom: 24 }]}>
            <Button label="All Decks" variant={!studyDeck ? 'primary' : 'subtle'} small onPress={() => { setStudyDeck(undefined); setRevealed(false); }}/>
            {decks.map(d => <Button key={d.id} label={d.name} variant={studyDeck === d.id ? 'primary' : 'subtle'} small onPress={() => { setStudyDeck(d.id); setRevealed(false); }}/>) }
          </View>
          {current ? <>
            <View style={[styles.studyCard, { minHeight: wide ? 380 : 330 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Pill text={decks.find(d => d.id === current.deckId)?.name || 'Card'}/><Text style={styles.muted}>{queue.length} remaining</Text></View>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 17 }}>
                <Text style={styles.studyLabel}>{revealed ? 'ANSWER' : 'QUESTION'}</Text>
                <Text selectable style={styles.question}>{revealed ? current.back : current.front}</Text>
              </View>
              {!revealed && <Button label="Show Answer" onPress={() => setRevealed(true)} variant="yellow"/>}
              {revealed && <Text style={[styles.muted, { textAlign: 'center' }]}>How well did you remember it?</Text>}
            </View>
            {revealed && <View style={[styles.ratings, { flexDirection: wide ? 'row' : 'column' }]}>
              <View style={{ flex: 1 }}><Button label="Again" variant="danger" onPress={() => review(0)}/></View>
              <View style={{ flex: 1 }}><Button label="Hard" variant="subtle" onPress={() => review(1)}/></View>
              <View style={{ flex: 1 }}><Button label="Good" onPress={() => review(2)}/></View>
              <View style={{ flex: 1 }}><Button label="Easy" variant="yellow" onPress={() => review(3)}/></View>
            </View>}
            <Text style={[styles.muted, { marginTop: 18, textAlign: 'center' }]}>Your rating determines the next review date.</Text>
          </> : <View style={[styles.empty, { paddingVertical: 58 }]}><Text style={{ fontSize: 44 }}>✦</Text>
            <Text style={styles.emptyTitle}>No Cards Due</Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>Cards will appear here when they are due.</Text>
            <Button label="Back to Decks" onPress={() => { setTab('decks'); setSelectedDeck(null); }} variant="subtle" />
          </View>}
        </>}

        {tab === 'settings' && <>
          <Text style={styles.eyebrow}>DATA & SYNC</Text>
          <Text style={styles.pageTitle}>Settings & Data Sync</Text>
          <Text style={[styles.muted, { marginTop: 12, marginBottom: 22 }]}>Cards and review history are stored locally first. Google Drive sync is manual.</Text>
          <View style={styles.panel}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><Text style={styles.panelTitle}>Google Drive</Text><Pill text={auth.token ? 'Connected' : 'Not Connected'} color={auth.token ? C.green : C.muted}/></View>
            <Text style={styles.muted}>Data is stored in the private appDataFolder. Access to your entire Drive is not required.</Text>
            {!auth.configured && <Text style={{ color: C.yellow, lineHeight: 22 }}>Google OAuth Client ID is not configured. Follow the setup instructions in README.md.</Text>}
            <View style={styles.buttonRow}>
              {!auth.token ? <Button label="Connect Google Account" disabled={!auth.configured || busy} onPress={() => { void auth.connect().catch(e => notify(String(e.message || e))); }}/>
                : <><Button label={busy ? 'Syncing…' : 'Sync with Drive'} disabled={busy} onPress={() => void driveSync()}/><Button label="Disconnect" variant="subtle" disabled={busy} onPress={auth.disconnect}/></>}
            </View>
            <Text style={[styles.muted, { fontSize: 12 }]}>Sync devices one at a time. Concurrent edits are not strictly protected against conflicts.</Text>
          </View>
          <SectionTitle title="Backup" />
          <View style={styles.panel}><Text style={styles.muted}>Export a JSON backup and import it when needed. Imports also merge deletion records.</Text>
            <View style={styles.buttonRow}><Button label="Export JSON" onPress={() => void exportJson()} variant="subtle"/><Button label="Import JSON (Web)" onPress={importJson} variant="subtle" disabled={Platform.OS !== 'web'}/></View>
          </View>
          <SectionTitle title="Learning Data" />
          <View style={styles.panel}><Text style={styles.muted}>Decks: {decks.length} · Cards: {cards.length} · Reviews: {snapshot.reviews.length}</Text>
            <Text style={styles.muted}>The paid-tier FastAPI service is a separate development API. Billing and user accounts are not implemented yet.</Text>
          </View>
        </>}
      </ScrollView>
      {!wide && <View style={styles.bottomNav}>
        {nav('home', '◈', 'Home')}{nav('decks', '▤', 'Decks')}{nav('study', '✦', 'Study')}{nav('settings', '⚙', 'Settings')}
      </View>}
    </View>
  </SafeAreaView>;

  function nav(target: Tab, icon: string, label: string) {
    const active = tab === target;
    return <Pressable key={target} accessibilityRole="button" accessibilityLabel={label} onPress={() => setTab(target)}
      style={[styles.nav, wide ? { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 18 } : { flex: 1, justifyContent: 'center' }, active && { backgroundColor: C.panel2 }]}>
      <Text style={{ color: active ? C.yellow : C.muted, fontSize: 20 }}>{icon}</Text>
      <Text style={{ color: active ? C.white : C.muted, fontSize: wide ? 14 : 10, fontWeight: active ? '800' : '600' }}>{label}</Text>
    </Pressable>;
  }
  function deckTile(deck: Deck) {
    const all = activeCards(snapshot, deck.id);
    const wait = dueCards(snapshot, deck.id).length;
    const learned = all.filter(c => c.repetitions >= 3 && c.intervalDays >= 7).length;
    return <Pressable key={deck.id} onPress={() => { setSelectedDeck(deck.id); setTab('decks'); }} style={({ pressed }) => [styles.deckTile, { opacity: pressed ? 0.8 : 1 }]}>
      <View style={{ flex: 1, gap: 8 }}><Text style={styles.itemTitle}>{deck.name}</Text><Text numberOfLines={2} style={styles.muted}>{deck.description || 'No description'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Pill text={`${all.length} cards`}/><Pill text={`${wait} due`} color={wait ? C.yellow : C.green}/><Pill text={`${learned} mastered`} color={C.green}/></View>
      </View><Text style={{ color: C.purple, fontWeight: '900', fontSize: 24 }}>›</Text>
    </Pressable>;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { minHeight: 76, paddingHorizontal: 22, borderBottomColor: C.border, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logo: { backgroundColor: C.yellow, width: 37, height: 37, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brand: { color: C.white, fontSize: 17, fontWeight: '900', letterSpacing: 1.2 },
  brandCaption: { color: C.muted, fontSize: 10, marginTop: 3 },
  sidebar: { width: 224, borderRightWidth: 1, borderRightColor: C.border, padding: 14, gap: 7 },
  bottomNav: { minHeight: 69, flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 6, paddingVertical: 4 },
  nav: { borderRadius: 12, alignItems: 'center', gap: 5, paddingVertical: 12 },
  eyebrow: { color: C.purple, fontSize: 11, letterSpacing: 3, fontWeight: '800', marginBottom: 9 },
  pageTitle: { fontSize: 29, color: C.white, fontWeight: '900', letterSpacing: -0.5, lineHeight: 39 },
  sectionTitle: { fontSize: 19, color: C.white, fontWeight: '800', marginBottom: 4 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 20 },
  metric: { backgroundColor: C.panel, borderRadius: 16, borderColor: C.border, borderWidth: 1, flexGrow: 1, minWidth: 130, padding: 18, gap: 6 },
  hero: { marginTop: 18, padding: 24, gap: 19, backgroundColor: C.panel2, borderColor: C.purpleDark, borderWidth: 1, borderRadius: 19 },
  heroTitle: { color: C.white, fontSize: 20, fontWeight: '900', lineHeight: 28 },
  panel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 17, padding: 19, gap: 17 },
  panelTitle: { color: C.white, fontSize: 18, fontWeight: '800' },
  formLabel: { color: C.white, fontSize: 13, fontWeight: '700' },
  input: { color: C.white, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, fontSize: 15 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 5 },
  deckTile: { backgroundColor: C.panel, borderRadius: 17, borderWidth: 1, borderColor: C.border, padding: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { color: C.white, fontWeight: '800', fontSize: 16, lineHeight: 24 },
  empty: { backgroundColor: C.panel, padding: 26, borderRadius: 17, gap: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '800' },
  notice: { padding: 13, marginBottom: 17, backgroundColor: C.panel2, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardListItem: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 16, flexDirection: 'row', gap: 12 },
  studyCard: { backgroundColor: C.panel, borderColor: C.purpleDark, borderWidth: 1, borderRadius: 22, padding: 23, gap: 12 },
  studyLabel: { color: C.purple, fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  question: { color: C.white, fontSize: 25, lineHeight: 37, fontWeight: '800', textAlign: 'center' },
  ratings: { gap: 10, marginTop: 16 },
});
