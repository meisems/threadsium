import React, { useState } from "react";
import { Link } from "react-router";
import { TokenMark } from "../components/Avatar";
import { ComposerBox } from "../components/Composer";
import { Feed } from "../components/Feed";
import { api, type RoomToken } from "../lib/api";
import { useApp } from "../state";

/** Token rooms across the top of the feed. The ring shows how the room has voted: green for the bullish share, red for the bearish share. */
export function RoomsRail({ tokens }: { tokens: RoomToken[] }): React.ReactElement {
  const rooms = [...tokens].sort((a, b) => Number(b.featured) - Number(a.featured) || b.recentSwaps - a.recentSwaps || b.hypeDepth - a.hypeDepth).slice(0, 12);
  return (
    <nav className="rooms-rail" aria-label="Token rooms">
      <ul>
        {rooms.map((t) => {
          const votes = t.bullishCount + t.bearishCount;
          const pct = votes ? Math.round((t.bullishCount / votes) * 100) : null;
          return (
            <li key={t.address}>
              <Link
                to={`/app/token/${t.address}`}
                className="rooms-rail-item"
                title={pct === null ? `${t.name} room, no votes yet` : `${t.name} room, ${pct}% bullish from ${votes} votes`}
              >
                <span
                  className={`rooms-ring${pct === null ? " rooms-ring-idle" : ""}`}
                  style={pct === null ? undefined : ({ "--pct": `${pct}%` } as React.CSSProperties)}
                >
                  <TokenMark address={t.address} symbol={t.symbol} size={48} />
                </span>
                <span className="rooms-rail-label">${t.symbol}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link to="/app/rooms" className="rooms-rail-item">
            <span className="rooms-ring rooms-ring-idle rooms-ring-all" aria-hidden="true">
              +
            </span>
            <span className="rooms-rail-label">All rooms</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function Home(): React.ReactElement {
  const { user, tokens } = useApp();
  const [tab, setTab] = useState<"everyone" | "following">("everyone");
  return (
    <>
      <h1 className="sr-only">Home</h1>
      <RoomsRail tokens={tokens} />
      <ComposerBox />
      <div className="tabs" role="tablist" aria-label="Feed">
        <button type="button" role="tab" aria-selected={tab === "everyone"} className={tab === "everyone" ? "is-on" : ""} onClick={() => setTab("everyone")}>
          Everyone
        </button>
        <button type="button" role="tab" aria-selected={tab === "following"} className={tab === "following" ? "is-on" : ""} onClick={() => setTab("following")}>
          Following
        </button>
      </div>
      {tab === "following" && !user ? (
        <div className="empty">
          <p>
            <strong>Your Following feed is empty until you sign in.</strong>
          </p>
          <p>It shows posts and reposts from the people you follow, newest first.</p>
          <Link className="btn btn-primary" to="/auth">
            Sign in or create an account
          </Link>
        </div>
      ) : (
        <Feed
          feedKey={`${tab}:${user?.id ?? "anon"}`}
          load={(before, signal) => api.posts({ feed: tab === "following" ? "following" : undefined, before }, signal)}
          accepts={() => true}
          empty={
            tab === "following" ? (
              <>
                <p>
                  <strong>Nobody you follow has posted yet.</strong>
                </p>
                <p>Follow a few people from the Everyone tab and their posts land here.</p>
              </>
            ) : (
              <>
                <p>
                  <strong>No posts yet.</strong>
                </p>
                <p>Write the first one above.</p>
              </>
            )
          }
        />
      )}
    </>
  );
}
