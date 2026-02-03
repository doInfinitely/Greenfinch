'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, MessageSquare, Calendar, User, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { normalizeCommonName } from '@/lib/normalization';

interface Notification {
  id: string;
  type: 'mention' | 'action_due' | 'action_assigned';
  title: string;
  message: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  propertyId: string | null;
  noteId: string | null;
  actionId: string | null;
  sender: {
    firstName: string;
    lastName: string;
    profileImage: string | null;
  } | null;
  propertyAddress: string | null;
  propertyCommonName: string | null;
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/notifications?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'mention':
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      case 'action_due':
        return <Calendar className="w-4 h-4 text-orange-500" />;
      case 'action_assigned':
        return <User className="w-4 h-4 text-green-500" />;
      default:
        return <Bell className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button 
          className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Notifications"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span 
              className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs font-medium rounded-full flex items-center justify-center"
              data-testid="badge-notification-count"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0 bg-white dark:bg-gray-900 border shadow-lg" 
        align="end"
        data-testid="popover-notifications"
      >
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-medium">Notifications</h3>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={markAllRead}
              className="text-xs h-7"
              data-testid="button-mark-all-read"
            >
              <Check className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {isLoading && notifications.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Bell className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map(notification => {
                const propertyDisplayName = notification.propertyCommonName 
                  ? normalizeCommonName(notification.propertyCommonName)
                  : notification.propertyAddress;
                
                return (
                  <div
                    key={notification.id}
                    className={`p-3 hover-elevate cursor-pointer ${!notification.isRead ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      if (!notification.isRead) {
                        markAsRead(notification.id);
                      }
                      if (notification.propertyId) {
                        setIsOpen(false);
                        router.push(`/property/${notification.propertyId}`);
                      }
                    }}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {notification.sender ? (
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={notification.sender.profileImage || ''} />
                            <AvatarFallback className="text-xs bg-gray-100">
                              {notification.sender.firstName?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">
                            {getNotificationIcon(notification.type)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">
                          {notification.title}
                        </p>
                        {notification.message && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {notification.message}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                          </span>
                          {notification.propertyId && propertyDisplayName && (
                            <span className="text-xs text-blue-600 truncate max-w-[150px]">
                              {propertyDisplayName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!notification.isRead && (
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                        )}
                        {notification.propertyId && (
                          <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
