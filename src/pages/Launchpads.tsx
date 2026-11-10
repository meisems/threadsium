import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LaunchpadMark, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconBack, IconExternal, IconLaunchpads } from "../components/icons";
import { api, type LaunchpadCoin, type LaunchpadRanking } from "../lib/api";
import { fmtCompact, shortAddr } from "../lib/format";
import { useApp } from "../state";

type SortKey =
  | "volume"
  | "mcap"
  | "liquidity"
  | "trades"
  | "launches"
  | "discussed";

type WindowKey = "24h" | "1h";

function fmtHype(n: number | null | undefined, hypeUsd: number | null): string {
  if (!n || n <= 0) return "—";
  if (hypeUsd && hypeUsd > 0) {
    const usd = n * hypeUsd;
    return `${fmtCompact(n, 1)} HYPE ($${fmtCompact(usd, 1)})`;
  }
  return `${fmtCompact(n, 1)} HYPE`;
}

function fmtCompactHype(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  return `${fmtCompact(n, 1)} HYPE`;
}

function fmtAge(createdAt: number | null): string {
  if (!createdAt) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function CoinMiniRow({
  coin,
  hypeUsd,
}: {
  coin: LaunchpadCoin;
  hypeUsd: number | null;
}): React.ReactElement {
  return (
    <Link
      to={`/app/token/${coin.address.toLowerCase()}`}
      className="room-row lp-coin-row"
    >
      <TokenMark
        address={coin.address}
        symbol={coin.symbol}
        size={40}
        imageUrl={coin.imageUrl}
      />
      <span className="room-row-main">
        <span className="room-row-title">
          <strong>${coin.symbol}</strong>
          <span>{coin.name}</span>
          {coin.isLaunchpadToken ? (
            <span className="tag tag-verified">Launchpad token</span>
          ) : null}
        </span>
        <span className="room-row-meta">
          <span>{coin.venue}</span>
          {coin.holders ? <span>{coin.holders} holders</span> : null}
          {coin.createdAt ? <span>{fmtAge(coin.createdAt)}</span> : null}
          {coin.commentCount > 0 ? (
            <span>{coin.commentCount} posts</span>
          ) : null}
        </span>
      </span>
      <span className="room-row-side lp-coin-metrics">
        <strong className="lp-coin-vol">
          {coin.volume24h > 0
            ? `${fmtCompact(coin.volume24h, 1)} HYPE vol`
            : coin.liquidityHype > 0
              ? `${fmtCompact(coin.liquidityHype, 1)} HYPE liq`
              : "Active pool"}
        </strong>
        <span className="room-row-stats">
          {coin.mcapHype > 0
            ? `MCap ${fmtHype(coin.mcapHype, hypeUsd)}`
            : coin.trades24h > 0
              ? `${coin.trades24h} trades (24h)`
              : "Open room →"}
        </span>
      </span>
    </Link>
  );
}

export function Launchpads(): React.ReactElement {
  const { id: selectedId } = useParams();
  const navigate = useNavigate();
  const { hypeUsd } = useApp();
  const [launchpads, setLaunchpads] = useState<LaunchpadRanking[]>([]);
  const [totals, setTotals] = useState<{
    volume24h: number;
    volume1h: number;
    trades24h: number;
    launches: number;
    launches24h: number;
    liquidityHype: number;
    mcapHype: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("volume");
  const [win, setWin] = useState<WindowKey>("24h");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "has-token">(
    "all"
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .launchpads()
      .then((lpRes) => {
        if (!alive) return;
        setLaunchpads(lpRes.launchpads);
        setTotals(lpRes.totals);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const detail = useMemo(() => {
    if (!selectedId) return null;
    const clean = selectedId.toLowerCase();
    return launchpads.find((l) => l.id.toLowerCase() === clean) ?? null;
  }, [launchpads, selectedId]);

  const sorted = useMemo(() => {
    return [...launchpads]
      .filter((l) => {
        if (statusFilter === "live") return l.status === "live";
        if (statusFilter === "has-token") return l.token !== null;
        return true;
      })
      .sort((a, b) => {
        if (sort === "volume") {
          const av = win === "1h" ? a.volume1h : a.volume24h;
          const bv = win === "1h" ? b.volume1h : b.volume24h;
          return bv - av || b.mcapHype - a.mcapHype || b.launches - a.launches;
        }
        if (sort === "mcap")
          return b.mcapHype - a.mcapHype || b.volume24h - a.volume24h;
        if (sort === "liquidity")
          return b.liquidityHype - a.liquidityHype || b.volume24h - a.volume24h;
        if (sort === "trades") {
          const at = win === "1h" ? a.trades1h : a.trades24h;
          const bt = win === "1h" ? b.trades1h : b.trades24h;
          return bt - at || b.volume24h - a.volume24h;
        }
        if (sort === "launches")
          return b.launches - a.launches || b.volume24h - a.volume24h;
        return (
          b.discussionCount - a.discussionCount ||
          b.volume24h - a.volume24h ||
          b.launches - a.launches
        );
      });
  }, [launchpads, sort, win, statusFilter]);

  const platformTokens = useMemo(
    () => launchpads.filter((l) => l.token !== null),
    [launchpads]
  );

  if (selectedId && detail) {
    return (
      <>
        <div className="back-row">
          <button
            type="button"
            className="back-link"
            onClick={() => navigate("/app/launchpads")}
          >
            <IconBack size={18} /> Launchpads
          </button>
        </div>

        <header className="room-head lp-report-hero">
          <LaunchpadMark id={detail.id} name={detail.name} size={60} />
          <div className="room-head-main">
            <h1>
              {detail.name} <span>Elysium Launchpad</span>
            </h1>
            <div className="room-head-meta">
              <span className="tag tag-verified">{detail.status}</span>
              {detail.token ? (
                <Link
                  to={`/app/token/${detail.token.address.toLowerCase()}`}
                  className="chip chip-button"
                >
                  Platform token: ${detail.token.symbol}
                </Link>
              ) : null}
            </div>
            <p className="room-head-desc">{detail.summary}</p>
            <div className="room-head-links">
              {detail.site ? (
                <a
                  href={detail.site}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {detail.name} <IconExternal size={14} />
                </a>
              ) : null}
              <Link to={`/app/rooms?launchpad=${detail.id}`}>
                Filter rooms by {detail.shortName}
              </Link>
            </div>
          </div>
        </header>

        <section className="lp-metrics-strip" aria-label={`${detail.name} metrics`}>
          <div className="lp-metric-box">
            <span className="lp-metric-label">24h Volume</span>
            <strong>{fmtHype(detail.volume24h, hypeUsd)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Launch MCap</span>
            <strong>{fmtHype(detail.mcapHype, hypeUsd)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Pool Liquidity</span>
            <strong>{fmtHype(detail.liquidityHype, hypeUsd)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">24h Trades</span>
            <strong>{fmtCompact(detail.trades24h, 0)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Counted Launches</span>
            <strong>
              {detail.launches}
              {detail.launches24h > 0 ? ` (+${detail.launches24h} 24h)` : ""}
            </strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">10+ Holder Coins</span>
            <strong>{detail.launches10Holders}</strong>
          </div>
        </section>

        {detail.token ? (
          <section className="lp-section">
            <h2 className="section-title">Official Launchpad Token</h2>
            <div className="lp-platform-token-card">
              <TokenMark
                address={detail.token.address}
                symbol={detail.token.symbol}
                size={48}
              />
              <div className="lp-platform-token-info">
                <div className="room-row-title">
                  <strong>${detail.token.symbol}</strong>
                  <span>{detail.token.name}</span>
                  <span className="tag tag-verified">Launchpad token</span>
                </div>
                <p className="room-head-desc">{detail.token.evidence}</p>
                <code className="mono">{detail.token.address}</code>
              </div>
              <div className="lp-platform-token-cta">
                <Link
                  to={`/app/token/${detail.token.address.toLowerCase()}`}
                  className="btn btn-primary btn-small"
                >
                  Open ${detail.token.symbol} room
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        <section className="lp-section">
          <h2 className="section-title">Top Coins on {detail.name}</h2>
          {detail.topCoins.length === 0 ? (
            <div className="empty">
              <p>No active HYPE-paired launches indexed in the current window.</p>
            </div>
          ) : (
            <div className="room-list">
              {detail.topCoins.map((c) => (
                <CoinMiniRow key={c.address} coin={c} hypeUsd={hypeUsd} />
              ))}
            </div>
          )}
        </section>

        {detail.newCoins.length > 0 ? (
          <section className="lp-section">
            <h2 className="section-title">Recent Launches on {detail.name}</h2>
            <div className="room-list">
              {detail.newCoins.map((c) => (
                <CoinMiniRow key={c.address} coin={c} hypeUsd={hypeUsd} />
              ))}
            </div>
          </section>
        ) : null}

        {detail.contracts.length > 0 ? (
          <section className="lp-section">
            <h2 className="section-title">Published Contracts (Elysium 99901)</h2>
            <div className="lp-contracts-table">
              {detail.contracts.map((c) => (
                <div key={`${c.role}:${c.address}`} className="lp-contract-row">
                  <div>
                    <strong>{c.label}</strong>{" "}
                    <span className="tag">{c.role}</span>
                  </div>
                  <a
                    href={`https://elyscan.live/address/${c.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono"
                  >
                    {shortAddr(c.address, 8, 6)} <IconExternal size={13} />
                  </a>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>Launchpads</h1>
        <p>
          Every Elysium token launchpad on chain 99901: live volume, pool depth, official platform tokens, and synced token rooms.
        </p>
      </header>

      {totals ? (
        <section className="lp-metrics-strip" aria-label="Ecosystem launchpad totals">
          <div className="lp-metric-box">
            <span className="lp-metric-label">
              {win === "1h" ? "1h Launchpad Volume" : "24h Launchpad Volume"}
            </span>
            <strong>
              {fmtHype(
                win === "1h" ? totals.volume1h : totals.volume24h,
                hypeUsd
              )}
            </strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Total Launch MCap</span>
            <strong>{fmtHype(totals.mcapHype, hypeUsd)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Pool Liquidity</span>
            <strong>{fmtHype(totals.liquidityHype, hypeUsd)}</strong>
          </div>
          <div className="lp-metric-box">
            <span className="lp-metric-label">Counted Launches</span>
            <strong>
              {totals.launches}
              {totals.launches24h > 0 ? ` (+${totals.launches24h} 24h)` : ""}
            </strong>
          </div>
        </section>
      ) : null}

      {platformTokens.length > 0 ? (
        <section className="lp-platform-strip" aria-label="Official Launchpad Platform Tokens">
          <div className="lp-strip-head">
            <strong>
              <IconLaunchpads size={16} /> Official Launchpad Tokens
            </strong>
            <span>Click any token to open its synced room</span>
          </div>
          <div className="lp-platform-pills">
            {platformTokens.map((lp) => {
              const t = lp.token!;
              return (
                <Link
                  key={t.address}
                  to={`/app/token/${t.address.toLowerCase()}`}
                  className="lp-platform-pill"
                >
                  <TokenMark address={t.address} symbol={t.symbol} size={28} />
                  <span className="lp-platform-pill-text">
                    <strong>${t.symbol}</strong>
                    <span>{lp.shortName}</span>
                  </span>
                  {t.mcapHype > 0 ? (
                    <span className="tag">
                      {fmtCompact(t.mcapHype, 1)} HYPE
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="lp-controls">
        <div className="segmented" role="group" aria-label="Sort launchpads">
          {(
            [
              ["volume", "Volume"],
              ["mcap", "Market cap"],
              ["liquidity", "Liquidity"],
              ["trades", "Trades"],
              ["launches", "Launches"],
              ["discussed", "Discussed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={sort === id ? "is-on" : ""}
              aria-pressed={sort === id}
              onClick={() => setSort(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="lp-sub-toggles">
          <div className="segmented" role="group" aria-label="Time window">
            <button
              type="button"
              className={win === "24h" ? "is-on" : ""}
              aria-pressed={win === "24h"}
              onClick={() => setWin("24h")}
            >
              24h
            </button>
            <button
              type="button"
              className={win === "1h" ? "is-on" : ""}
              aria-pressed={win === "1h"}
              onClick={() => setWin("1h")}
            >
              1h
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Filter launchpads">
            <button
              type="button"
              className={statusFilter === "all" ? "is-on" : ""}
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              All ({launchpads.length})
            </button>
            <button
              type="button"
              className={statusFilter === "live" ? "is-on" : ""}
              aria-pressed={statusFilter === "live"}
              onClick={() => setStatusFilter("live")}
            >
              Live
            </button>
            <button
              type="button"
              className={statusFilter === "has-token" ? "is-on" : ""}
              aria-pressed={statusFilter === "has-token"}
              onClick={() => setStatusFilter("has-token")}
            >
              Has token
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <Loom
          label="Reading Elysium launchpads"
          detail="Indexing Montra, Kleos, BOXA, ELYXA, Obol, Eleos, Volta, and V3/V4 pools"
        />
      ) : (
        <div className="lp-leaderboard">
          {sorted.map((lp, idx) => {
            const vol = win === "1h" ? lp.volume1h : lp.volume24h;
            const tr = win === "1h" ? lp.trades1h : lp.trades24h;
            return (
              <article key={lp.id} className="lp-card">
                <div className="lp-card-head">
                  <span className="lp-rank-num">#{idx + 1}</span>
                  <LaunchpadMark id={lp.id} name={lp.name} size={42} />
                  <div className="lp-card-title">
                    <div className="lp-card-name-row">
                      <Link
                        to={`/app/launchpads/${lp.id}`}
                        className="lp-card-name"
                      >
                        <strong>{lp.name}</strong>
                      </Link>
                      <span
                        className={`tag ${lp.status === "live" ? "tag-verified" : ""}`}
                      >
                        {lp.status}
                      </span>
                      {lp.token ? (
                        <Link
                          to={`/app/token/${lp.token.address.toLowerCase()}`}
                          className="chip chip-button lp-token-chip"
                          title={`Open $${lp.token.symbol} room`}
                        >
                          <TokenMark
                            address={lp.token.address}
                            symbol={lp.token.symbol}
                            size={18}
                          />
                          <span>${lp.token.symbol}</span>
                        </Link>
                      ) : null}
                    </div>
                    <p className="lp-card-summary">{lp.summary}</p>
                  </div>
                  <div className="lp-card-actions">
                    <Link
                      to={`/app/launchpads/${lp.id}`}
                      className="btn btn-ghost btn-small"
                    >
                      Report
                    </Link>
                    {lp.site ? (
                      <a
                        href={lp.site}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-small"
                        title={`Visit ${lp.name}`}
                      >
                        Site <IconExternal size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="lp-card-stats">
                  <div>
                    <span className="lp-stat-k">{win} Volume</span>
                    <strong>{fmtCompactHype(vol)}</strong>
                  </div>
                  <div>
                    <span className="lp-stat-k">Market Cap</span>
                    <strong>{fmtCompactHype(lp.mcapHype)}</strong>
                  </div>
                  <div>
                    <span className="lp-stat-k">Liquidity</span>
                    <strong>{fmtCompactHype(lp.liquidityHype)}</strong>
                  </div>
                  <div>
                    <span className="lp-stat-k">{win} Trades</span>
                    <strong>{tr > 0 ? fmtCompact(tr, 0) : "—"}</strong>
                  </div>
                  <div>
                    <span className="lp-stat-k">Launches</span>
                    <strong>
                      {lp.launches > 0 ? lp.launches : "—"}
                      {lp.launches24h > 0 ? ` (+${lp.launches24h})` : ""}
                    </strong>
                  </div>
                  <div>
                    <span className="lp-stat-k">10+ Holders</span>
                    <strong>
                      {lp.launches10Holders > 0 ? lp.launches10Holders : "—"}
                    </strong>
                  </div>
                </div>

                {lp.topCoins.length > 0 ? (
                  <div className="lp-card-coins">
                    <span className="lp-coins-label">Top rooms:</span>
                    <div className="lp-coins-chips">
                      {lp.topCoins.slice(0, 4).map((c) => (
                        <Link
                          key={c.address}
                          to={`/app/token/${c.address.toLowerCase()}`}
                          className="lp-coin-chip"
                        >
                          <TokenMark
                            address={c.address}
                            symbol={c.symbol}
                            size={20}
                            imageUrl={c.imageUrl}
                          />
                          <strong>${c.symbol}</strong>
                          {c.volume24h > 0 ? (
                            <span>{fmtCompact(c.volume24h, 1)} HYPE</span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
