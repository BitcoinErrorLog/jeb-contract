export type NexusNotificationType =
  | "mention"
  | "reply"
  | "follow"
  | "tag_post"
  | "tag_profile"
  | "repost"
  | "post_deleted"
  | "post_edited"
  | "new_friend"
  | "lost_friend"
  | "untag_post";

export interface NexusNotification {
  timestamp: number;
  body: Record<string, unknown> & { type?: string };
}

export interface NexusPostDetails {
  content: string;
  id: string;
  indexed_at: number;
  author: string;
  kind: string;
  uri: string;
  attachments?: unknown[] | null;
  lock?: unknown;
}

export interface NexusPostView {
  details: NexusPostDetails;
  counts?: Record<string, unknown>;
  tags?: unknown[];
  relationships?: {
    replied?: string | null;
    reposted?: string | null;
    mentioned?: string[];
  };
  bookmark?: unknown;
}

export interface NexusUserDetails {
  name: string;
  bio?: string | null;
  id: string;
  links?: unknown[];
  status?: string | null;
  image?: string | null;
  indexed_at?: number;
}

export interface NexusUserView {
  details: NexusUserDetails;
  counts?: Record<string, unknown>;
  tags?: unknown[];
  relationship?: Record<string, unknown>;
}
