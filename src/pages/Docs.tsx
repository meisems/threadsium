// Public documentation. Everything on this page is approved for anyone to read: it describes how the
// product behaves and what its limits are. Operator procedures, bindings and secrets live outside the
// public build (docs/DEPLOY_CLOUDFLARE.md in the repository is not served by the site).
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Mark, Wordmark } from "../components/brand";
import { TopBar } from "../components/Shell";
import { CHAIN } from "../config/chain";
import { V4_MANAGERS } from "../config/v4";
import { V3_VENUES } from "../config/venues";
import { api } from "../lib/api";
import { fmtBytes } from "../lib/format";

const TOC: [id: string, label: string][] = [
  ["overview", "What Threadsium is"],
  ["start", "Getting started"],
  ["posting", "Posting and threads"],
  ["rooms", "Token rooms and charts"],
  ["sync", "Cross-platform synced rooms"],
  ["integrate", "Put a room in your project"],
  ["people", "Following, notifications, messages"],
  ["wallet", "Linking a wallet"],
  ["limits", "Limits"],
  ["privacy", "Privacy and your data"],
  ["devices", "Browsers and devices"],
  ["trouble", "Troubleshooting"],
  ["brand", "The Threadsium logo"],
  ["support", "Support"],
];

export function Docs(): React.ReactElement {
  const location = useLocation();
  const [media, setMedia] = useState<Awaited<ReturnType<typeof api.limits>>["media"] | null>(null);

  useEffect(() => {
    api
      .limits()
      .then((r) => setMedia(r.media))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Not `return window.scrollTo(...)`: current Chrome returns a Promise from scroll methods, and React
    // treats anything an effect returns as its clean-up function, which crashed the page on unmount.
    if (!location.hash) {
      window.scrollTo(0, 0);
      return;
    }
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash]);

  const mb = (n: number | undefined) => (n ? fmtBytes(n) : "checking…");

  return (
    <div className="docs">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar app={false} />
      <div className="docs-grid">
        <nav className="docs-toc" aria-label="On this page">
          <ul>
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
          <Link className="btn btn-primary btn-small" to="/app">
            Open the feed
          </Link>
        </nav>

        <main id="main" className="docs-body">
          <h1>Threadsium help</h1>
          <p className="docs-lede">How the site works, what it stores, and where its limits are.</p>

          <section id="overview">
            <h2>What Threadsium is</h2>
            <p>
              Threadsium is a social network for Elysium, an Arbitrum Orbit chain with chain ID {CHAIN.id} whose native currency is HYPE. People post, reply, repost, react
              and message each other, and every token on the chain has a room with a price chart.
            </p>
            <p>
              It is a community project. It is not operated by Kinetiq or by any launchpad, and nothing on it is financial advice. Kinetiq's public documentation still
              describes some mainnet details as coming soon, so treat chain details shown here as the best information available today.
            </p>
          </section>

          <section id="start">
            <h2>Getting started</h2>
            <ol>
              <li>Open the feed. You can read everything without an account.</li>
              <li>
                Choose <Link to="/auth?mode=new">Create account</Link>, pick a username (3 to 20 letters, numbers or underscores) and a password of at least 8 characters.
                There is no email step.
              </li>
              <li>Pick the colours of your woven profile picture. You can upload a photo and a cover image later in Settings.</li>
              <li>Write a post, or open a room and vote.</li>
            </ol>
            <p>
              Because no email is collected, a forgotten password cannot be reset. Store it in a password manager. You can change it in Settings while you are signed in.
            </p>
          </section>

          <section id="posting">
            <h2>Posting and threads</h2>
            <ul>
              <li>A post holds up to 500 characters and one image (PNG, JPEG, WebP or GIF). Photos are resized in your browser before upload.</li>
              <li>
                <code>$TICKER</code> links to that token's room, a pasted <code>0x…</code> contract address links to its room, <code>#tag</code> opens a tag search and{" "}
                <code>@username</code> links to a profile and notifies that person. Typing <code>$</code> in the composer suggests tokens.
              </li>
              <li>Replies sit under a post in a thread, two levels deep. Replies hold up to 400 characters.</li>
              <li>Repost shares a post with your followers as it is. Quote adds your own comment above it.</li>
              <li>
                Reactions: Like, Bullish, Bearish, Funny and Watching. Tap the reaction button for a Like; hold it, hover it, or use the small arrow next to it to pick
                another. One reaction per post per account.
              </li>
              <li>Save keeps a post in your private Saved list. Share copies the link or opens your device's share sheet.</li>
              <li>You can edit or delete your own posts and replies, and pin one post to the top of your profile. Edited posts are marked.</li>
            </ul>
            <p>The Everyone feed shows all posts in time order. The Following feed shows posts and reposts from people you follow. Neither is ranked.</p>
          </section>

          <section id="rooms">
            <h2>Token rooms and charts</h2>
            <p>
              A room collects posts written in it and posts anywhere that mention the token's ticker or address. Each account gets one bullish or bearish vote and one
              rating from 1 to 5 per room, and can change or clear them at any time.
            </p>
            <p>
              The directory is read from the chain by Threadsium's server every few minutes: pools paired with HYPE on {V3_VENUES.length} V3-style factories and recently
              active pools on {V4_MANAGERS.length} V4 pool managers, plus a short list of tokens that the ecosystem's own sites publish. “Listed by its launchpad” means the
              address appears in that launchpad's or project's own published configuration. It is not an endorsement or an audit.
            </p>
            <p>
              Charts and market figures are read from the token's own pools on Elysium. Threadsium's server finds every pool that pairs the token with HYPE or WHYPE (V4
              pool managers and V3 factories), folds their Swap events into one-minute candles using each block's own timestamp, and keeps that history so it reaches back
              to the pools' creation. Candles refresh every 20 seconds. Pools holding less than a tenth of the deepest pool's HYPE count toward volume but not toward the
              price line, so a thin pool cannot draw a false wick.
            </p>
            <p>
              <strong>Price</strong> is the current price in the deepest pool. <strong>Market cap</strong> is that price times the circulating supply: total supply minus
              the tokens held at the dead and zero addresses. <strong>FDV</strong> uses the total supply. <strong>Liquidity</strong> is the HYPE in the token's pools at
              the current price. Every figure is shown in HYPE and in USD; the USD values use the HYPE mid price from Hyperliquid, and when that price cannot be fetched
              the USD option is disabled instead of using an old value. Tokens still on a launchpad bonding curve have no pool yet, so their room shows the figures the
              launchpad reports and says so.
            </p>
            <p>
              <strong>Swapping.</strong> The swap panel (in every room and at /app/swap) quotes every supported pool that pairs the token with HYPE and uses the one that
              pays the most. Quotes and the simulation before you sign are read through your wallet's own connection to Elysium, then through Threadsium's server and the
              launchpads' nodes. Threadsium takes a <strong>1% platform fee</strong> in HYPE on every swap: on a buy, 1% of the HYPE you spend, in the same transaction
              as the swap; on a sell, 1% of the HYPE you receive, inside the swap where the pool's router allows it and otherwise as a second transaction right after.
              The fee and the amounts after it are shown before you sign. Threadsium never holds your funds; your wallet signs every step.
            </p>
            <p>Anyone can create a token with any ticker. Check the contract address, shown at the top of every room, before acting on anything you read.</p>
          </section>

          <section id="sync">
            <h2>Cross-platform synced rooms</h2>
            <p>
              Every token room on Threadsium is designed to be shared across the Elysium ecosystem so launchpads, DEX frontends, analytics dashboards and prediction
              markets can all point at one live chat per token contract (<code>0x…</code> or <code>99901-0x…</code>).
            </p>
            <ul>
              <li>
                <strong>Drop-in iframe widget:</strong> embed <code>/embed/room/0x…</code> (or <code>/embed/room/99901-0x…</code>) with optional{" "}
                <code>?theme=dark|light</code> and <code>&amp;compact=1</code> parameters. Readers can vote bullish or bearish, react and post directly from inside the
                widget.
              </li>
              <li>
                <strong>Real-time WebSocket stream:</strong> connect to <code>/api/rooms/0x…/ws</code> (or <code>/api/chat/99901-0x…/ws</code>) to receive instant{" "}
                <code>post</code>, <code>post_updated</code>, <code>post_deleted</code> and <code>vote</code> events whenever anyone posts or votes on Threadsium or any
                connected platform.
              </li>
              <li>
                <strong>REST &amp; Larpsium-compatible endpoints:</strong> read and sync room state via <code>GET /api/rooms/0x…/sync?after=&lt;ts&gt;</code> or{" "}
                <code>GET /api/chat/99901-0x…/messages</code>, and post messages via <code>POST /api/rooms/0x…/messages</code>.
              </li>
            </ul>
          </section>

          <section id="integrate">
            <h2>Put a room in your project</h2>
            <p>
              Any website, launchpad, DEX, dashboard or bot can show a token's Threadsium room. Open a room and choose <strong>Sync / Embed</strong> to copy a ready
              snippet for that token. Every option shows the same room, so a post made on one site appears on all of them at once.
            </p>
            <ul>
              <li>
                <strong>One script tag.</strong> Add <code>&lt;div data-threadsium-room="0x…"&gt;&lt;/div&gt;</code> where the room goes and{" "}
                <code>&lt;script src="https://threadsium.app/widget.js" async&gt;&lt;/script&gt;</code> once on the page. Options: <code>data-theme</code> (
                <code>dark</code>, <code>light</code> or <code>auto</code> to follow your page), <code>data-height</code>, <code>data-compact="1"</code>,{" "}
                <code>data-market="0"</code> to hide the price line, and <code>data-platform</code> for your project's name. The element fires{" "}
                <code>threadsium:ready</code>, <code>threadsium:post</code> and <code>threadsium:vote</code> events, so you can show an unread badge or a toast. Rooms added
                later: call <code>Threadsium.scan()</code> or <code>Threadsium.mount(element)</code>.
              </li>
              <li>
                <strong>Plain iframe.</strong> <code>https://threadsium.app/embed/room/0x…?theme=dark</code>, for site builders and pages that block scripts. Send{" "}
                <code>{"{ type: \"threadsium:theme\", theme: \"light\" }"}</code> with <code>postMessage</code> to switch its theme.
              </li>
              <li>
                <strong>React.</strong> The embed dialog has a small component that wraps the iframe for React, Next.js or Vite apps.
              </li>
              <li>
                <strong>Your own interface.</strong> Read <code>GET /api/rooms/0x…/sync</code> for the room and its posts, connect to{" "}
                <code>wss://threadsium.app/api/rooms/0x…/ws</code> for live <code>post</code>, <code>post_updated</code>, <code>post_deleted</code> and{" "}
                <code>vote</code> events, and read <code>GET /api/market/0x…?res=1m|15m|1h</code> for price, market cap and FDV in HYPE and USD, liquidity, 24-hour volume,
                candles and the latest swaps. These endpoints answer cross-origin requests and need no key. Posting needs a Threadsium account, so let people write through
                the widget.
              </li>
              <li>
                <strong>A link.</strong> <code>https://threadsium.app/app/token/0x…</code> opens the full room with its chart, swap panel and whale watch.
              </li>
            </ul>
            <p>
              Rooms accept <code>0x…</code>, <code>99901-0x…</code> and <code>99901:0x…</code> addresses; all three name the same room.
            </p>
          </section>

          <section id="people">
            <h2>Following, notifications, messages</h2>
            <ul>
              <li>Follow someone to see their posts in your Following feed. Your follower lists can be hidden in Settings; the counts stay visible.</li>
              <li>Notifications cover reactions, replies, reposts, quotes, mentions and new followers. They are deleted after 12 hours.</li>
              <li>
                Direct messages are one to one and up to 1,000 characters. They are stored on the server so both people can read them on any device. They are not
                end-to-end encrypted.
              </li>
            </ul>
          </section>

          <section id="wallet">
            <h2>Linking a wallet</h2>
            <p>
              Optional. In Settings you can link an EVM address to your profile. If you sign the one-time message your wallet shows, the server checks the signature and
              your profile gets the verified mark. The message names this site, your username, chain ID {CHAIN.id} and a random code, and expires after 10 minutes.
            </p>
            <p>
              Signing is free and is not a transaction. Threadsium never asks you to send funds, approve tokens or share a seed phrase. A pasted address without a
              signature is shown as “not verified”.
            </p>
          </section>

          <section id="limits">
            <h2>Limits</h2>
            <p>Threadsium runs on Cloudflare's free allowances. Storage and request budgets are finite, so the site enforces limits and tells you when one is reached.</p>
            <div className="table-scroll" role="region" aria-label="Limits table" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Limit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Post, reply, message length</td>
                    <td>500, 400 and 1,000 characters</td>
                  </tr>
                  <tr>
                    <td>Image per post</td>
                    <td>{mb(media?.post)}</td>
                  </tr>
                  <tr>
                    <td>Profile picture, cover</td>
                    <td>
                      {mb(media?.avatar)}, {mb(media?.banner)}
                    </td>
                  </tr>
                  <tr>
                    <td>Images per account in total</td>
                    <td>{mb(media?.perAccount)}</td>
                  </tr>
                  <tr>
                    <td>Posts</td>
                    <td>25 per 10 minutes</td>
                  </tr>
                  <tr>
                    <td>Replies, messages</td>
                    <td>40 each per 10 minutes</td>
                  </tr>
                  <tr>
                    <td>Reactions</td>
                    <td>120 per 10 minutes</td>
                  </tr>
                  <tr>
                    <td>Image uploads</td>
                    <td>20 per 10 minutes</td>
                  </tr>
                  <tr>
                    <td>Sign-in attempts</td>
                    <td>10 per username and 15 per connection, per 10 minutes</td>
                  </tr>
                  <tr>
                    <td>Notifications kept</td>
                    <td>12 hours</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              If image storage for the whole site fills up, uploads are refused with a clear message and text posts keep working. If Cloudflare's daily free request
              allowance is exhausted, the site can be unavailable until it resets. Free operation is not guaranteed forever.
            </p>
          </section>

          <section id="privacy">
            <h2>Privacy and your data</h2>
            <ul>
              <li>
                <strong>What is stored:</strong> your username, a salted hash of your password (never the password), your display name, bio, optional wallet address,
                images you upload, your posts, replies, reactions, votes, follows, saved posts and messages.
              </li>
              <li>
                <strong>What is public:</strong> your profile, posts, replies, reactions, votes and, unless you hide them, your follower lists. Saved posts, messages and
                notifications are visible only to you (and, for messages, the other person).
              </li>
              <li>
                <strong>Session:</strong> one cookie that scripts cannot read, valid for 14 days. A hash of your network address is kept with the session and used only to
                limit sign-up and sign-in abuse.
              </li>
              <li>
                <strong>Browser storage:</strong> only your theme choice. No analytics, advertising or third-party trackers are loaded.
              </li>
              <li>
                <strong>Third parties your browser contacts:</strong> when Threadsium's own server does not answer a chain read, the RPC nodes run by the Volta and
                Montra launchpads. Swaps read through your wallet's own connection first. Those nodes see your network address like any website does.
              </li>
              <li>
                <strong>Deleting:</strong> delete a post or reply and it is removed from the database. Delete your account in Settings and your profile, posts, replies,
                reactions, follows, messages and images are removed. An image that was already viewed may stay in browser or network caches for a while.
              </li>
            </ul>
            <p>Pages and API responses that depend on who you are are never stored in shared caches.</p>
          </section>

          <section id="devices">
            <h2>Browsers and devices</h2>
            <p>
              Threadsium is built for current versions of Chrome, Edge, Firefox and Safari on phones, tablets and computers, in portrait and landscape, with touch, mouse
              or keyboard. It respects your device's reduced-motion setting and works at 200% zoom. The animated theme change needs a browser with View Transitions;
              elsewhere the theme simply switches.
            </p>
          </section>

          <section id="trouble">
            <h2>Troubleshooting</h2>
            <dl>
              <dt>“Your session needs a refresh”</dt>
              <dd>Reload the page. This appears when the page was open for a long time or you signed in on another tab.</dd>
              <dt>The chart says there are no swaps</dt>
              <dd>The token has not traded against HYPE on a supported pool in the recent block range, or it only trades on a venue that is not indexed yet.</dd>
              <dt>The chart could not be built</dt>
              <dd>The public RPC endpoints did not answer. Use “Read the logs again”. Posts and votes are unaffected.</dd>
              <dt>A token has a monogram instead of a logo</dt>
              <dd>No logo was found in the launchpads' listings or the token's on-chain metadata.</dd>
              <dt>“You are posting too fast”</dt>
              <dd>You reached a rate limit from the table above. Wait a few minutes.</dd>
              <dt>An upload is refused</dt>
              <dd>The file is not a PNG, JPEG, WebP or GIF, is too large after resizing, or an image allowance is full.</dd>
              <dt>The wallet button is disabled</dt>
              <dd>No browser wallet was detected. Open the site inside your wallet's browser, or paste the address (it will show as not verified).</dd>
            </dl>
          </section>

          <section id="brand">
            <h2>The Threadsium logo</h2>
            <p>
              The name is <strong>Threadsium</strong>: threads, the conversations people have here, woven into Elysium. The logo is built the same way. Its mark
              takes the construction of the Elysium logomark and adds one thread, so anyone who knows Elysium can place it, and the T it makes tells them which
              site it is.
            </p>
            <figure className="brand-steps" aria-label="How the Threadsium mark is built, in three steps">
              <div className="brand-step">
                <Mark size={88} stage="disc" />
                <span className="brand-step-n">1</span>
                <p>
                  <strong>The disc.</strong> A solid circle on a 64-unit grid. Everything that follows is cut inside a ring 2.5 units wide, as in Elysium's logomark.
                </p>
              </div>
              <div className="brand-step">
                <Mark size={88} stage="chevrons" />
                <span className="brand-step-n">2</span>
                <p>
                  <strong>Elysium's chevrons.</strong> Three bands pitched at 30°, heavy, medium and fine (10, 3.4 and 2.2 units), the same triad Elysium stacks in its
                  disc. They open from one apex at the top centre.
                </p>
              </div>
              <div className="brand-step">
                <Mark size={88} />
                <span className="brand-step-n">3</span>
                <p>
                  <strong>The thread.</strong> A vertical strand 7 units wide weaves under the heavy band, over the medium band and under the fine one. The heavy band and
                  the thread read as a T, for Threadsium.
                </p>
              </div>
            </figure>
            <ul>
              <li>
                <strong>Lockup.</strong> Mark, then the name set in Marcellus. The capitals are 0.58 of the disc's height and the gap is 0.24 of it, the ratios of
                Elysium's own lockup.
              </li>
              <li>
                <strong>Colour.</strong> One colour only: ink <code>#0A0A0A</code> on light backgrounds, chalk <code>#FAFAFA</code> on dark ones. The cuts are
                transparent, so the background shows through.
              </li>
              <li>
                <strong>Size and space.</strong> Keep clear space of a quarter of the disc on every side. Below 22 pixels the medium and fine bands are dropped, so
                the favicon is the disc, the heavy band and the thread.
              </li>
              <li>
                <strong>Names.</strong> The files follow Elysium's naming. Each one is titled “Threadsium” inside the file, so screen readers, search engines and
                design tools call it by name.
              </li>
            </ul>
            <div className="brand-files">
              <div className="brand-file brand-file-light">
                <Wordmark size={40} />
              </div>
              <div className="brand-file brand-file-dark">
                <Wordmark size={40} />
              </div>
            </div>
            <ul className="brand-downloads">
              {[
                ["threadsium-logomark-dark.svg", "Logomark, ink"],
                ["threadsium-logomark-light.svg", "Logomark, chalk"],
                ["threadsium-logomark-wordmark-dark.svg", "Logomark and wordmark, ink"],
                ["threadsium-logomark-wordmark-light.svg", "Logomark and wordmark, chalk"],
              ].map(([file, label]) => (
                <li key={file}>
                  <a href={`/brand/${file}`} download>
                    {label}
                  </a>{" "}
                  <code>{file}</code>
                </li>
              ))}
            </ul>
            <p>
              The mark borrows Elysium's construction as a nod to the chain it lives on. It is not the Elysium logo, and Threadsium is not run by Kinetiq.
            </p>
          </section>

          <section id="support">
            <h2>Support</h2>
            <p>
              Report a problem or an account that breaks the rules by opening an issue on the project's repository at{" "}
              <a href="https://github.com/meisems/threadsium/issues" target="_blank" rel="noopener noreferrer">
                github.com/meisems/threadsium
              </a>
              . Never include your password or a seed phrase in a report. Nobody from Threadsium will ask for them.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
