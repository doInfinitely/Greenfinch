export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  clerkOrgId: string;
  messages: ChatMessage[];
  escalated: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TicketStatus = 'open' | 'in_progress' | 'resolved';
export type TicketPriority = 'low' | 'medium' | 'high';
