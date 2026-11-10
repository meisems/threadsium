import { SEEDED_TOKENS } from "../config/tokens";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarId: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
  showConnections: boolean;
  pinnedPostId: string | null;
  createdAt: string;
}

export interface PostItem {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  avatarUrl: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
  content: string;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  imageUrl: string | null;
  quotedPostId: string | null;
  quotedPost?: {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    avatarId: string;
    avatarUrl: string | null;
    content: string;
    tokenAddress: string | null;
    tokenSymbol: string | null;
    imageUrl: string | null;
    createdAt: string;
  } | null;
  repostedBy?: {
    userId: string;
    username: string;
    displayName: string;
    repostedAt: string;
  } | null;
  editedAt: string | null;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  shareCount: number;
  viewerLiked: boolean;
  viewerReposted: boolean;
}

export interface ReplyItem {
  id: string;
  postId?: string;
  tokenAddress?: string;
  tokenSymbol?: string | null;
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  avatarUrl: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
  parentId: string | null;
  content: string;
  imageUrl: string | null;
  editedAt: string | null;
  createdAt: string;
}

export interface DirectoryToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  launchpad: string;
  launchpadUrl: string;
  tagline: string;
  featured: boolean;
  reserveWhype: number;
  poolCount: number;
  venues: string[];
  priceHype: number | null;
  commentCount: number;
  ratingAvg: number;
  ratingCount: number;
  bullishCount: number;
  bearishCount: number;
  bullishPct: number;
}

let csrfTokenMemory: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfTokenMemory = token;
}

export function getCsrfToken(): string | null {
  return csrfTokenMemory;
}

function toIso(val: unknown): string {
  if (typeof val === "number") return new Date(val).toISOString();
  if (typeof val === "string") {
    const n = Number(val);
    if (!Number.isNaN(n) && n > 1_000_000_000_000) return new Date(n).toISOString();
    return val;
  }
  return new Date().toISOString();
}

function mapUser(raw: any): AuthUser {
  return {
    id: String(raw.id),
    username: String(raw.username),
    displayName: String(raw.displayName || raw.username),
    bio: String(raw.bio || ""),
    avatarId: String(raw.avatarPreset || raw.avatarId || "kinepip-samurai"),
    avatarUrl: raw.avatarUrl || null,
    bannerUrl: raw.bannerUrl || null,
    walletAddress: raw.walletAddress || null,
    walletVerified: Boolean(raw.walletVerified),
    showConnections: raw.showConnections !== false,
    pinnedPostId: raw.pinnedPostId || null,
    createdAt: toIso(raw.createdAt),
  };
}

function resolveRefs(refs: string[] = []): {
  tokenAddress: string | null;
  tokenSymbol: string | null;
} {
  let tokenAddress: string | null = null;
  let tokenSymbol: string | null = null;
  for (const r of refs) {
    if (/^0x[a-fA-F0-9]{40}$/.test(r)) {
      tokenAddress = r.toLowerCase();
      const s = SEEDED_TOKENS.find((t) => t.address.toLowerCase() === tokenAddress);
      if (s && !tokenSymbol) tokenSymbol = s.symbol;
    } else if (!r.startsWith("#") && /^[A-Z0-9_]{1,12}$/.test(r)) {
      if (!tokenSymbol) tokenSymbol = r;
      const s = SEEDED_TOKENS.find((t) => t.symbol.toUpperCase() === r.toUpperCase());
      if (s && !tokenAddress) tokenAddress = s.address.toLowerCase();
    }
  }
  return { tokenAddress, tokenSymbol };
}

function mapPost(raw: any): PostItem {
  const isPureRepost = Boolean(raw.repostOfId && !raw.isQuote && raw.originalPost);
  const source = isPureRepost ? raw.originalPost : raw;
  const author = source.author || {};
  const { tokenAddress, tokenSymbol } = resolveRefs(source.tokenRefs || []);

  let quotedPost: PostItem["quotedPost"] = null;
  if (raw.isQuote && raw.originalPost) {
    const qa = raw.originalPost.author || {};
    const qRefs = resolveRefs(raw.originalPost.tokenRefs || []);
    quotedPost = {
      id: String(raw.originalPost.id),
      userId: String(qa.id || raw.originalPost.authorId),
      username: String(qa.username || "operator"),
      displayName: String(qa.displayName || qa.username || "Operator"),
      avatarId: String(qa.avatarPreset || "kinepip-samurai"),
      avatarUrl: qa.avatarUrl || null,
      content: String(raw.originalPost.content || ""),
      tokenAddress: qRefs.tokenAddress,
      tokenSymbol: qRefs.tokenSymbol,
      imageUrl: raw.originalPost.imageUrl || null,
      createdAt: toIso(raw.originalPost.createdAt),
    };
  }

  return {
    id: String(source.id),
    userId: String(author.id || source.authorId),
    username: String(author.username || "operator"),
    displayName: String(author.displayName || author.username || "Operator"),
    avatarId: String(author.avatarPreset || "kinepip-samurai"),
    avatarUrl: author.avatarUrl || null,
    walletAddress: author.walletAddress || null,
    walletVerified: Boolean(author.walletVerified),
    content: String(source.content || ""),
    tokenAddress,
    tokenSymbol,
    imageUrl: source.imageUrl || null,
    quotedPostId: quotedPost ? quotedPost.id : null,
    quotedPost,
    repostedBy: isPureRepost
      ? {
          userId: String(raw.author?.id || raw.authorId),
          username: String(raw.author?.username || "operator"),
          displayName: String(raw.author?.displayName || raw.author?.username || "Operator"),
          repostedAt: toIso(raw.createdAt),
        }
      : null,
    editedAt: source.updatedAt ? toIso(source.updatedAt) : null,
    createdAt: toIso(source.createdAt),
    likeCount: Number(source.likeCount || 0),
    repostCount: Number(source.repostCount || 0),
    replyCount: Number(source.replyCount || 0),
    shareCount: Number(source.shareCount || 0),
    viewerLiked: Boolean(source.likedByMe),
    viewerReposted: Boolean(source.repostedByMe),
  };
}

function mapReply(raw: any): ReplyItem {
  const a = raw.author || {};
  return {
    id: String(raw.id),
    postId: raw.postId ? String(raw.postId) : undefined,
    tokenAddress: raw.tokenAddress ? String(raw.tokenAddress) : undefined,
    tokenSymbol: raw.tokenSymbol || null,
    userId: String(a.id || raw.authorId || ""),
    username: String(a.username || "operator"),
    displayName: String(a.displayName || a.username || "Operator"),
    avatarId: String(a.avatarPreset || "kinepip-samurai"),
    avatarUrl: a.avatarUrl || null,
    walletAddress: a.walletAddress || null,
    walletVerified: Boolean(a.walletVerified),
    parentId: raw.parentReplyId || raw.parentId || null,
    content: String(raw.content || ""),
    imageUrl: null,
    editedAt: raw.updatedAt ? toIso(raw.updatedAt) : null,
    createdAt: toIso(raw.createdAt),
  };
}

function mapToken(raw: any): DirectoryToken {
  const bullish = Number(raw.bullishCount || 0);
  const bearish = Number(raw.bearishCount || 0);
  const totalSent = bullish + bearish;
  return {
    address: String(raw.address).toLowerCase(),
    symbol: String(raw.symbol || "TKN"),
    name: String(raw.name || raw.symbol || "Token"),
    decimals: Number(raw.decimals || 18),
    launchpad: String(raw.launchpad || "Elysium"),
    launchpadUrl: String(raw.launchpadUrl || "https://elyscan.live"),
    tagline: String(raw.description || raw.tagline || ""),
    featured: Boolean(raw.featured),
    reserveWhype: Number(raw.hypeDepth ?? raw.reserveWhype ?? 0),
    poolCount: Number(raw.sources?.length || 1),
    venues: Array.isArray(raw.sources) ? raw.sources : [],
    priceHype: raw.priceHype ?? null,
    commentCount: Number(raw.commentCount || 0),
    ratingAvg: Number(raw.avgRating ?? raw.ratingAvg ?? 0),
    ratingCount: Number(raw.ratingCount || 0),
    bullishCount: bullish,
    bearishCount: bearish,
    bullishPct: totalSent > 0 ? Math.round((bullish / totalSent) * 100) : 50,
  };
}

async function apiRequest<T = any>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfTokenMemory && options.method && options.method.toUpperCase() !== "GET") {
    headers.set("X-CSRF-Token", csrfTokenMemory);
  }
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  let payload: any = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    payload = await res.json().catch(() => null);
  } else {
    payload = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return payload as T;
}

export const api = {
  async getMe(): Promise<{ user: AuthUser | null; csrfToken: string | null }> {
    const res = await apiRequest<{ user: any | null }>("/api/auth/me");
    const csrf = res.user?.csrfToken || null;
    setCsrfToken(csrf);
    return {
      user: res.user ? mapUser(res.user) : null,
      csrfToken: csrf,
    };
  },

  async register(input: {
    username: string;
    password: string;
    displayName?: string;
    avatarId?: string;
  }): Promise<{ user: AuthUser; csrfToken: string }> {
    const res = await apiRequest<{ user: any }>("/api/auth/register", {
      method: "POST",
      json: {
        username: input.username,
        password: input.password,
        avatarPreset: input.avatarId || "kinepip-samurai",
      },
    });
    const csrf = res.user?.csrfToken || "";
    setCsrfToken(csrf);
    return { user: mapUser(res.user), csrfToken: csrf };
  },

  async login(input: {
    username: string;
    password: string;
  }): Promise<{ user: AuthUser; csrfToken: string }> {
    const res = await apiRequest<{ user: any }>("/api/auth/login", {
      method: "POST",
      json: input,
    });
    const csrf = res.user?.csrfToken || "";
    setCsrfToken(csrf);
    return { user: mapUser(res.user), csrfToken: csrf };
  },

  async logout(): Promise<void> {
    await apiRequest("/api/auth/logout", { method: "POST", json: {} });
    setCsrfToken(null);
  },

  async updateProfile(input: {
    displayName?: string;
    bio?: string;
    avatarId?: string;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    walletAddress?: string | null;
    walletSignature?: string;
    walletMessage?: string;
    showConnections?: boolean;
  }): Promise<{ user: AuthUser }> {
    const res = await apiRequest<{ user: any }>("/api/auth/profile", {
      method: "PATCH",
      json: {
        displayName: input.displayName,
        bio: input.bio,
        avatarPreset: input.avatarId,
        avatarUrl: input.avatarUrl,
        bannerUrl: input.bannerUrl,
        walletAddress: input.walletAddress,
        walletSignature: input.walletSignature,
        walletMessage: input.walletMessage,
        showConnections: input.showConnections,
      },
    });
    if (res.user?.csrfToken) setCsrfToken(res.user.csrfToken);
    return { user: mapUser(res.user) };
  },

  async uploadMedia(
    file: File,
    kind: "post" | "avatar" | "banner"
  ): Promise<{ key: string; url: string; mimeType: string; byteSize: number }> {
    const headers = new Headers();
    if (csrfTokenMemory) {
      headers.set("X-CSRF-Token", csrfTokenMemory);
    }
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/media/upload?kind=${encodeURIComponent(kind)}`, {
      method: "POST",
      headers,
      credentials: "include",
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error || `Upload failed (${res.status})`);
    }
    return {
      key: (data as any).key,
      url: (data as any).url,
      mimeType: (data as any).contentType || file.type,
      byteSize: (data as any).size || file.size,
    };
  },

  async getPosts(
    params: {
      tab?: "feed" | "following" | "token";
      token?: string;
      limit?: number;
    } = {}
  ): Promise<{ items: PostItem[] }> {
    const sp = new URLSearchParams();
    if (params.tab === "following") sp.set("feed", "following");
    if (params.token) sp.set("token", params.token);
    if (params.limit) sp.set("limit", String(params.limit));
    const res = await apiRequest<{ posts: any[] }>(`/api/posts?${sp.toString()}`);
    return { items: (res.posts || []).map(mapPost) };
  },

  async createPost(input: {
    content: string;
    tokenAddress?: string | null;
    tokenSymbol?: string | null;
    imageUrl?: string | null;
    quotedPostId?: string | null;
  }): Promise<{ post: PostItem }> {
    if (input.quotedPostId) {
      const qRes = await apiRequest<{ id: string }>(
        `/api/posts/${encodeURIComponent(input.quotedPostId)}/quote`,
        {
          method: "POST",
          json: { content: input.content },
        }
      );
      const full = await apiRequest<{ post: any }>(
        `/api/posts/${encodeURIComponent(qRes.id)}`
      );
      return { post: mapPost(full.post) };
    }

    const res = await apiRequest<{ post: any }>("/api/posts", {
      method: "POST",
      json: {
        content: input.content,
        imageUrl: input.imageUrl,
      },
    });
    return { post: mapPost(res.post) };
  },

  async getPostThread(
    postId: string
  ): Promise<{ post: PostItem; replies: ReplyItem[] }> {
    const [pRes, rRes] = await Promise.all([
      apiRequest<{ post: any }>(`/api/posts/${encodeURIComponent(postId)}`),
      apiRequest<{ replies: any[] }>(
        `/api/posts/${encodeURIComponent(postId)}/replies`
      ),
    ]);
    return {
      post: mapPost(pRes.post),
      replies: (rRes.replies || []).map(mapReply),
    };
  },

  async editPost(postId: string, content: string): Promise<{ post: PostItem }> {
    await apiRequest(`/api/posts/${encodeURIComponent(postId)}`, {
      method: "PATCH",
      json: { content },
    });
    const full = await apiRequest<{ post: any }>(
      `/api/posts/${encodeURIComponent(postId)}`
    );
    return { post: mapPost(full.post) };
  },

  async deletePost(postId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`/api/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      json: {},
    });
  },

  async toggleLike(postId: string): Promise<{ liked: boolean; likeCount: number }> {
    return apiRequest<{ liked: boolean; likeCount: number }>(
      `/api/posts/${encodeURIComponent(postId)}/like`,
      { method: "POST", json: {} }
    );
  },

  async toggleRepost(
    postId: string
  ): Promise<{ reposted: boolean; repostCount: number }> {
    return apiRequest<{ reposted: boolean; repostCount: number }>(
      `/api/posts/${encodeURIComponent(postId)}/repost`,
      { method: "POST", json: {} }
    );
  },

  async recordShare(postId: string): Promise<{ shareCount: number }> {
    return apiRequest<{ shareCount: number }>(
      `/api/posts/${encodeURIComponent(postId)}/share`,
      { method: "POST", json: {} }
    );
  },

  async togglePin(postId: string): Promise<{ pinnedPostId: string | null }> {
    return apiRequest<{ pinnedPostId: string | null }>(
      `/api/posts/${encodeURIComponent(postId)}/pin`,
      { method: "POST", json: {} }
    );
  },

  async createReply(
    postId: string,
    input: { content: string; parentId?: string | null; imageUrl?: string | null }
  ): Promise<{ reply: ReplyItem }> {
    const res = await apiRequest<{ id: string }>(
      `/api/posts/${encodeURIComponent(postId)}/replies`,
      {
        method: "POST",
        json: {
          content: input.content,
          parentReplyId: input.parentId || null,
        },
      }
    );
    const list = await apiRequest<{ replies: any[] }>(
      `/api/posts/${encodeURIComponent(postId)}/replies`
    );
    const found =
      (list.replies || []).find((r) => r.id === res.id) ||
      list.replies?.[list.replies.length - 1];
    return { reply: mapReply(found) };
  },

  async editReply(replyId: string, content: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(
      `/api/replies/${encodeURIComponent(replyId)}`,
      {
        method: "PATCH",
        json: { content },
      }
    );
  },

  async deleteReply(replyId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(
      `/api/replies/${encodeURIComponent(replyId)}`,
      {
        method: "DELETE",
        json: {},
      }
    );
  },

  async getTokens(): Promise<{
    updatedAt: number;
    count: number;
    tokens: DirectoryToken[];
  }> {
    const res = await apiRequest<{ tokens: any[]; updatedAt: number }>(
      "/api/tokens"
    );
    const mapped = (res.tokens || []).map(mapToken);
    return {
      updatedAt: res.updatedAt || Date.now(),
      count: mapped.length,
      tokens: mapped,
    };
  },

  async getHypePrice(): Promise<{
    hypeUsd: number;
    updatedAt: number;
    source: string;
  }> {
    const res = await apiRequest<{
      hypeUsd: number | null;
      at?: number;
      source?: string;
    }>("/api/price");
    return {
      hypeUsd: res.hypeUsd && res.hypeUsd > 0 ? res.hypeUsd : 38.5,
      updatedAt: res.at || Date.now(),
      source: res.source || "Hyperliquid allMids",
    };
  },

  async getTokenSocial(address: string): Promise<{
    tokenAddress: string;
    stats: {
      ratingAvg: number;
      ratingCount: number;
      bullishCount: number;
      bearishCount: number;
      bullishPct: number;
    };
    viewerVote: { rating: number | null; sentiment: "bullish" | "bearish" | null };
    comments: ReplyItem[];
    relatedPosts: PostItem[];
  }> {
    const cleanAddr = address.toLowerCase();
    const seeded = SEEDED_TOKENS.find(
      (t) => t.address.toLowerCase() === cleanAddr
    );
    const [soc, rel] = await Promise.all([
      apiRequest<{
        comments: any[];
        stats: {
          bullish: number;
          bearish: number;
          avgRating: number;
          ratingCount: number;
          myRating?: number | null;
          mySentiment?: "bullish" | "bearish" | null;
        };
      }>(`/api/tokens/${encodeURIComponent(cleanAddr)}/social`),
      apiRequest<{ posts: any[] }>(
        `/api/posts?token=${encodeURIComponent(cleanAddr)}${
          seeded ? `&symbol=${encodeURIComponent(seeded.symbol)}` : ""
        }`
      ),
    ]);

    const bull = Number(soc.stats?.bullish || 0);
    const bear = Number(soc.stats?.bearish || 0);
    const total = bull + bear;
    return {
      tokenAddress: cleanAddr,
      stats: {
        ratingAvg: Number(soc.stats?.avgRating || 0),
        ratingCount: Number(soc.stats?.ratingCount || 0),
        bullishCount: bull,
        bearishCount: bear,
        bullishPct: total > 0 ? Math.round((bull / total) * 100) : 50,
      },
      viewerVote: {
        rating: soc.stats?.myRating ?? null,
        sentiment: soc.stats?.mySentiment ?? null,
      },
      comments: (soc.comments || []).map(mapReply),
      relatedPosts: (rel.posts || []).map(mapPost),
    };
  },

  async addTokenComment(
    address: string,
    input: {
      content: string;
      parentId?: string | null;
      tokenSymbol?: string | null;
      imageUrl?: string | null;
    }
  ): Promise<{ ok: boolean; id: string }> {
    const res = await apiRequest<{ id: string }>(
      `/api/tokens/${encodeURIComponent(address.toLowerCase())}/comments`,
      {
        method: "POST",
        json: {
          content: input.content,
          parentId: input.parentId || null,
        },
      }
    );
    return { ok: true, id: res.id };
  },

  async deleteTokenComment(commentId: string): Promise<{ ok: boolean }> {
    return apiRequest(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      json: {},
    });
  },

  async voteToken(
    address: string,
    input: { rating?: number | null; sentiment?: "bullish" | "bearish" | null }
  ): Promise<{
    stats: {
      ratingAvg: number;
      ratingCount: number;
      bullishCount: number;
      bearishCount: number;
      bullishPct: number;
    };
    viewerVote: { rating: number | null; sentiment: "bullish" | "bearish" | null };
  }> {
    const soc = await apiRequest<{
      stats: {
        bullish: number;
        bearish: number;
        avgRating: number;
        ratingCount: number;
        myRating?: number | null;
        mySentiment?: "bullish" | "bearish" | null;
      };
    }>(`/api/tokens/${encodeURIComponent(address.toLowerCase())}/vote`, {
      method: "POST",
      json: input,
    });
    const bull = Number(soc.stats?.bullish || 0);
    const bear = Number(soc.stats?.bearish || 0);
    const total = bull + bear;
    return {
      stats: {
        ratingAvg: Number(soc.stats?.avgRating || 0),
        ratingCount: Number(soc.stats?.ratingCount || 0),
        bullishCount: bull,
        bearishCount: bear,
        bullishPct: total > 0 ? Math.round((bull / total) * 100) : 50,
      },
      viewerVote: {
        rating: soc.stats?.myRating ?? null,
        sentiment: soc.stats?.mySentiment ?? null,
      },
    };
  },

  async getUserProfile(username: string): Promise<{
    profile: AuthUser & {
      followerCount: number;
      followingCount: number;
      viewerFollowing: boolean;
      isSelf: boolean;
    };
    pinnedPost: PostItem | null;
    posts: PostItem[];
    tokenComments: ReplyItem[];
    replies: Array<ReplyItem & { postSnippet: string }>;
  }> {
    const [pRes, postsRes, meRes] = await Promise.all([
      apiRequest<{
        profile: any;
        followStats: { followers: number; following: number };
        isFollowing: boolean;
        pinnedPost: any | null;
        tokenComments: any[];
      }>(`/api/profiles/${encodeURIComponent(username)}`),
      apiRequest<{ posts: any[] }>(
        `/api/posts?author=${encodeURIComponent(username)}`
      ),
      apiRequest<{ user: any | null }>("/api/auth/me"),
    ]);

    const mappedUser = mapUser(pRes.profile);
    return {
      profile: {
        ...mappedUser,
        followerCount: Number(pRes.followStats?.followers || 0),
        followingCount: Number(pRes.followStats?.following || 0),
        viewerFollowing: Boolean(pRes.isFollowing),
        isSelf: Boolean(meRes.user && meRes.user.id === mappedUser.id),
      },
      pinnedPost: pRes.pinnedPost ? mapPost(pRes.pinnedPost) : null,
      posts: (postsRes.posts || []).map(mapPost),
      tokenComments: (pRes.tokenComments || []).map((c) =>
        mapReply({ ...c, author: pRes.profile })
      ),
      replies: [],
    };
  },

  async toggleFollow(
    username: string
  ): Promise<{ following: boolean; followerCount: number }> {
    const res = await apiRequest<{ following: boolean }>(
      `/api/profiles/${encodeURIComponent(username)}/follow`,
      { method: "POST", json: {} }
    );
    const pRes = await apiRequest<{
      followStats: { followers: number; following: number };
    }>(`/api/profiles/${encodeURIComponent(username)}`);
    return {
      following: res.following,
      followerCount: Number(pRes.followStats?.followers || 0),
    };
  },

  async getUserConnections(username: string): Promise<{
    hidden: boolean;
    followers: Array<{
      id: string;
      username: string;
      displayName: string;
      avatarId: string;
      avatarUrl: string | null;
      bio: string;
      walletVerified: boolean;
    }>;
    following: Array<{
      id: string;
      username: string;
      displayName: string;
      avatarId: string;
      avatarUrl: string | null;
      bio: string;
      walletVerified: boolean;
    }>;
  }> {
    const [flw, flg] = await Promise.all([
      apiRequest<{ hidden: boolean; connections: any[] }>(
        `/api/profiles/${encodeURIComponent(username)}/connections?tab=followers`
      ),
      apiRequest<{ hidden: boolean; connections: any[] }>(
        `/api/profiles/${encodeURIComponent(username)}/connections?tab=following`
      ),
    ]);
    const mapConn = (c: any) => ({
      id: String(c.id),
      username: String(c.username),
      displayName: String(c.displayName || c.username),
      avatarId: String(c.avatarPreset || "kinepip-samurai"),
      avatarUrl: c.avatarUrl || null,
      bio: String(c.bio || ""),
      walletVerified: Boolean(c.walletVerified),
    });
    return {
      hidden: Boolean(flw.hidden || flg.hidden),
      followers: (flw.connections || []).map(mapConn),
      following: (flg.connections || []).map(mapConn),
    };
  },

  async getAnalytics(): Promise<{
    postCount: number;
    likesReceived: number;
    repostsReceived: number;
    sharesReceived: number;
    repliesMade: number;
    tokenCommentsMade: number;
    followerCount: number;
    followingCount: number;
  }> {
    const res = await apiRequest<{ analytics: any }>("/api/me/analytics");
    const a = res.analytics || {};
    return {
      postCount: Number(a.posts || 0),
      likesReceived: Number(a.likesReceived || 0),
      repostsReceived: Number(a.repostsReceived || 0),
      sharesReceived: Number(a.sharesReceived || 0),
      repliesMade: Number(a.repliesReceived || 0),
      tokenCommentsMade: Number(a.commentsWritten || 0),
      followerCount: 0,
      followingCount: 0,
    };
  },

  async search(q: string): Promise<{
    query: string;
    users: Array<{
      id: string;
      username: string;
      displayName: string;
      bio: string;
      avatarId: string;
      avatarUrl: string | null;
      walletAddress: string | null;
      walletVerified: boolean;
    }>;
    posts: PostItem[];
    discussedTokens: Array<{
      tokenAddress: string;
      tokenSymbol: string;
      mentionCount: number;
    }>;
  }> {
    const res = await apiRequest<{ profiles: any[]; posts: any[] }>(
      `/api/search?q=${encodeURIComponent(q)}`
    );
    return {
      query: q,
      users: (res.profiles || []).map((u) => ({
        id: String(u.id),
        username: String(u.username),
        displayName: String(u.displayName || u.username),
        bio: String(u.bio || ""),
        avatarId: String(u.avatarPreset || "kinepip-samurai"),
        avatarUrl: u.avatarUrl || null,
        walletAddress: u.walletAddress || null,
        walletVerified: Boolean(u.walletVerified),
      })),
      posts: (res.posts || []).map(mapPost),
      discussedTokens: [],
    };
  },

  async getNotifications(): Promise<{
    unreadCount: number;
    retentionHours: number;
    items: Array<{
      id: string;
      kind: string;
      postId: string | null;
      tokenAddress: string | null;
      message: string | null;
      readAt: string | null;
      createdAt: string;
      actor: {
        id: string;
        username: string;
        displayName: string;
        avatarId: string;
        avatarUrl: string | null;
      };
    }>;
  }> {
    const res = await apiRequest<{ notifications: any[] }>("/api/notifications");
    const list = res.notifications || [];
    const items = list.map((n) => {
      const handleMatch = String(n.message || "").match(/^@([a-zA-Z0-9_]+)/);
      const actorHandle = handleMatch ? handleMatch[1] : "operator";
      const postMatch = String(n.link || "").match(/\/app\/post\/([^/?#]+)/);
      return {
        id: String(n.id),
        kind: n.type === "message" ? "dm" : String(n.type || "like"),
        postId: postMatch ? postMatch[1] : null,
        tokenAddress: null,
        message: String(n.message || ""),
        readAt: n.readAt ? toIso(n.readAt) : null,
        createdAt: toIso(n.createdAt),
        actor: {
          id: String(n.actorId || actorHandle),
          username: actorHandle,
          displayName: actorHandle,
          avatarId: "kinepip-samurai",
          avatarUrl: null,
        },
      };
    });
    return {
      unreadCount: items.filter((i) => !i.readAt).length,
      retentionHours: 12,
      items,
    };
  },

  async markNotificationsRead(): Promise<{ ok: boolean }> {
    return apiRequest("/api/notifications/read", { method: "POST", json: {} });
  },

  async getMessageThreads(): Promise<{
    threads: Array<{
      peer: {
        id: string;
        username: string;
        displayName: string;
        avatarId: string;
        avatarUrl: string | null;
        walletVerified: boolean;
      };
      lastMessage: {
        id: string;
        content: string;
        senderId: string;
        createdAt: string;
      } | null;
      unreadCount: number;
    }>;
  }> {
    const res = await apiRequest<{ messages: any[]; participants: any[] }>(
      "/api/messages"
    );
    const msgs = res.messages || [];
    const parts = res.participants || [];
    const threads = parts.map((p) => {
      const peerMsgs = msgs.filter(
        (m) => m.senderId === p.id || m.recipientId === p.id
      );
      const last = peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : null;
      const unread = peerMsgs.filter(
        (m) => m.senderId === p.id && !m.readAt
      ).length;
      return {
        peer: {
          id: String(p.id),
          username: String(p.username),
          displayName: String(p.displayName || p.username),
          avatarId: String(p.avatarPreset || "kinepip-samurai"),
          avatarUrl: p.avatarUrl || null,
          walletVerified: false,
        },
        lastMessage: last
          ? {
              id: String(last.id),
              content: String(last.content),
              senderId: String(last.senderId),
              createdAt: toIso(last.createdAt),
            }
          : null,
        unreadCount: unread,
      };
    });
    return { threads };
  },

  async getConversation(username: string): Promise<{
    peer: {
      id: string;
      username: string;
      displayName: string;
      avatarId: string;
      avatarUrl: string | null;
      walletVerified: boolean;
    };
    messages: Array<{
      id: string;
      senderId: string;
      recipientId: string;
      content: string;
      readAt: string | null;
      createdAt: string;
    }>;
  }> {
    const [pRes, mRes] = await Promise.all([
      apiRequest<{ profile: any }>(
        `/api/profiles/${encodeURIComponent(username)}`
      ),
      apiRequest<{ messages: any[] }>("/api/messages"),
    ]);
    const peerId = String(pRes.profile.id);
    const peerMsgs = (mRes.messages || [])
      .filter((m) => m.senderId === peerId || m.recipientId === peerId)
      .map((m) => ({
        id: String(m.id),
        senderId: String(m.senderId),
        recipientId: String(m.recipientId),
        content: String(m.content),
        readAt: m.readAt ? toIso(m.readAt) : null,
        createdAt: toIso(m.createdAt),
      }));

    return {
      peer: {
        id: peerId,
        username: String(pRes.profile.username),
        displayName: String(pRes.profile.displayName || pRes.profile.username),
        avatarId: String(pRes.profile.avatarPreset || "kinepip-samurai"),
        avatarUrl: pRes.profile.avatarUrl || null,
        walletVerified: Boolean(pRes.profile.walletVerified),
      },
      messages: peerMsgs,
    };
  },

  async sendMessage(
    username: string,
    content: string
  ): Promise<{
    message: {
      id: string;
      senderId: string;
      recipientId: string;
      content: string;
      readAt: string | null;
      createdAt: string;
    };
  }> {
    const pRes = await apiRequest<{ profile: any }>(
      `/api/profiles/${encodeURIComponent(username)}`
    );
    const res = await apiRequest<{ message: any }>("/api/messages", {
      method: "POST",
      json: {
        recipientId: pRes.profile.id,
        content,
      },
    });
    return {
      message: {
        id: String(res.message.id),
        senderId: String(res.message.senderId),
        recipientId: String(res.message.recipientId),
        content: String(res.message.content),
        readAt: null,
        createdAt: toIso(res.message.createdAt),
      },
    };
  },

  async getStatus(): Promise<{
    ok: boolean;
    chainId: number;
    storage: {
      backend: string;
      r2Bound: boolean;
      kvBound: boolean;
      users: number;
      posts: number;
      mediaCount: number;
      mediaBytes: number;
      notificationRetentionHours: number;
      quotas: {
        d1FreeStorageLimitMb: number;
        r2FreeStorageLimitGb: number;
        maxPostImageMb: number;
        maxAvatarMb: number;
        maxBannerMb: number;
      };
    };
  }> {
    const res = await apiRequest<any>("/api/status");
    return {
      ok: Boolean(res.ok),
      chainId: 99901,
      storage: {
        backend: String(res.bindings?.relational || "SQLite Durable Object"),
        r2Bound: String(res.bindings?.media || "").includes("R2"),
        kvBound: String(res.bindings?.cache || "").includes("KV"),
        users: Number(res.counts?.users || 0),
        posts: Number(res.counts?.posts || 0),
        mediaCount: Number(res.counts?.mediaObjects || 0),
        mediaBytes: Number(res.counts?.mediaBytes || 0),
        notificationRetentionHours: 12,
        quotas: {
          d1FreeStorageLimitMb: 5000,
          r2FreeStorageLimitGb: 10,
          maxPostImageMb: 4,
          maxAvatarMb: 2,
          maxBannerMb: 4,
        },
      },
    };
  },
};
