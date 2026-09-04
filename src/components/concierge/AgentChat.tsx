"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Send, X } from "lucide-react";
import Vela from "./Vela";
import { formatMoney } from "@/lib/format";
import type { ProposalView, ThreadMessage, ThreadResult } from "@/lib/agent/thread-types";

/**
 * The chat panel, shared by the traveler's concierge and the operator's copilot.
 *
 * The two differ in what they can do — one writes drafts, the other only reads —
 * and not at all in how a conversation looks. Keeping one panel means the
 * behaviour that took the longest to get right (the optimistic echo, the
 * scroll, the "still thinking" note, disabling the buttons mid-flight) is fixed
 * once for both.
 *
 * The important thing about this component is what it does not do. It never
 * writes to a trip. It sends a sentence to a server action and renders what
 * comes back, and the only way anything changes is the Accept button on a
 * proposal card, which calls the same `applyProposal` an operator's accepted
 * re-plan calls.
 */

/** After this long, say why it is slow rather than spinning silently. */
const PATIENCE_MS = 11_000;

export interface AgentChatProps {
  /** Distinguishes one panel's stored open/closed state from another's. */
  storageKey: string;
  name: string;
  subtitle: string;
  /** The label on the closed button. */
  callToAction: string;
  emptyState: string;
  openers: string[];
  placeholder: string;
  initialThread: ThreadMessage[];
  ask: (question: string) => Promise<ThreadResult>;
  /** Omitted for a read-only agent, which never offers anything to accept. */
  decide?: (proposalId: string, accept: boolean) => Promise<ThreadResult>;
  /** Called after a proposal is accepted, to refresh whatever is behind. */
  onApplied?: () => void;
}

export default function AgentChat({
  storageKey,
  name,
  subtitle,
  callToAction,
  emptyState,
  openers,
  placeholder,
  initialThread,
  ask,
  decide,
  onApplied,
}: AgentChatProps) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState(initialThread);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);

  // The panel survives a refresh, which matters because accepting a suggestion
  // causes one — a chat that closed itself every time it worked would be a
  // strange thing to have built.
  useEffect(() => {
    if (sessionStorage.getItem(storageKey) === "open") setOpen(true);
  }, [storageKey]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, open ? "open" : "closed");
  }, [open, storageKey]);

  // A server-rendered thread is fresher than local state after any navigation.
  useEffect(() => setThread(initialThread), [initialThread]);

  useEffect(() => {
    if (!open) return;
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [thread, busy, open]);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  async function send(text: string) {
    const asked = text.trim();
    if (!asked || busy) return;

    setError(null);
    setDraft("");
    setBusy(true);
    // Echoed immediately; replaced wholesale by the server's version below.
    setThread((current) => [
      ...current,
      {
        id: `pending-${Date.now()}`,
        role: "traveler",
        body: asked,
        sentAt: new Date().toISOString(),
        proposal: null,
      },
    ]);

    try {
      const result = await ask(asked);
      setThread(result.messages);
      if (result.error) {
        setError(result.error);
        setDraft(asked);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through.");
      // Drop the echo — leaving it would claim a message was sent that wasn't.
      setThread((current) => current.filter((m) => !m.id.startsWith("pending-")));
      setDraft(asked);
    } finally {
      setBusy(false);
    }
  }

  async function onDecide(proposal: ProposalView, accept: boolean) {
    if (busy || !decide) return;
    setBusy(true);
    setError(null);
    try {
      const result = await decide(proposal.id, accept);
      setThread(result.messages);
      if (result.error) setError(result.error);
      else if (accept) onApplied?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That change could not be applied."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={callToAction}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 surface px-4 py-3
                   text-fg hover:border-fg transition-colors shadow-lg"
      >
        <Vela className="w-5 h-5" />
        <span className="font-display uppercase text-label tracking-label">
          {callToAction}
        </span>
      </button>
    );
  }

  return (
    <section
      className="fixed z-40 flex flex-col surface shadow-2xl
                 inset-x-0 bottom-0 top-auto h-[85vh]
                 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:h-[min(38rem,80vh)]"
      aria-label={name}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2.5 min-w-0">
          <Vela className="w-5 h-5 text-fg shrink-0" thinking={busy} />
          <div className="min-w-0">
            <h2 className="font-display uppercase text-label tracking-label text-fg">
              {name}
            </h2>
            <p className="font-sans text-[0.6875rem] text-muted truncate">
              {subtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="p-1.5 border border-line text-muted hover:text-fg hover:border-fg transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
        aria-live="polite"
      >
        {thread.length === 0 && (
          <div className="my-auto text-center px-2">
            <Vela className="w-9 h-9 mx-auto text-fg" />
            <p className="mt-4 font-sans text-sm text-muted leading-relaxed">
              {emptyState}
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              {openers.map((opener) => (
                <li key={opener}>
                  <button
                    type="button"
                    onClick={() => send(opener)}
                    className="w-full border border-line px-3 py-2 font-sans text-xs text-muted
                               hover:text-fg hover:border-fg transition-colors text-left"
                  >
                    {opener}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {thread.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            busy={busy}
            onDecide={decide ? onDecide : undefined}
          />
        ))}

        {busy && (
          <div className="flex items-center gap-2.5">
            <Vela className="w-4 h-4 text-muted shrink-0" thinking />
            <span className="flex items-center gap-1" aria-label={`${name} is thinking`}>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="vela-dot w-1 h-1 rounded-full bg-current text-muted"
                />
              ))}
            </span>
            {slow && (
              <span className="font-sans text-[0.6875rem] text-muted">
                still thinking — the free tier meters us by the minute
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="font-sans text-xs text-accent border border-line px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <form
        className="border-t border-line p-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+enter breaks the line — the convention every
            // chat has, and the reason the field is a textarea at all.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          maxLength={500}
          placeholder={placeholder}
          aria-label={`Message ${name}`}
          className="flex-1 resize-none bg-transparent border border-line px-3 py-2
                     font-sans text-sm text-fg placeholder:text-muted
                     focus:outline-none focus:border-fg transition-colors max-h-24"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="p-2.5 border border-line text-muted hover:text-fg hover:border-fg
                     transition-colors disabled:opacity-40 disabled:hover:text-muted
                     disabled:hover:border-line"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </section>
  );
}

function Bubble({
  message,
  busy,
  onDecide,
}: {
  message: ThreadMessage;
  busy: boolean;
  onDecide?: (proposal: ProposalView, accept: boolean) => void;
}) {
  if (message.role === "traveler") {
    return (
      <p className="self-end max-w-[85%] border border-line px-3 py-2 font-sans text-sm text-fg">
        {message.body}
      </p>
    );
  }

  return (
    <div className="flex gap-2.5">
      <Vela className="w-4 h-4 mt-1 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p
          className={`font-sans text-sm leading-relaxed ${
            message.failed ? "text-accent" : "text-fg"
          }`}
        >
          {message.body}
        </p>
        {message.proposal && onDecide && (
          <ProposalCard
            proposal={message.proposal}
            busy={busy}
            onDecide={onDecide}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The confirmation step, and the whole reason this is safe to ship.
 *
 * Everything above it is a suggestion. Nothing in the database has moved. The
 * card states the change in full, prices it from a figure the server computed
 * rather than one the model claimed, and waits.
 */
function ProposalCard({
  proposal,
  busy,
  onDecide,
}: {
  proposal: ProposalView;
  busy: boolean;
  onDecide: (proposal: ProposalView, accept: boolean) => void;
}) {
  const decided = proposal.state !== "draft";
  const delta = proposal.costDelta;

  return (
    <article
      className={`mt-3 border border-line p-3 ${
        proposal.state === "accepted" ? "border-fg" : ""
      } ${proposal.state === "rejected" ? "opacity-45" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display uppercase text-label tracking-label text-fg">
          {proposal.summary}
        </h3>
        <span className="font-display text-sm font-semibold text-fg tabular-nums shrink-0">
          {delta === 0
            ? "No change"
            : `${delta > 0 ? "+" : "−"}${formatMoney(
                Math.abs(delta),
                proposal.currency
              )}`}
        </span>
      </div>

      <ul className="mt-2.5 flex flex-col gap-1">
        {proposal.operations.map((operation, index) => (
          <li key={index} className="font-sans text-xs text-muted">
            · {operation}
          </li>
        ))}
      </ul>

      {decided ? (
        <p className="mt-3 font-sans text-[0.6875rem] uppercase tracking-wider text-muted">
          {proposal.state === "accepted" ? "On your itinerary" : proposal.state}
        </p>
      ) : (
        <div className="mt-3 pt-3 border-t border-line flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(proposal, true)}
            className="btn-solid px-4 py-2 !text-[0.6875rem] tracking-wider disabled:opacity-40"
          >
            <Check className="w-3 h-3 mr-1.5 inline" />
            Do it
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(proposal, false)}
            className="border border-line px-4 py-2 font-sans text-[0.6875rem] uppercase
                       tracking-wider font-bold text-muted hover:text-fg hover:border-fg
                       transition-colors disabled:opacity-40"
          >
            Not now
          </button>
        </div>
      )}
    </article>
  );
}
