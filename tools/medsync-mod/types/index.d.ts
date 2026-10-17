// The board both lines share (a file under the git common dir), and this
// session's own values. Declared for `$.state` under `medsync`.

export type Line = {
  id: string;
  label: string;
  sessionId: string;
  status: "online" | "busy" | "offline";
  task: string;
  lastSeen: number;
  branch: string;
};

export type Lock = { file: string; line: string; agent: string; since: number; waiting: string[] };

export type Task = {
  id: string;
  line: string;
  agent: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy: string[];
};

export type CsoItem = {
  n: number;
  line: string;
  at: number;
  file: string;
  kind: "copy" | "i18n" | "override" | "clinical-prompt" | "phi-override";
  summary: string;
  by: string;
  done: boolean;
};

export type Stale = { key: string; langs: string[]; at: number; line: string };

export type StreamItem = { at: number; line: string; kind: string; text: string };

export type Need = {
  id: string;
  line: string;
  kind: "guard" | "lock" | "git" | "ask" | "permission" | "request";
  what: string;
  why: string;
  blocking: boolean;
  options: string[];
  at: number;
};

export type Note = {
  id: string;
  line: string;
  from: string;
  text: string;
  pinned: boolean;
  at: number;
};

export type Traffic = { at: number; from: string; to: string; text: string };

export type Board = {
  lines: Record<string, Line>;
  locks: Record<string, Lock>;
  tasks: Task[];
  cso: CsoItem[];
  csoNext: number;
  stale: Record<string, Stale>;
  stream: StreamItem[];
  needs: Need[];
  notes: Note[];
  traffic: Traffic[];
  checks: Record<string, number>;
  agents: Record<string, Agent[]>;
};

export type Agent = {
  id: string;
  name: string;
  model: string;
  status: "queued" | "running" | "waiting" | "done" | "failed";
  startedAt: number;
  endedAt: number;
  tools: number;
  msgs: number;
  files: string[];
  now: string;
};

export type Route = {
  model: string;
  effort: string;
  reason: string;
  source: "rule" | "model" | "override" | "lock" | "default";
  confidence: number;
  signals: string[];
  text: string;
};

export type Review = {
  original: string;
  score: number;
  checklist: { label: string; ok: boolean }[];
  issues: string[];
  questions: string[];
  improved: string;
  phi: string[];
  isHeld: boolean;
};

export type Local = {
  line: string;
  user: string;
  branch: string;
  surface: string;
  startedAt: number;
  turn: { id: string; n: number; startedAt: number } | null;
  turns: number;
  tests: { passed: number; failed: number; isRunning: boolean; lastFailing: string };
  lastAction: string;
  files: Record<string, { add: number; del: number }>;
  agents: Agent[];
  route: Route | null;
  routes: Route[];
  routeOn: boolean;
  routeLock: { model: string; effort: string } | null;
  overrides: { words: string[]; model: string; effort: string }[];
  downRouted: number;
  review: Review | null;
  reviewOn: boolean;
  threshold: number;
  hints: string[];
  pipeline: { review: string; route: string; transmit: string };
  usage: { context: number | null; plan: number | null };
  checkpoints: { name: string; turn: number; sha: string }[];
};

export type View = {
  view: string;
  mode: "prompt" | "note" | "pin";
  sendOn: string;
  compose: string;
  selected: string;
  open: Record<string, boolean>;
};

declare module "claude-code" {
  interface PluginState {
    medsync: { board: Board; local: Local; view: View };
  }
}
