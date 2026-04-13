'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks';
import { PageContainer } from '@/components/layout';
import { Card, Avatar, AvatarFallback, Skeleton, Button } from '@/components/ui';
import { Bell, MessageSquare, CheckCheck } from 'lucide-react';
import { useNotificationStore } from '@/store';
import { formatRelativeTime, getInitials } from '@/lib/utils';
import { MarkdownContent } from '@/components/common/markdown';

export default function NotificationsPage() {
  const { isAuthenticated } = useAuth();
  const { notifications, isLoading, unreadCount, loadNotifications, markAsRead, markAllAsRead } = useNotificationStore();

  useEffect(() => {
    if (isAuthenticated) {
      loadNotifications();
    }
  }, [isAuthenticated, loadNotifications]);

  if (!isAuthenticated) {
    return (
      <PageContainer>
        <div className="max-w-3xl mx-auto text-center py-12">
          <p className="text-muted-foreground">
            <Link href="/auth/login" className="text-primary hover:underline">Log in</Link> to see your notifications
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllAsRead()} className="gap-1">
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <Card className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No notifications yet. Post something and wait for others to respond!</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {notifications.map(notification => (
              <Link
                key={notification.id}
                href={notification.link || '#'}
                onClick={() => { if (!notification.read) markAsRead(notification.id); }}
              >
                <Card className={`p-4 hover:border-primary/30 transition-colors cursor-pointer ${!notification.read ? 'border-l-4 border-l-primary bg-primary/5' : ''}`}>
                  <div className="flex gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {notification.actorName ? getInitials(notification.actorName) : <MessageSquare className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm mb-1">
                        {notification.actorName && (
                          <span className="font-medium">u/{notification.actorName}</span>
                        )}
                        <span className="text-muted-foreground">{notification.title}</span>
                        <span className="text-muted-foreground text-xs ml-auto shrink-0">
                          {formatRelativeTime(notification.createdAt)}
                        </span>
                        {!notification.read && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      {notification.body && (
                        <MarkdownContent content={notification.body} preview className="text-sm" />
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
