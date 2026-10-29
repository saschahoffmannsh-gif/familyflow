import type { ChatEntry } from './discussions'

export type InboxType = 'message' | 'image' | 'audio' | 'shared' | 'created' | 'changed' | 'cancelled'
export type InboxItem = {
  threadId: string; entry: ChatEntry; canOpen: boolean; shareToken?: string
  activityId: string; createdAt: string; type: InboxType; preview: string
  author: string; authorId: string; color: string; unread: number; types: InboxType[]; changePreview?: string
}
export type InboxData = { items: InboxItem[]; unread: number }
