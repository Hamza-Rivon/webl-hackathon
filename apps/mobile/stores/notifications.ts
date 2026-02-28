import { create } from 'zustand';

export type AppNotificationType = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  route?: string;
  category?: 'job' | 'pipeline' | 'system' | 'export';
  metadata?: Record<string, unknown>;
}

interface NotificationStore {
  items: AppNotification[];
  unreadCount: number;
  add: (notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_NOTIFICATIONS = 120;

function generateNotificationId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  items: [],
  unreadCount: 0,

  add: (notification) => {
    const id = generateNotificationId();
    const created: AppNotification = {
      ...notification,
      id,
      createdAt: new Date().toISOString(),
      read: false,
    };

    set((state) => {
      const nextItems = [created, ...state.items].slice(0, MAX_NOTIFICATIONS);
      return {
        items: nextItems,
        unreadCount: nextItems.filter((item) => !item.read).length,
      };
    });

    return id;
  },

  markRead: (id) => {
    set((state) => {
      const nextItems = state.items.map((item) =>
        item.id === id ? { ...item, read: true } : item
      );
      return {
        items: nextItems,
        unreadCount: nextItems.filter((item) => !item.read).length,
      };
    });
  },

  markAllRead: () => {
    set((state) => {
      const nextItems = state.items.map((item) => ({ ...item, read: true }));
      return {
        items: nextItems,
        unreadCount: 0,
      };
    });
  },

  remove: (id) => {
    set((state) => {
      const nextItems = state.items.filter((item) => item.id !== id);
      return {
        items: nextItems,
        unreadCount: nextItems.filter((item) => !item.read).length,
      };
    });
  },

  clear: () => {
    set({ items: [], unreadCount: 0 });
  },
}));

export default useNotificationStore;
