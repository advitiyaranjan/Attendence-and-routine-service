/**
 * Copilot conversation state, shared by the side panel and the full page.
 *
 * Flow per message:
 *   text → POST /api/ai/command (context filtered by AI permissions)
 *        → validated intents → permission check → prepareAction (resolve, conflicts)
 *        → proposal cards awaiting confirmation / clarification / refusal
 */
import { create as createStore } from 'zustand';
import { v4 as uuid } from 'uuid';
import { actionAllowed, PERMISSION_LABEL, todayISO, type AIIntent, type ActionName } from '@student-os/core';
import { api, ApiError } from '../api';
import type { AttachmentMeta, PreparedAttachment } from './attachments';
import { kvGet, kvSet } from '../db';
import { loadSettings } from '../queries';
import { buildCommandContext } from './context';
import { editParams, prepareAction, type ClarifyOption, type FieldType, type Prepared, type Proposal } from './registry';
import { cancelProposal, confirmProposal, undoLog } from './run';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  proposals?: Proposal[];
  clarification?: { question: string; options: ClarifyOption[]; answered?: boolean };
  notices?: string[];
  links?: Array<{ label: string; href: string }>;
  /** Files the student attached (metadata + image thumbnails; the files themselves aren't stored). */
  attachments?: AttachmentMeta[];
  quiz?: { topic: string; count: 5 | 10 | 20; difficulty: 'easy' | 'medium' | 'hard' | 'mixed'; autoStart: boolean; started: boolean };
}

interface CommandResponse {
  reply: string;
  intents: AIIntent[];
  rejected: Array<{ action: string; reason: string }>;
  clarification: { question: string; options: string[] } | null;
}

interface CopilotState {
  messages: CopilotMessage[];
  busy: boolean;
  open: boolean;
  loaded: boolean;
  load(): Promise<void>;
  setOpen(open: boolean): void;
  send(text: string, files?: PreparedAttachment[]): Promise<void>;
  choose(messageId: string, option: ClarifyOption): Promise<void>;
  confirm(messageId: string, proposalId: string): Promise<void>;
  cancel(messageId: string, proposalId: string): Promise<void>;
  edit(messageId: string, proposalId: string, path: string, value: string, type: FieldType): Promise<string | null>;
  toggleItem(messageId: string, proposalId: string, key: string): void;
  undo(messageId: string, proposalId: string): Promise<void>;
  markQuizStarted(messageId: string): void;
  clear(): Promise<void>;
}

const HISTORY_KEY = 'copilot.history';

/** Transcript for the model, with pending proposals annotated so follow-ups ("make it 2 hours") work. */
function transcript(messages: CopilotMessage[]) {
  return messages.slice(-16).map((m) => {
    let content = m.content;
    if (m.attachments?.length) content += `\n[attached: ${m.attachments.map((a) => a.name).join(', ')}]`;
    for (const p of m.proposals ?? []) {
      if (p.status === 'pending') content += `\n[pending proposal: ${p.action} ${JSON.stringify(p.params)}]`;
      else if (p.status === 'confirmed') content += `\n[done: ${p.action} — ${p.result ?? ''}]`;
    }
    if (m.clarification) content += `\n[asked: ${m.clarification.question}]`;
    return { role: m.role, content: content.slice(0, 8000) || '(no text)' };
  });
}

/** Turn prepared results into message parts. */
function apply(msg: CopilotMessage, prepared: Prepared, autoQuiz: boolean) {
  switch (prepared.kind) {
    case 'proposal':
      (msg.proposals ??= []).push(prepared.proposal);
      break;
    case 'clarify':
      msg.clarification = { question: prepared.question, options: prepared.options };
      break;
    case 'error':
      (msg.notices ??= []).push(prepared.message);
      break;
    case 'link':
      (msg.links ??= []).push({ label: prepared.label, href: prepared.href });
      break;
    case 'quiz':
      msg.quiz = { topic: prepared.topic, count: prepared.count, difficulty: prepared.difficulty, autoStart: autoQuiz, started: false };
      break;
  }
}

export const useCopilot = createStore<CopilotState>((set, get) => {
  const persist = () => void kvSet(HISTORY_KEY, get().messages.slice(-60));
  const patchProposal = (messageId: string, proposalId: string, fn: (p: Proposal) => Proposal) => {
    set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposalId ? fn(p) : p)) } : m)),
    });
    persist();
  };
  const findProposal = (messageId: string, proposalId: string) => get().messages.find((m) => m.id === messageId)?.proposals?.find((p) => p.id === proposalId);
  const append = (m: CopilotMessage) => {
    set({ messages: [...get().messages, m] });
    persist();
  };

  return {
    messages: [],
    busy: false,
    open: false,
    loaded: false,

    async load() {
      if (get().loaded) return;
      const history = (await kvGet<CopilotMessage[]>(HISTORY_KEY)) ?? [];
      set({ messages: history, loaded: true });
    },

    setOpen(open) {
      set({ open });
    },

    async send(text, files = []) {
      const content = text.trim() || (files.length ? 'Please look at the attached file(s).' : '');
      if (!content || get().busy) return;
      await get().load();
      const user: CopilotMessage = {
        id: uuid(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        ...(files.length ? { attachments: files.map((f) => f.meta) } : {}),
      };
      append(user);
      const reply: CopilotMessage = { id: uuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() };

      const settings = await loadSettings();
      if (!settings.aiPermissions.enabled) {
        append({ ...reply, content: 'AI Pilot is turned off in Settings → AI permissions.' });
        return;
      }
      if (!navigator.onLine) {
        append({ ...reply, content: 'AI requires an internet connection.\nYour local academic data is still available everywhere else in the app.' });
        return;
      }

      set({ busy: true });
      try {
        const payload = { messages: transcript(get().messages), context: await buildCommandContext(), today: todayISO(), permissions: settings.aiPermissions };
        let form: FormData | undefined;
        if (files.length) {
          form = new FormData();
          form.append('payload', JSON.stringify(payload));
          for (const f of files) form.append('files', f.file, f.file.name);
        }
        const res = await api<CommandResponse>('/api/ai/command', form ? { form } : { body: payload });
        reply.content = res.reply;
        for (const intent of res.intents) {
          const { ok, missing } = actionAllowed(intent.action, settings.aiPermissions);
          if (!ok) {
            (reply.notices ??= []).push(`I can't do that without permission: ${missing.map((m) => PERMISSION_LABEL[m]).join(', ')} (Settings → AI permissions).`);
            continue;
          }
          apply(reply, await prepareAction(intent.action, intent.params as Record<string, unknown>), settings.aiPermissions.instantReadOnly);
        }
        for (const r of res.rejected) {
          (reply.notices ??= []).push(r.reason.startsWith('Not permitted') ? `I can't do that: ${r.reason.replace('Not permitted: ', '')} is turned off in Settings → AI permissions.` : `I skipped an invalid suggestion (${r.action}).`);
        }
        if (res.clarification && !reply.clarification) {
          reply.clarification = { question: res.clarification.question, options: res.clarification.options.map((o) => ({ label: o, send: o })) };
        }
        if (!reply.content && !reply.proposals?.length && !reply.clarification && !reply.notices?.length) reply.content = "I'm not sure how to help with that.";

        // A corrected proposal replaces the earlier pending one of the same kind.
        const newActions = new Set((reply.proposals ?? []).map((p) => p.action));
        set({
          messages: get().messages.map((m) =>
            m.proposals?.some((p) => p.status === 'pending' && newActions.has(p.action))
              ? { ...m, proposals: m.proposals.map((p) => (p.status === 'pending' && newActions.has(p.action) ? { ...p, status: 'superseded' as const } : p)) }
              : m,
          ),
        });
        append(reply);
      } catch (err) {
        append({ ...reply, content: err instanceof ApiError ? `⚠ ${err.message}` : '⚠ Something went wrong. Please try again.' });
      } finally {
        set({ busy: false });
      }
    },

    async choose(messageId, option) {
      set({ messages: get().messages.map((m) => (m.id === messageId && m.clarification ? { ...m, clarification: { ...m.clarification, answered: true } } : m)) });
      if (option.send) return get().send(option.send);
      if (!option.action || !option.params) return;
      append({ id: uuid(), role: 'user', content: option.label, createdAt: new Date().toISOString() });
      const msg: CopilotMessage = { id: uuid(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
      const settings = await loadSettings();
      apply(msg, await prepareAction(option.action as ActionName, option.params), settings.aiPermissions.instantReadOnly);
      append(msg);
    },

    async confirm(messageId, proposalId) {
      const p = findProposal(messageId, proposalId);
      if (!p || p.status !== 'pending') return;
      if (p.items && !p.items.some((i) => i.selected)) return;
      patchProposal(messageId, proposalId, (x) => ({ ...x, status: 'confirmed', result: 'Applying…' }));
      const done = await confirmProposal(p);
      patchProposal(messageId, proposalId, () => done);
    },

    async cancel(messageId, proposalId) {
      const p = findProposal(messageId, proposalId);
      if (!p || p.status !== 'pending') return;
      const done = await cancelProposal(p);
      patchProposal(messageId, proposalId, () => done);
    },

    async edit(messageId, proposalId, path, value, type) {
      const p = findProposal(messageId, proposalId);
      if (!p) return 'Not found';
      const edited = editParams(p.action, p.params, path, value, type);
      if (!edited.ok) return edited.error;
      const prepared = await prepareAction(p.action, edited.params);
      if (prepared.kind !== 'proposal') return prepared.kind === 'error' ? prepared.message : 'That change needs clarification. Ask AI Pilot instead.';
      patchProposal(messageId, proposalId, () => ({ ...prepared.proposal, id: p.id }));
      return null;
    },

    toggleItem(messageId, proposalId, key) {
      patchProposal(messageId, proposalId, (p) => ({ ...p, items: p.items?.map((i) => (i.key === key ? { ...i, selected: !i.selected } : i)) }));
    },

    async undo(messageId, proposalId) {
      const p = findProposal(messageId, proposalId);
      if (!p?.logId) return;
      const r = await undoLog(p.logId);
      patchProposal(messageId, proposalId, (x) => ({
        ...x,
        status: 'undone',
        result: r.skipped.length ? `Undone (${r.skipped.length} item(s) had changed since and were kept)` : 'Undone',
      }));
    },

    markQuizStarted(messageId) {
      set({ messages: get().messages.map((m) => (m.id === messageId && m.quiz ? { ...m, quiz: { ...m.quiz, started: true } } : m)) });
      persist();
    },

    async clear() {
      set({ messages: [] });
      await kvSet(HISTORY_KEY, []);
    },
  };
});
