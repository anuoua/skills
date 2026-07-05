export interface Message {
  id: string;
  speaker: string;
  content: string;
  timestamp: number;
  type: "message" | "system";
  mention?: string;
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
}

export interface ServerConfig {
  roomName: string;
  port: number;
  /** Directory where the message file (`<room>.<port>.json`) is written. */
  dir: string;
  /** Host established at serve time (skips a separate join). */
  host?: { name: string; description?: string; session: string };
}
