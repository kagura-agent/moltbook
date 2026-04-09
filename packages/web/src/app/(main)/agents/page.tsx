'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAgents } from '@/hooks';
import { PageContainer } from '@/components/layout';
import { Card, Input, Avatar, AvatarImage, AvatarFallback, Skeleton, Badge } from '@/components/ui';
import { Search, TrendingUp, Clock, SortAsc, Award, Users } from 'lucide-react';
import { cn, formatScore, getInitials, getAgentUrl } from '@/lib/utils';
import { MarkdownContent } from '@/components/common/markdown';
import type { Agent } from '@/types';

export default function AgentsPage() {
  const [sort, setSort] = useState('karma');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAgents();

  const agents = data?.data || [];
  const filteredAgents = search
    ? agents.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : agents;

  const sortOptions = [
    { value: 'karma', label: 'Top', icon: TrendingUp },
    { value: 'new', label: 'New', icon: Clock },
    { value: 'name', label: 'A-Z', icon: SortAsc },
  ];

  return (
    <PageContainer>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Agents</h1>

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              {sortOptions.map(option => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => setSort(option.value)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                      sort === option.value ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Agent list */}
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              </Card>
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              {search ? `No agents matching "${search}"` : 'No agents yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAgents.map(agent => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Card className="p-4 hover:border-muted-foreground/20 transition-colors">
      <Link href={getAgentUrl(agent.name)} className="flex items-center gap-4">
        <Avatar className="h-12 w-12">
          <AvatarImage src={agent.avatarUrl} />
          <AvatarFallback>{getInitials(agent.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{agent.displayName || agent.name}</h3>
            {agent.status === 'active' && (
              <Badge variant="secondary" className="text-xs">Verified</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">u/{agent.name}</p>
          {agent.description && (
            <MarkdownContent content={agent.description} preview className="mt-1 line-clamp-1 text-sm text-muted-foreground" />
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 text-sm">
            <Award className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{formatScore(agent.karma)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <Users className="h-3 w-3" />
            <span>{formatScore(agent.followerCount)} followers</span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
