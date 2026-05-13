import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { openDatabaseSync } from 'expo-sqlite';
import {
  createWiki,
  WikiProvider,
  useMemoryRead,
  useWikiMaintenance,
  useWikiWrite,
} from '@equationalapplications/expo-llm-wiki';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const DEFAULT_ENTITY = 'user_1';
const DEFAULT_LIVE_URL = 'https://api.openai.com/v1';
const DEFAULT_LOCAL_URL = 'http://localhost:11434';

type ProviderMode = 'sim' | 'live' | 'local';

type BrainConfig = {
  mode: ProviderMode;
  baseUrl: string;
  apiKey?: string;
  providerName?: string;
};

const defaultBrainConfig: BrainConfig = {
  mode: 'sim',
  baseUrl: DEFAULT_LOCAL_URL,
  apiKey: undefined,
  providerName: undefined,
};

function simpleEmbed(text: string): number[] {
  const words = text.trim().split(/\s+/);
  const values = new Array(16).fill(0);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i].toLowerCase();
    let acc = 0;
    for (let j = 0; j < word.length; j += 1) {
      acc += word.charCodeAt(j);
    }
    values[i % values.length] += acc / 255;
  }
  return values.map((value) => Number((Math.tanh(value) * 0.5 + 0.5).toFixed(4)));
}

function simulateLibrarian(input: string) {
  const normalized = input.toLowerCase();
  const facts: Array<{ fact: string; confidence: string; tags?: string[] }> = [];
  const tasks: Array<{ task: string; status: string }> = [];

  const nameMatch = input.match(/name is (\w+)/i);
  if (nameMatch) {
    facts.push({
      fact: `User's name is ${nameMatch[1]}.`,
      confidence: 'certain',
      tags: ['identity'],
    });
  }

  if (normalized.includes('allergic')) {
    facts.push({
      fact: 'User has a potential allergy.',
      confidence: 'tentative',
      tags: ['health'],
    });
  }

  if (normalized.includes('coffee')) {
    facts.push({
      fact: 'User enjoys coffee.',
      confidence: 'certain',
      tags: ['preferences'],
    });
  }

  if (normalized.includes('favorite color') || normalized.includes('favorite colour')) {
    facts.push({
      fact: 'User has shared a color preference.',
      confidence: 'certain',
      tags: ['preference'],
    });
  }

  if (normalized.includes('todo') || normalized.includes('remind') || normalized.includes('remember')) {
    tasks.push({ task: input, status: 'pending' });
  }

  return JSON.stringify({ facts, tasks });
}

function simulateHealer(input: string) {
  const facts: Array<{ id?: string; action?: string; fact?: string; confidence?: string; reason?: string }> = [];
  const lines = input.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const colorFacts = lines.filter((line) => line.toLowerCase().includes('color'));
  if (colorFacts.length > 1) {
    facts.push({
      id: 'color-1',
      action: 'delete',
      reason: 'Superseded by more recent preference.',
    });
    facts.push({
      id: 'color-2',
      action: 'update',
      confidence: 'certain',
    });
  }

  if (input.toLowerCase().includes('allergy') && input.toLowerCase().includes('not')) {
    facts.push({
      id: 'allergy-1',
      action: 'update',
      confidence: 'certain',
      reason: 'Clarified that the allergy was negated.',
    });
  }

  return JSON.stringify({ updates: facts });
}

function createProvider(configRef: React.MutableRefObject<BrainConfig>) {
  return {
    generateText: async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) => {
      const config = configRef.current;
      if (config.mode === 'sim') {
        const target = `${systemPrompt}\n${userPrompt}`.toLowerCase();
        if (target.includes('heal') || target.includes('maintenance')) {
          return simulateHealer(userPrompt);
        }
        return simulateLibrarian(userPrompt);
      }

      const body = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }

      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Provider error: ${response.status} ${text}`);
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? JSON.stringify(json);
      return String(content);
    },
    embed: async (text: string) => {
      return simpleEmbed(text);
    },
  };
}

function BrainSettings({
  visible,
  config,
  onSave,
  onClose,
}: {
  visible: boolean;
  config: BrainConfig;
  onSave: (config: BrainConfig) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ProviderMode>(config.mode);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey ?? '');
  const [providerName, setProviderName] = useState(config.providerName ?? '');

  useEffect(() => {
    setMode(config.mode);
    setBaseUrl(config.baseUrl);
    setApiKey(config.apiKey ?? '');
    setProviderName(config.providerName ?? '');
  }, [config, visible]);

  useEffect(() => {
    if (mode === 'live' && !baseUrl) {
      setBaseUrl(DEFAULT_LIVE_URL);
    }
    if (mode === 'local' && !baseUrl) {
      setBaseUrl(DEFAULT_LOCAL_URL);
    }
  }, [mode]);

  return (
    <Modal animationType="slide" visible={visible} transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Brain Settings</Text>
          <Text style={styles.modalSubtitle}>Choose your provider mode and credentials.</Text>

          <View style={styles.modeRow}>
            {(['sim', 'live', 'local'] as ProviderMode[]).map((option) => (
              <Pressable
                key={option}
                style={[
                  styles.modeButton,
                  mode === option && styles.modeButtonActive,
                ]}
                onPress={() => setMode(option)}
              >
                <Text style={[styles.modeButtonLabel, mode === option && styles.modeButtonLabelActive]}>
                  {option === 'sim' ? 'Simulation' : option === 'live' ? 'OpenAI/Gemini' : 'Local Ollama'}
                </Text>
              </Pressable>
            ))}
          </View>

          {(mode === 'live' || mode === 'local' || mode === 'sim') && (
            <>
              <Text style={styles.fieldLabel}>Provider Name (optional)</Text>
              <TextInput
                style={styles.input}
                value={providerName}
                onChangeText={setProviderName}
                placeholder="e.g. gpt-4o-mini or local-ollama"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}
          {(mode === 'live' || mode === 'local') && (
            <>
              <Text style={styles.fieldLabel}>Base URL</Text>
              <TextInput
                style={styles.input}
                value={baseUrl}
                onChangeText={setBaseUrl}
                placeholder={mode === 'live' ? DEFAULT_LIVE_URL : DEFAULT_LOCAL_URL}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.fieldLabel}>API Key</Text>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Optional API key"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <View style={styles.modalButtonRow}>
            <Button title="Close" onPress={onClose} />
            <Button
              title="Save"
              onPress={() => {
                onSave({
                  mode,
                  baseUrl: baseUrl.trim() || (mode === 'local' ? DEFAULT_LOCAL_URL : DEFAULT_LIVE_URL),
                  apiKey: apiKey.trim() || undefined,
                  providerName: providerName.trim() || undefined,
                });
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

type AppContentProps = {
  config: BrainConfig;
  onSaveConfig: (config: BrainConfig) => void;
  settingsVisible: boolean;
  setSettingsVisible: (visible: boolean) => void;
  eventText: string;
  setEventText: (text: string) => void;
  statusMessage: string;
  setStatusMessage: (message: string) => void;
  isReady: boolean;
  rawEntries: any[];
  rawError: string | null;
  loadRawEntries: () => Promise<void>;
};

function AppContent({
  config,
  onSaveConfig,
  settingsVisible,
  setSettingsVisible,
  eventText,
  setEventText,
  statusMessage,
  setStatusMessage,
  isReady,
  rawEntries,
  rawError,
  loadRawEntries,
}: AppContentProps) {
  const memory = useMemoryRead(DEFAULT_ENTITY, '');
  const write = useWikiWrite();
  const maintenance = useWikiMaintenance();

  const handleWrite = useCallback(async () => {
    if (!eventText.trim()) return;
    setStatusMessage('Writing observation and invoking librarian...');
    try {
      await write.execute(DEFAULT_ENTITY, {
        event_type: 'observation',
        summary: eventText.trim(),
      });
      setEventText('');
      await loadRawEntries();
      memory.refetch();
      setStatusMessage('Observation saved. Facts refreshed.');
    } catch (error) {
      console.warn('Write failed', error);
      setStatusMessage('Failed to write observation. See console.');
    }
  }, [eventText, loadRawEntries, memory, write]);

  const handleRunHeal = useCallback(async () => {
    setStatusMessage('Running heal pass...');
    try {
      await maintenance.runHeal(DEFAULT_ENTITY);
      await loadRawEntries();
      memory.refetch();
      setStatusMessage('Heal complete. Memory refreshed.');
    } catch (error) {
      console.warn('Heal failed', error);
      setStatusMessage('Heal failed. See console.');
    }
  }, [maintenance, loadRawEntries, memory]);

  const handleCopyTemplate = useCallback(async () => {
    const template = `import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { openDatabaseSync } from 'expo-sqlite';
import { createWiki, WikiProvider, useMemoryRead, useWikiWrite } from '@equationalapplications/expo-llm-wiki';

const db = openDatabaseSync('llm-wiki.db');
const wiki = createWiki(db, {
  llmProvider: {
    generateText: async ({ systemPrompt, userPrompt }) => {
      return JSON.stringify({ facts: [], tasks: [] });
    },
    embed: async (text) => new Array(16).fill(0),
  },
});

export default function App() {
  useEffect(() => {
    wiki.setup();
  }, []);

  const memory = useMemoryRead('user_1', '');
  const write = useWikiWrite();

  return (
    <WikiProvider wiki={wiki}>
      <Text>Facts: {memory.data?.facts.length ?? 0}</Text>
    </WikiProvider>
  );
}
`;
    await Clipboard.setStringAsync(template);
    setStatusMessage('Starter template copied to clipboard.');
  }, []);

  const facts = memory.data?.facts ?? [];
  const tasks = memory.data?.tasks ?? [];

  if (!isReady) {
    return (
      <View style={[styles.root, styles.loadingScreen]}>
        <ActivityIndicator size="large" color="#1f2937" />
        <Text style={styles.loadingMessage}>{statusMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <BrainSettings
        visible={settingsVisible}
        config={config}
        onSave={onSaveConfig}
        onClose={() => setSettingsVisible(false)}
      />

      <View style={styles.header}>
        <Text style={styles.title}>Expo LLM Wiki Lab</Text>
        <Text style={styles.subtitle}>
          Mode: {config.mode === 'sim' ? 'Simulation' : config.mode === 'live' ? 'OpenAI/Gemini' : 'Local Ollama'}{config.providerName ? ` · ${config.providerName}` : ''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Event</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            multiline
            value={eventText}
            onChangeText={setEventText}
            placeholder="Write an observation for your librarian..."
          />
          <View style={styles.buttonRow}>
            <Button title="Open Settings" onPress={() => setSettingsVisible(true)} />
            <Button title="Write to Wiki" onPress={handleWrite} disabled={!eventText.trim() || write.isPending || !isReady} />
          </View>
          {write.isPending && <ActivityIndicator style={styles.spinner} />}
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Structured Facts</Text>
          {memory.isPending && <Text style={styles.loadingText}>Refreshing facts...</Text>}
          {facts.length === 0 ? (
            <Text style={styles.emptyText}>No facts yet. Write an observation to extract structured memory.</Text>
          ) : (
            facts.map((fact) => (
              <View key={fact.id} style={styles.card}>
                <Text style={styles.cardTitle}>{fact.body || fact.title || 'Fact'}</Text>
                <Text style={styles.cardMeta}>{fact.confidence} · {fact.tags?.join(', ') ?? 'no tags'}</Text>
              </View>
            ))
          )}
        </View>

        {tasks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Extracted Tasks</Text>
            {tasks.map((task) => (
              <View key={task.id ?? task.description} style={styles.card}>
                <Text style={styles.cardTitle}>{task.description}</Text>
                <Text style={styles.cardMeta}>{task.status}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Healer & Maintenance</Text>
          <Button title="Run Heal" onPress={handleRunHeal} disabled={maintenance.isPending || !isReady} />
          {(maintenance.isPending || maintenance.lastResult) && (
            <Text style={styles.statusText}>
              {maintenance.isPending ? 'Healing...' : `Last operation: ${maintenance.lastResult?.operation}`}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Raw SQLite Debugger</Text>
          <Button title="Refresh DB View" onPress={loadRawEntries} />
          {rawError ? <Text style={styles.errorText}>{rawError}</Text> : null}
          <FlatList
            data={rawEntries}
            keyExtractor={(item, index) => String(item.id ?? index)}
            renderItem={({ item }) => (
              <View style={styles.dbRow}>
                <Text style={styles.dbMeta}>{item.entity_id} · {item.event_type}</Text>
                <Text style={styles.dbBody}>{String(item.summary ?? item.event_payload ?? '')}</Text>
                <Text style={styles.dbTimestamp}>{new Date(Number(item.created_at) || 0).toLocaleString()}</Text>
              </View>
            )}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Footer Tools</Text>
          <Button title="Copy Starter Template" onPress={handleCopyTemplate} />
        </View>
      </ScrollView>
    </View>
  );
}

export default function App() {
  const [config, setConfig] = useState<BrainConfig>(defaultBrainConfig);
  const [settingsVisible, setSettingsVisible] = useState(true);
  const [eventText, setEventText] = useState('My name is Alex and I just had my third cup of coffee.');
  const [statusMessage, setStatusMessage] = useState('Initializing wiki...');
  const [isReady, setIsReady] = useState(false);
  const [rawEntries, setRawEntries] = useState<any[]>([]);
  const [rawError, setRawError] = useState<string | null>(null);

  const db = useMemo(() => openDatabaseSync('llm-wiki.db'), []);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const llmProvider = useMemo(() => createProvider(configRef), []);

  const wiki = useMemo(
    () =>
      createWiki(db, {
        llmProvider,
        config: {
          autoLibrarianThreshold: 10,
          autoHealThreshold: 100,
          maxResults: 12,
          hybridWeight: 0.6,
          preFilterLimit: 32,
        },
        onRetrievalFallback: (error) => console.warn('Retrieval fallback:', error),
      }),
    [db, llmProvider]
  );

  useEffect(() => {
    let isMounted = true;
    async function setup() {
      try {
        setStatusMessage('Setting up SQLite wiki...');
        await wiki.setup();
        if (isMounted) {
          setStatusMessage('Wiki ready. Start writing observations.');
          setIsReady(true);
        }
      } catch (error) {
        console.warn('wiki.setup failed', error);
        if (isMounted) {
          setStatusMessage('Failed to initialize wiki. See console.');
          setIsReady(true);
        }
      }
    }
    setup();
    return () => {
      isMounted = false;
    };
  }, [wiki]);

  const loadRawEntries = useCallback(async () => {
    try {
      const entries = await db.getAllAsync<Record<string, unknown>>(
        'SELECT id, entity_id, event_type, summary, event_payload, metadata, created_at FROM llm_wiki_entries ORDER BY created_at DESC LIMIT 20'
      );
      setRawEntries(entries);
      setRawError(null);
    } catch (error) {
      setRawError(String(error));
      console.warn('Failed to load raw entries', error);
    }
  }, [db]);

  useEffect(() => {
    if (isReady) {
      loadRawEntries();
    }
  }, [isReady, loadRawEntries]);

  return (
    <WikiProvider wiki={wiki}>
      <AppContent
        config={config}
        onSaveConfig={setConfig}
        settingsVisible={settingsVisible}
        setSettingsVisible={setSettingsVisible}
        eventText={eventText}
        setEventText={setEventText}
        statusMessage={statusMessage}
        setStatusMessage={setStatusMessage}
        isReady={isReady}
        rawEntries={rawEntries}
        rawError={rawError}
        loadRawEntries={loadRawEntries}
      />
    </WikiProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f5f7',
  },
  header: {
    paddingTop: 44,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: '#1f2937',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#d1d5db',
    marginTop: 6,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  buttonRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  spinner: {
    marginTop: 10,
  },
  statusText: {
    marginTop: 12,
    color: '#374151',
  },
  loadingScreen: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingMessage: {
    marginTop: 14,
    color: '#334155',
    fontSize: 16,
    textAlign: 'center',
  },
  loadingText: {
    color: '#6b7280',
  },
  emptyText: {
    color: '#6b7280',
    fontStyle: 'italic',
  },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
    backgroundColor: '#fafafa',
  },
  cardTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  cardMeta: {
    color: '#6b7280',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  modalSubtitle: {
    color: '#6b7280',
    marginBottom: 16,
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#111827',
  },
  modeButtonLabel: {
    color: '#111827',
  },
  modeButtonLabelActive: {
    color: '#f9fafb',
  },
  fieldLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  modalButtonRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dbRow: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  dbMeta: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  dbBody: {
    color: '#0f172a',
  },
  dbTimestamp: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 11,
  },
  errorText: {
    color: '#b91c1c',
    marginTop: 10,
  },
});
