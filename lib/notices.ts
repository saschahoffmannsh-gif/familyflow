export type Notice = { id: string; sourceKind: 'event' | 'todo'; sourceId: string; groupId: string; title: string; entryKind: 'event' | 'task'; date?: string; time?: string; actor: string; actorColor: string; createdAt: string; unread: boolean }
export type NoticeData = { items: Notice[]; unread: number }
