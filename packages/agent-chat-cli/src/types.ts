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

export interface RoomInfo {
  roomName: string;
  port: number;
  host: string | null;
  agents: string[];
  online: number;
  roundNumber: number;
  phase: string;
}

export interface ServerConfig {
  roomName: string;
  port: number;
  dbPath: string;
  markerDir?: string;
}

export interface EventFilter {
  types: string[];
  agentName: string;
}
