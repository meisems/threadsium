// Typed client for the Threadsium Worker API. Same-origin, cookie session, CSRF token kept in memory only.
import type { Badge, BadgeColor, Tier, TierLimits } from "../config/premium";

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
  /** basic, premium (1M THREADSIUM) or max (10M). */
  tier: Tier;
  /** Holds at least 1,000,000 THREADSIUM in the verified wallet (Premium or Premium Max). */
  premium: boolean;
  /** The premium badge to draw; null unless premium. */
  badge: Badge | null;
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
  premiumUntil: number | null;
  /** Tier bought with HYPE, independent of the wallet balance, and when it ends. */
  paidTier: Tier;
  paidUntil: number | null;
  /** The badge this account picked, kept while premium lapses; null means the default blue check. */
  badgeChoice: Badge | null;
  /** False for accounts made with a wallet that have not added a password. */
  hasPassword: boolean;
}

export interface PremiumQuote {
  id: string;
  tier: "premium" | "max";
  tokens: number;
  priceHype: number;
  source: string;
  amountWei: string;
  amountHype: string;
  treasury: string;
  wallet: string;
  days: number;
  createdAt: number;
  expiresAt: number;
  paidUntilAfter: number;
}

export interface PremiumPayment {
  tier: Tier;
  until: number;
  valueHype?: string;
  txHash?: string;
  already?: boolean;
}

export interface PremiumStatus {
  symbol: string;
  tokenAddress: string | null;
  minTokens: number;
  maxMinTokens: number;
  recheckHours: number;
  graceHours: number;
  limits: Record<Tier, TierLimits>;
  glyphs: string[];
  colors: Record<BadgeColor, string>;
  pay: { available: boolean; treasury: string; days: number; quoteMinutes: number; priceSource: string };
  me: null | {
    tier: Tier;
    heldTier: Tier;
    heldUntil: number | null;
    paidTier: Tier;
    paidUntil: number | null;
    premium: boolean;
    premiumUntil: number | null;
    checkedAt: number | null;
    /** Whole THREADSIUM from the last balance read. */
    balance: string | null;
    walletAddress: string | null;
    walletVerified: boolean;
    badge: Badge | null;
  };
}

/** Either the account password or a fresh wallet confirmation (see lib/siwe.ts walletConfirmation). */
export type IdentityProof = { password: string } | { walletMessage: string; walletSignature: string };

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

/** [minute start (unix s), open, high, low, close, volume] in HYPE. */
export type MarketBar = [number, number, number, number, number, number];

export interface MarketSwap {
  t: number;
  block: number;
  logIndex: number;
  priceHype: number;
  hype: number;
  side: "buy" | "sell";
  tx: string;
  venue: string;
  priced: boolean;
}

/** GET /api/market/:address — price, supply, market cap and candles read from Elysium (worker/market.ts). */
export interface MarketData {
  address: string;
  decimals: number;
  priceHype: number | null;
  priceUsd: number | null;
  hypeUsd: number | null;
  totalSupply: number;
  burned: number;
  circulating: number;
  mcapHype: number | null;
  mcapUsd: number | null;
  fdvHype: number | null;
  fdvUsd: number | null;
  liquidityHype: number;
  volume24hHype: number | null;
  pools: { venue: string; kind: "v4" | "v3"; id: string; priceHype: number | null; depthHype: number; priced: boolean }[];
  res: "1m" | "15m" | "1h";
  bars: MarketBar[];
  swaps: MarketSwap[];
  coverage: { fromBlock: number; toBlock: number; complete: boolean };
  updatedAt: number;
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

/** A Send / tip, as the server read it back from the transaction receipt. */
export interface TransferInfo {
  hash: string;
  /** Token contract, or null for native HYPE. */
  token: string | null;
  symbol: string;
  decimals: number;
  /** Raw amount in the token's smallest unit. */
  amount: string;
  from: string;
  to: string;
  blockNumber: number;
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  readAt: number | null;
  createdAt: number;
  transfer?: TransferInfo | null;
}

export type WhaleSignalType = "WHALE_BUY" | "FRESH_BUY" | "ACCUMULATION" | "CLUSTER";

export interface WhaleSignal {
  id: number;
  type: WhaleSignalType;
  token: string;
  symbol: string | null;
  wallet: string | null;
  clusterWallets: string[] | null;
  fundedBy: string | null;
  amountHype: number | null;
  amountUsd: number | null;
  launchpad: string;
  txHash: string;
  blockNumber: number;
  time: number;
  walletNonce: number | null;
  walletFundedAt: number | null;
  buyCount: number | null;
}

/** A buy of at least minBuyHype, as the Whale watch indexer stored it. */
export interface WhaleBuy {
  txHash: string;
  blockNumber: number;
  time: number;
  wallet: string;
  token: string;
  symbol: string | null;
  side: string;
  amountHype: number | null;
  baseAsset: string;
  launchpad: string;
  walletNonce: number | null;
  fresh: boolean | null;
}

export interface WhalesResponse {
  /** "indexer": every block, every buy of 5 HYPE and up, clusters; "scan": the on-demand fallback. */
  source: "indexer" | "scan";
  sourceNote: string;
  signals: WhaleSignal[];
  buys: WhaleBuy[];
  minBuyHype: number | null;
  counts: Record<WhaleSignalType, number> | null;
  indexer: { mode: string; lagSeconds: number | null; node: string; nodes: string[]; fundingLookups: string; error: string | null } | null;
  window: { fromBlock: number; toBlock: number; fromTime: number | null; toTime: number | null } | null;
  scanned: { buys: number; sells: number; txs: number; truncated: boolean } | null;
  thresholds: { whaleMinHype: number; freshMinHype: number; freshMaxNonce: number; accumMinBuys: number; accumWindowMin: number };
  unavailable: WhaleSignalType[];
  hypeUsd: number | null;
  updatedAt: number;
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

async function request<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);
  if (embedSessionToken) headers.set("authorization", `Bearer ${embedSessionToken}`);

  // Reads give up after 15 s; writes are never retried automatically, so a slow post cannot be sent twice.
  const timeout = AbortSignal.timeout(init.timeoutMs ?? (method === "GET" ? 15_000 : 30_000));
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
  siweNonce: (purpose: "signin" | "reauth" = "signin") =>
    request<{ nonce: string; issuedAt: string; expiresAt: string; chainId: number; statement: string }>("/api/auth/siwe/nonce", {
      method: "POST",
      json: { purpose },
    }),
  async siweVerify(message: string, signature: string): Promise<{ user: Me } | { needsUsername: true; address: string; signupToken: string }> {
    const r = await request<{ user?: Me & { csrfToken: string }; needsUsername?: true; address?: string; signupToken?: string }>("/api/auth/siwe/verify", {
      method: "POST",
      json: { message, signature },
    });
    if (r.user) return { user: takeUser(r.user)! };
    return { needsUsername: true, address: r.address ?? "", signupToken: r.signupToken ?? "" };
  },
  async siweRegister(signupToken: string, username: string, avatarPreset: string): Promise<Me> {
    const r = await request<{ user: Me & { csrfToken: string } }>("/api/auth/siwe/register", {
      method: "POST",
      json: { signupToken, username, avatarPreset },
    });
    return takeUser(r.user)!;
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
  /** Changes the password, or adds the first one to a wallet account (proved with a wallet confirmation instead). */
  changePassword: (proof: IdentityProof, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password", {
      method: "POST",
      json: "password" in proof ? { currentPassword: proof.password, newPassword } : { ...proof, newPassword },
    }),
  walletChallenge: () => request<{ message: string }>("/api/auth/wallet-challenge", { method: "POST", json: {} }),
  async deleteAccount(proof: IdentityProof): Promise<void> {
    await request("/api/auth/account", { method: "DELETE", json: proof });
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

  /* premium */
  premium: () => request<PremiumStatus>("/api/premium"),
  async refreshPremium(): Promise<{ user: Me; status: PremiumStatus }> {
    const r = await request<PremiumStatus & { user: Me & { csrfToken: string } }>("/api/premium/refresh", { method: "POST", json: {} });
    const { user, ...status } = r;
    return { user: takeUser(user)!, status };
  },
  premiumQuote: (tier: "premium" | "max") => request<{ quote: PremiumQuote }>("/api/premium/quote", { method: "POST", json: { tier } }),
  async premiumPay(txHash: string, quoteId?: string | null): Promise<{ pending: true; message: string } | { pending: false; user: Me; payment: PremiumPayment }> {
    const r = await request<{ pending?: boolean; message?: string; user?: Me & { csrfToken: string }; payment?: PremiumPayment }>("/api/premium/pay", {
      method: "POST",
      json: quoteId ? { txHash, quoteId } : { txHash },
    });
    if (r.pending || !r.user) return { pending: true, message: r.message ?? "Waiting for the transaction to confirm." };
    return { pending: false, user: takeUser(r.user)!, payment: r.payment! };
  },
  async setBadge(badge: Badge | null): Promise<Me> {
    const r = await request<{ user: Me & { csrfToken: string } }>("/api/premium/badge", {
      method: "PATCH",
      json: badge ? { icon: badge.icon, color: badge.color, tintName: !!badge.tintName } : { reset: true },
    });
    return takeUser(r.user)!;
  },

  /* media */
  async upload(file: Blob, kind: "post" | "avatar" | "banner" | "badge"): Promise<{ url: string; user: Me }> {
    const fd = new FormData();
    fd.append("file", file, "upload");
    const r = await request<{ url: string; user: Me & { csrfToken: string } }>(`/api/media/upload?kind=${kind}`, { method: "POST", body: fd });
    return { url: r.url, user: takeUser(r.user)! };
  },
  limits: () =>
    request<{ media: { backend: string; post: number; avatar: number; banner: number; badge: number; perAccount: number; siteWide: number } }>("/api/limits"),

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
  market: (address: string, res: "1m" | "15m" | "1h" = "15m", signal?: AbortSignal) =>
    request<MarketData>(`/api/market/${enc(address)}?res=${res}`, { signal, timeoutMs: 30_000 }),
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
  /** Records a mined Send / tip in the conversation; the server checks it against the receipt first. */
  recordTransfer: (username: string, input: { hash: string; token: string | null; note?: string }) =>
    request<{ message: Message }>(`/api/messages/${enc(username)}/transfer`, { method: "POST", json: input }),

  /* Whale watch: whale and fresh-wallet signals */
  whales: (q: { token?: string; type?: WhaleSignalType | null } = {}, signal?: AbortSignal) =>
    // An uncached scan reads a few hundred chain records, so it gets longer than the usual 15 s.
    request<WhalesResponse>(`/api/whales${pageQuery({ token: q.token, type: q.type })}`, { signal, timeoutMs: 45_000 }),

  status: () =>
    request<{
      ok: boolean;
      storage: { relational: string; media: string; cache: string };
      counts: { users: number; posts: number; mediaObjects: number; mediaBytes: number };
      limits: { postChars: number; replyChars: number; messageChars: number; notificationHours: number };
    }>("/api/status"),
};
