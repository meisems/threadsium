// Typed client for the Threadsium Worker API. Same-origin, cookie session, CSRF token kept in memory only.

export type ReactionKind = "like" | "bull" | "bear" | "haha" | "eyes";
export const REACTION_KINDS: ReactionKind[] = ["like", "bull", "bear", "haha", "eyes"];

export interface UserLite {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
}

export interface Person extends UserLite {
  bio: string;
  followers?: number;
}

export interface Me extends UserLite {
  bio: string;
  bannerUrl: string | null;
  showConnections: boolean;
  pinnedPostId: string | null;
  createdAt: number;
}

export interface QuotedPost {
  id: string;
  author: UserLite;
  content: string;
  imageUrl: string | null;
  roomAddress: string | null;
  createdAt: number;
}

export interface Post {
  feedId: string;
  id: string;
  author: UserLite;
  content: string;
  imageUrl: string | null;
  roomAddress: string | null;
  tokenRefs: string[];
  createdAt: number;
  sortAt: number;
  editedAt: number | null;
  reactionCount: number;
  replyCount: number;
  repostCount: number;
  shareCount: number;
  reactions: Partial<Record<ReactionKind, number>>;
  viewer: { reaction: ReactionKind | null; reposted: boolean; saved: boolean };
  isQuote: boolean;
  quoted: QuotedPost | null;
  repostedBy: UserLite | null;
}

export interface Reply {
  id: string;
  postId: string;
  parentReplyId: string | null;
  author: UserLite;
  content: string;
  createdAt: number;
  editedAt: number | null;
}

export interface PostPage {
  posts: Post[];
  nextBefore: number | null;
}

export interface RoomToken {
  address: string;
  symbol: string;
  name: string;
  launchpad: string;
  launchpadId?: string | null;
  launchpadUrl: string;
  venueBadge: string;
  description: string;
  featured: boolean;
  isLaunchpadToken?: boolean;
  imageUrl?: string | null;
  hypeDepth: number;
  recentSwaps: number;
  volume24h?: number;
  mcapHype?: number;
  priceHype?: number;
  holders?: number | null;
  createdAt?: number | null;
  sources: string[];
  commentCount: number;
  bullishCount: number;
  bearishCount: number;
  avgRating: number;
  ratingCount: number;
}

export interface TokenMeta {
  address: string;
  symbol: string;
  name: string;
  totalSupply: string;
  decimals: number;
  launchpad: string;
  launchpadId?: string | null;
  launchpadUrl: string;
  venueBadge: string;
  description: string;
  featured: boolean;
  isLaunchpadToken?: boolean;
  imageUrl?: string | null;
  website?: string | null;
  x?: string | null;
  telegram?: string | null;
  holders?: number | null;
  top10Pct?: number | null;
  burnedPct?: number | null;
  creatorShareBps?: number | null;
  buybackBps?: number | null;
  priceHype?: number | null;
  mcapHype?: number | null;
  volume24h?: number | null;
  liquidityHype?: number | null;
  tradeLinks?: Array<{ label: string; url: string; primary?: boolean }>;
  rpcWarning?: string;
}

export interface LaunchpadCoin {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  launchpadId: string;
  launchpadName: string;
  venue: string;
  createdAt: number | null;
  holders: number | null;
  priceHype: number;
  mcapHype: number;
  liquidityHype: number;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  trades1h: number;
  change24h: number | null;
  commentCount: number;
  isLaunchpadToken: boolean;
}

export interface LaunchpadRanking {
  id: string;
  name: string;
  shortName: string;
  site: string | null;
  status: "live" | "pre-mainnet" | "in development";
  summary: string;
  contracts: Array<{ label: string; address: string; role: string }>;
  /** At least one launch contract was verified on-chain and feeds the launch index. */
  verifiedOnChain: boolean;
  /** Launches found by the on-chain index; null when the index is unavailable. */
  indexedLaunches: number | null;
  token: {
    address: string;
    symbol: string;
    name: string;
    evidence: string;
    source: string;
    priceHype: number;
    mcapHype: number;
    liquidityHype: number;
    volume24h: number;
    holders: number | null;
    commentCount: number;
  } | null;
  launches: number;
  launches24h: number;
  launches10Holders: number;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  trades1h: number;
  mcapHype: number;
  liquidityHype: number;
  discussionCount: number;
  topCoins: LaunchpadCoin[];
  newCoins: LaunchpadCoin[];
}

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RoomStats {
  address: string;
  roomId?: string;
  chainId?: number;
  bullish: number;
  bearish: number;
  avgRating: number;
  ratingCount: number;
  voters: number;
  postCount: number;
  myRating: number | null;
  mySentiment: "bullish" | "bearish" | null;
}

export interface RoomSyncResponse {
  room: RoomStats;
  posts: Post[];
  serverTime: number;
}

export interface Profile extends Person {
  bannerUrl: string | null;
  createdAt: number;
  showConnections: boolean;
  pinnedPostId: string | null;
  isSystem: boolean;
}

export interface ProfileResponse {
  profile: Profile;
  counts: { followers: number; following: number; posts: number };
  viewer: { isSelf: boolean; following: boolean; followsYou: boolean };
  pinnedPost: Post | null;
}

export interface Notice {
  id: string;
  type: string;
  message: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
  actor: UserLite | null;
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  readAt: number | null;
  createdAt: number;
}

export interface Thread {
  peer: Person;
  last: Message;
  unread: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrfToken: string | null = null;
let embedSessionToken: string | null = null;

function takeUser(raw: (Me & { csrfToken?: string }) | null, nextSessionToken?: string): Me | null {
  if (!raw) {
    csrfToken = null;
    embedSessionToken = null;
    return null;
  }
  const { csrfToken: token, ...user } = raw;
  if (token) csrfToken = token;
  if (nextSessionToken) embedSessionToken = nextSessionToken;
  return user;
}

async function request<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);
  if (embedSessionToken) headers.set("authorization", `Bearer ${embedSessionToken}`);

  // Reads give up after 15 s; writes are never retried automatically, so a slow post cannot be sent twice.
  const timeout = AbortSignal.timeout(method === "GET" ? 15_000 : 30_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const inEmbed = typeof window !== "undefined" && window.location.pathname.startsWith("/embed/");

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: inEmbed ? "include" : "same-origin",
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError" && init.signal?.aborted) throw e;
    throw new ApiError("Could not reach Threadsium. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new ApiError(data?.error || `The request failed (${res.status}).`, res.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

function pageQuery(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  /* account */
  async me(): Promise<Me | null> {
    const r = await request<{ user: (Me & { csrfToken: string }) | null }>("/api/auth/me");
    return takeUser(r.user);
  },
  async register(username: string, password: string, avatarPreset: string, embed = false): Promise<Me> {
    const r = await request<{ user: Me & { csrfToken: string }; sessionToken?: string }>("/api/auth/register", {
      method: "POST",
      json: { username, password, avatarPreset, ...(embed ? { embed: true } : {}) },
    });
    return takeUser(r.user, r.sessionToken)!;
  },
  async login(username: string, password: string, embed = false): Promise<Me> {
    const r = await request<{ user: Me & { csrfToken: string }; sessionToken?: string }>("/api/auth/login", {
      method: "POST",
      json: { username, password, ...(embed ? { embed: true } : {}) },
    });
    return takeUser(r.user, r.sessionToken)!;
  },
  async logout(): Promise<void> {
    await request("/api/auth/logout", { method: "POST", json: {} });
    csrfToken = null;
    embedSessionToken = null;
  },
  async updateProfile(patch: {
    displayName?: string;
    bio?: string;
    avatarPreset?: string | null;
    avatarUrl?: null;
    bannerUrl?: null;
    showConnections?: boolean;
    walletAddress?: string | null;
    walletSignature?: string;
  }): Promise<Me> {
    const r = await request<{ user: Me & { csrfToken: string } }>("/api/auth/profile", { method: "PATCH", json: patch });
    return takeUser(r.user)!;
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password", { method: "POST", json: { currentPassword, newPassword } }),
  walletChallenge: () => request<{ message: string }>("/api/auth/wallet-challenge", { method: "POST", json: {} }),
  async deleteAccount(password: string): Promise<void> {
    await request("/api/auth/account", { method: "DELETE", json: { password } });
    csrfToken = null;
  },
  insights: () =>
    request<{
      insights: {
        posts: number;
        reactionsReceived: number;
        repostsReceived: number;
        repliesReceived: number;
        sharesReceived: number;
        followers: number;
        following: number;
      };
    }>("/api/me/insights"),
  counts: () => request<{ notifications: number; messages: number }>("/api/me/counts"),

  /* media */
  async upload(file: Blob, kind: "post" | "avatar" | "banner"): Promise<{ url: string; user: Me }> {
    const fd = new FormData();
    fd.append("file", file, "upload");
    const r = await request<{ url: string; user: Me & { csrfToken: string } }>(`/api/media/upload?kind=${kind}`, { method: "POST", body: fd });
    return { url: r.url, user: takeUser(r.user)! };
  },
  limits: () =>
    request<{ media: { backend: string; post: number; avatar: number; banner: number; perAccount: number; siteWide: number } }>("/api/limits"),

  /* feeds and posts */
  posts: (
    q: { feed?: "following"; author?: string; media?: boolean; room?: string; symbol?: string; tag?: string; before?: number | null },
    signal?: AbortSignal,
  ) =>
    request<PostPage>(
      `/api/posts${pageQuery({ feed: q.feed, author: q.author, media: q.media ? 1 : null, room: q.room, symbol: q.symbol, tag: q.tag, before: q.before })}`,
      { signal },
    ),
  saved: (before?: number | null) => request<PostPage>(`/api/me/saved${pageQuery({ before })}`),
  post: (id: string) => request<{ post: Post; replies: Reply[] }>(`/api/posts/${enc(id)}`),
  createPost: (input: { content: string; imageUrl?: string | null; roomAddress?: string | null; quoteOfId?: string | null }) =>
    request<{ post: Post }>("/api/posts", { method: "POST", json: input }),
  editPost: (id: string, content: string) => request<{ post: Post }>(`/api/posts/${enc(id)}`, { method: "PATCH", json: { content } }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${enc(id)}`, { method: "DELETE", json: {} }),
  react: (id: string, kind: ReactionKind | null) =>
    request<{ reaction: ReactionKind | null; reactions: Partial<Record<ReactionKind, number>>; reactionCount: number }>(
      `/api/posts/${enc(id)}/react`,
      { method: "POST", json: { kind } },
    ),
  repost: (id: string) => request<{ reposted: boolean; repostCount: number }>(`/api/posts/${enc(id)}/repost`, { method: "POST", json: {} }),
  save: (id: string) => request<{ saved: boolean }>(`/api/posts/${enc(id)}/save`, { method: "POST", json: {} }),
  share: (id: string) => request<{ shareCount: number }>(`/api/posts/${enc(id)}/share`, { method: "POST", json: {} }),
  pin: (id: string) => request<{ pinnedPostId: string | null }>(`/api/posts/${enc(id)}/pin`, { method: "POST", json: {} }),
  reply: (postId: string, content: string, parentReplyId?: string | null) =>
    request<{ reply: Reply; replyCount: number }>(`/api/posts/${enc(postId)}/replies`, { method: "POST", json: { content, parentReplyId } }),
  editReply: (id: string, content: string) =>
    request<{ content: string; editedAt: number }>(`/api/replies/${enc(id)}`, { method: "PATCH", json: { content } }),
  deleteReply: (id: string) => request<{ removed: number }>(`/api/replies/${enc(id)}`, { method: "DELETE", json: {} }),

  /* rooms, launchpads, and chain data */
  tokens: () => request<{ tokens: RoomToken[]; updatedAt: number }>("/api/tokens"),
  launchpads: () =>
    request<{
      launchpads: LaunchpadRanking[];
      totals: {
        volume24h: number;
        volume1h: number;
        trades24h: number;
        launches: number;
        launches24h: number;
        liquidityHype: number;
        mcapHype: number;
      };
      updatedAt: number;
      launchIndex: { indexedLaunches: number; lagBlocks: number | null } | null;
    }>("/api/launchpads"),
  candles: (address: string, res: "1m" | "5m" | "15m" | "1h" | "1d" = "15m") =>
    request<{ candles: CandlePoint[]; source: string | null }>(`/api/candles/${enc(address)}?res=${res}`),
  price: () => request<{ hypeUsd: number | null; at?: number; source?: string }>("/api/price"),
  tokenMeta: (address: string) =>
    request<TokenMeta>(`/api/token-meta/${enc(address)}`),
  room: (address: string) => request<{ room: RoomStats }>(`/api/rooms/${enc(address)}`),
  roomSync: (address: string, opts: { after?: number; symbol?: string; limit?: number } = {}, signal?: AbortSignal) =>
    request<RoomSyncResponse>(
      `/api/rooms/${enc(address)}/sync${pageQuery({ after: opts.after, symbol: opts.symbol, limit: opts.limit })}`,
      { signal },
    ),
  roomMessage: (address: string, content: string) =>
    request<{ post: Post }>(`/api/rooms/${enc(address)}/messages`, { method: "POST", json: { content } }),
  roomWsUrl: (address: string): string => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/rooms/${enc(address.toLowerCase())}/ws`;
  },
  vote: (address: string, vote: { rating?: number | null; sentiment?: "bullish" | "bearish" | null }) =>
    request<{ room: RoomStats }>(`/api/rooms/${enc(address)}/vote`, { method: "POST", json: vote }),

  /* people */
  profile: (username: string) => request<ProfileResponse>(`/api/profiles/${enc(username)}`),
  profileReplies: (username: string) =>
    request<{ replies: Array<Reply & { postSnippet: string; postAuthor: string }> }>(`/api/profiles/${enc(username)}/replies`),
  follow: (username: string) => request<{ following: boolean; followers: number }>(`/api/profiles/${enc(username)}/follow`, { method: "POST", json: {} }),
  connections: (username: string, tab: "followers" | "following") =>
    request<{ hidden: boolean; people: Person[] }>(`/api/profiles/${enc(username)}/connections?tab=${tab}`),
  search: (q: string, signal?: AbortSignal) => request<{ users: Person[]; posts: Post[] }>(`/api/search?q=${enc(q)}`, { signal }),
  discover: () => request<{ people: Person[]; tags: { tag: string; posts: number }[] }>("/api/discover"),

  /* notifications and messages */
  notifications: () => request<{ retentionHours: number; notifications: Notice[] }>("/api/notifications"),
  markNotificationsRead: () => request<{ ok: boolean }>("/api/notifications/read", { method: "POST", json: {} }),
  threads: () => request<{ threads: Thread[] }>("/api/messages"),
  conversation: (username: string) => request<{ peer: Person; messages: Message[] }>(`/api/messages/${enc(username)}`),
  sendMessage: (username: string, content: string) =>
    request<{ message: Message }>(`/api/messages/${enc(username)}`, { method: "POST", json: { content } }),
  markConversationRead: (username: string) => request<{ ok: boolean }>(`/api/messages/${enc(username)}/read`, { method: "POST", json: {} }),

  status: () =>
    request<{
      ok: boolean;
      storage: { relational: string; media: string; cache: string };
      counts: { users: number; posts: number; mediaObjects: number; mediaBytes: number };
      limits: { postChars: number; replyChars: number; messageChars: number; notificationHours: number };
    }>("/api/status"),
};
