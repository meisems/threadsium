import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Post, type RoomToken } from "../lib/api";
import { prepareImage } from "../lib/image";
import { postBus, useApp } from "../state";
import { Avatar, TokenMark } from "./Avatar";
import { IconClose, IconImage } from "./icons";
import { QuotedCard } from "./PostCard";
import { limitsFor } from "../config/premium";


/** The ticker being typed just before the caret ("$kn"), if any. */
function tickerAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|[^A-Za-z0-9_])\$([A-Za-z0-9]{0,11})$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toUpperCase() };
}

export function ComposerBox({
  room = null,
  quote,
  initialText = "",
  placeholder,
  autoFocus = false,
  onPosted,
}: {
  room?: { address: string; symbol: string } | null;
  quote?: Post;
  initialText?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: (p: Post) => void;
}): React.ReactElement {
  const { user, tokens, toast } = useApp();
  const MAX = limitsFor(user).post;
  const [text, setText] = useState(initialText);
  const [image, setImage] = useState<{ url: string; preview: string } | null>(null);
  const [stage, setStage] = useState<null | "resizing" | "uploading" | "posting">(null);
  const [error, setError] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ start: number; items: RoomToken[]; index: number } | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.preview);
    },
    [image],
  );

  if (!user) {
    return (
      <div className="composer composer-signed-out">
        <p>Sign in to post, react and follow people.</p>
        <Link className="btn btn-primary" to="/auth">
          Sign in or create an account
        </Link>
      </div>
    );
  }

  const updateSuggest = (value: string, caret: number) => {
    const t = tickerAtCaret(value, caret);
    if (!t) return setSuggest(null);
    const items = tokens
      .filter((k) => k.symbol.toUpperCase().startsWith(t.query))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth)
      .slice(0, 5);
    setSuggest(items.length ? { start: t.start, items, index: 0 } : null);
  };

  const pick = (tok: RoomToken) => {
    const el = area.current;
    if (!el || !suggest) return;
    const caret = el.selectionStart;
    const next = `${text.slice(0, suggest.start)}$${tok.symbol} ${text.slice(caret)}`;
    setText(next.slice(0, MAX));
    setSuggest(null);
    const pos = suggest.start + tok.symbol.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const attach = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      setStage("resizing");
      const limits = await api.limits().catch(() => null);
      const blob = await prepareImage(f, 1600, limits?.media.post ?? 1024 * 1024);
      setStage("uploading");
      const r = await api.upload(blob, "post");
      setImage({ url: r.url, preview: URL.createObjectURL(blob) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
      if (file.current) file.current.value = "";
    }
  };

  const submit = async () => {
    const content = text.trim();
    if (stage || (!content && !image)) return;
    setError(null);
    setStage("posting");
    try {
      const r = await api.createPost({ content, imageUrl: image?.url ?? null, roomAddress: room?.address ?? null, quoteOfId: quote?.id ?? null });
      setText("");
      setImage(null);
      postBus.emit({ type: "created", post: r.post });
      onPosted?.(r.post);
      toast("Posted");
    } catch (e) {
      // The draft stays in the box so nothing typed is lost.
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  const left = MAX - text.length;
  const busyLabel = stage === "resizing" ? "Resizing image…" : stage === "uploading" ? "Uploading image…" : stage === "posting" ? "Posting…" : null;

  return (
    <div className="composer">
      <Avatar user={user} size={40} />
      <div className="composer-main">
        {room ? (
          <div className="composer-room">
            <TokenMark address={room.address} symbol={room.symbol} size={16} /> Posting in the ${room.symbol} room
          </div>
        ) : null}
        <div className="composer-input">
          <textarea
            ref={area}
            className="composer-text"
            rows={1}
            maxLength={MAX}
            value={text}
            placeholder={placeholder ?? (quote ? "Add your comment" : "What's moving on Elysium?")}
            aria-label={quote ? "Your comment on the quoted post" : "Write a post"}
            aria-autocomplete="list"
            aria-expanded={!!suggest}
            onChange={(e) => {
              setText(e.target.value);
              updateSuggest(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              if (suggest) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = suggest.items.length;
                  setSuggest({ ...suggest, index: (suggest.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pick(suggest.items[suggest.index]);
                  return;
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSuggest(null);
                  return;
                }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            onBlur={() => window.setTimeout(() => setSuggest(null), 150)}
          />
          {suggest ? (
            <ul className="suggest" role="listbox" aria-label="Matching tokens">
              {suggest.items.map((tok, i) => (
                <li key={tok.address} role="option" aria-selected={i === suggest.index}>
                  <button type="button" className={i === suggest.index ? "is-active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(tok)}>
                    <TokenMark address={tok.address} symbol={tok.symbol} size={22} />
                    <span className="suggest-symbol">${tok.symbol}</span>
                    <span className="suggest-name">{tok.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {image ? (
          <div className="composer-image">
            <img src={image.preview} alt="Attached image preview" />
            <button type="button" className="icon-btn composer-image-remove" aria-label="Remove the image" onClick={() => setImage(null)}>
              <IconClose size={16} />
            </button>
          </div>
        ) : null}

        {quote ? <QuotedCard post={{ id: quote.id, author: quote.author, content: quote.content, imageUrl: quote.imageUrl, roomAddress: quote.roomAddress, createdAt: quote.createdAt }} /> : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="composer-bar">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void attach(e.target.files?.[0])} />
          <button type="button" className="icon-btn" aria-label="Add an image" disabled={!!stage || !!image} onClick={() => file.current?.click()}>
            <IconImage size={20} />
          </button>
          <span className="composer-hint">$TICKER links a token room</span>
          <span className="composer-spacer" />
          {busyLabel ? (
            <span className="composer-status" role="status">
              {busyLabel}
            </span>
          ) : text.length > MAX - 80 ? (
            <span className={`composer-count${left < 20 ? " is-low" : ""}`} aria-label={`${left} characters left`}>
              {left}
            </span>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={!!stage || (!text.trim() && !image)} onClick={submit}>
            {quote ? "Post quote" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The composer in a dialog: opened from the Post button, the mobile tab bar and "Quote". */
export function ComposerDialog(): React.ReactElement | null {
  const { composing, closeComposer } = useApp();
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!composing) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeComposer();
      if (e.key === "Tab" && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, a[href], input:not([hidden])");
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus?.();
    };
  }, [composing]);

  if (!composing) return null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeComposer()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={composing.quote ? "Quote a post" : "New post"} ref={panel}>
        <header className="dialog-head">
          <h2>{composing.quote ? "Quote" : "New post"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closeComposer}>
            <IconClose size={20} />
          </button>
        </header>
        <ComposerBox quote={composing.quote} room={composing.room ?? null} initialText={composing.text ?? ""} autoFocus onPosted={closeComposer} />
      </div>
    </div>
  );
}
