export type Id = string;
export interface Session {
  userId: Id;
  email: string;
  sid: Id;
  accessToken: string;
  csrf: string;
  challengeId?: Id;
}
export interface Conversation {
  id: Id;
  title: string;
  version: Id;
  historyEpoch: Id;
  lastSeq: Id;
  updatedAt: string;
}
export interface Message {
  id: Id;
  seq: Id;
  role: "USER" | "ASSISTANT";
  status: string;
  content: string;
  citations?: string;
  version: Id;
}
export interface Run {
  id: Id;
  conversationId: Id;
  status: string;
  error?: string;
  attempt: number;
  context?: string;
}
export interface ChatPage {
  conversations: Conversation[];
  messages: Message[];
  run?: Run;
  nextCursor: Id;
  hasMore: boolean;
  maxSeq: Id;
  historyEpoch: Id;
  syncSeq: Id;
  context?: string;
}
export interface Document {
  id: Id;
  title: string;
  status: string;
  version: Id;
  sourceUrl?: string;
  error?: string;
  text?: string;
}
export interface KnowledgePage {
  items: Document[];
  nextCursor: Id;
  hasMore: boolean;
}
export interface SyncEvent {
  seq: Id;
  type: string;
  id: Id;
  version: Id;
  targetSid?: Id;
  payload: string;
}
export interface SyncPage {
  items: SyncEvent[];
  highWater: Id;
  hasMore: boolean;
}
export interface Budget {
  window: number;
  inputEstimate: number;
  outputReserve: number;
  safetyReserve: number;
  estimator: string;
  compression: string;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}
