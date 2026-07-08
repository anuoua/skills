export interface Message {
  id: string;
  speaker: string;
  content: string;
  timestamp: number;
  type: "message" | "system";
  mention?: string;
  /** When set, only these agents (and the host) may read this message. */
  visibleTo?: string[];
}

export interface AgentState {
  name: string;
  description?: string;
  isHost: boolean;
  online: boolean;
  joinedAt: number;
  lastReadAt: number;
}

export interface ChatEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface RoundState {
  roundNumber: number;
  phase: "idle" | "collecting" | "ordering" | "speaking";
  weights: Record<string, number>;
  order: string[];
  currentSpeakerIndex: number;
  decidedAgentNames: string[];
  excludedAgentNames: string[];
  /** Permanently retired by the host (eliminate). Stays online to spectate. */
  eliminatedAgentNames: string[];
  /** Non-null ⇒ scoped round: only these agents (plus host) may participate. */
  participants: string[] | null;
}

export interface ServerConfig {
  roomName: string;
  port: number;
  /** Directory where the message file (`<room>.<port>.json`) is written. */
  dir: string;
  /** Host established at serve time (skips a separate join). */
  host?: { name: string; description?: string; session: string };
}

/** State for the simultaneous ballot mini-protocol (poll → vote → reveal). */
export interface VoteState {
  active: boolean;
  question: string;
  participants: string[];
  ballots: Record<string, string>;
  decided: string[];
}
