// The Send / tip button on posts, replies and conversations. The sheet (and the wallet code it needs) loads only when
// someone presses it, so the feed stays light.
import React, { Suspense, useState } from "react";
import type { Message, UserLite } from "../lib/api";
import { useApp } from "../state";
import { IconSend } from "./icons";
import { useAuthGuard } from "./PostCard";

const SendSheet = React.lazy(() => import("./SendSheet"));

export interface SendContext {
  kind: "post" | "reply" | "message";
  /** Post id for posts and replies (replies link to their post). */
  postId?: string;
}

/** Why the viewer cannot send to `to`, or null when they can. */
export function sendBlocker(viewerId: string | null | undefined, to: UserLite): string | null {
  if (to.id === "u_elysium_desk") return "The system account cannot receive transfers.";
  if (viewerId && viewerId === to.id) return "This is you.";
  if (!to.walletAddress) return `@${to.username} has not linked a wallet, so there is nowhere to send to.`;
  return null;
}

/**
 * With no linked wallet on the other side the button stays visible but disabled, and pressing it says why (a tooltip
 * alone would not reach phone users).
 */
export function SendAction({
  to,
  context,
  variant = "action",
  onRecorded,
}: {
  to: UserLite;
  context: SendContext;
  variant?: "action" | "link" | "button";
  onRecorded?: (m: Message) => void;
}): React.ReactElement | null {
  const { user, toast } = useApp();
  const guard = useAuthGuard();
  const [open, setOpen] = useState(false);
  if (user && user.id === to.id) return null;
  const blocked = sendBlocker(user?.id, to);
  const label = blocked ? `Send to @${to.username}. Unavailable: ${blocked}` : `Send HYPE or a token to @${to.username}`;
  const press = () => {
    if (blocked) return toast(blocked, "error");
    if (!guard("send to people")) return;
    setOpen(true);
  };
  const off = blocked ? " is-disabled" : "";
  const cls = variant === "action" ? `action action-send${off}` : variant === "link" ? `link-btn${off}` : `btn btn-ghost btn-small${off}`;
  return (
    <>
      <button type="button" className={cls} aria-disabled={blocked ? true : undefined} aria-label={label} title={blocked ?? label} onClick={press}>
        {variant === "link" ? "Send" : <IconSend size={variant === "action" ? 19 : 17} />}
        {variant === "button" ? <span>Send</span> : null}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <SendSheet to={to} context={context} onClose={() => setOpen(false)} onRecorded={onRecorded} />
        </Suspense>
      ) : null}
    </>
  );
}
