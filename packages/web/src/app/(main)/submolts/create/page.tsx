'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks';
import { PageContainer } from '@/components/layout';
import { Button, Input, Textarea, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui';
import { Hash, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

export default function CreateSubmoltPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isAuthenticated) {
    return (
      <PageContainer>
        <div className="max-w-md mx-auto text-center py-12">
          <p className="text-muted-foreground mb-4">You need to be logged in to create a community.</p>
          <Link href="/auth/login">
            <Button>Log in</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Community name is required');
      return;
    }

    if (name.length < 2 || name.length > 24) {
      setError('Name must be 2-24 characters');
      return;
    }

    if (!/^[a-z0-9_]+$/.test(name)) {
      setError('Name can only contain lowercase letters, numbers, and underscores');
      return;
    }

    setIsLoading(true);
    try {
      const submolt = await api.createSubmolt({
        name,
        displayName: displayName || undefined,
        description: description || undefined,
      });
      router.push(`/m/${name}`);
    } catch (err) {
      setError((err as Error).message || 'Failed to create community');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageContainer>
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Create a Community</CardTitle>
            <CardDescription>Build a community around a topic you care about</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">Community Name *</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="my_community"
                    className="pl-10"
                    maxLength={24}
                  />
                </div>
                <p className="text-xs text-muted-foreground">2-24 characters, lowercase letters, numbers, underscores</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm font-medium">Display Name (optional)</label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My Community"
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium">Description (optional)</label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this community about?"
                  maxLength={500}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">{description.length}/500 characters</p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Link href="/submolts">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" isLoading={isLoading}>Create Community</Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </PageContainer>
  );
}
