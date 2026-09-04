"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import Vela from "./Vela";
import { readDescriptionAction } from "@/app/plan/actions";

/**
 * Describe the trip in a sentence; the form fills itself in.
 *
 * It writes into the fields below rather than submitting anything, which is the
 * whole point — every value stays visible and editable, and the traveler
 * presses the same Create button they would have pressed anyway. An intake
 * agent that created the trip directly would be faster and much worse: nobody
 * would ever see what it decided their budget was.
 *
 * The fields are set through the DOM instead of React state because the form is
 * deliberately uncontrolled — plain server-rendered inputs posting to a server
 * action, with no client component in the path. Filling them in place keeps it
 * that way; the alternative was making the whole form a client component to
 * support one optional shortcut.
 */
export default function IntakeBox() {
  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    if (!prose.trim() || busy) return;
    setBusy(true);
    setError(null);
    setFilled([]);
    setUnclear([]);

    try {
      const result = await readDescriptionAction(prose);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const spec = result.spec;
      const done: string[] = [];

      const setValue = (id: string, value: string | number | null, label: string) => {
        if (value === null || value === "") return;
        const element = document.getElementById(id) as
          | HTMLInputElement
          | HTMLSelectElement
          | null;
        if (!element) return;
        element.value = String(value);
        done.push(label);
      };

      setValue("title", spec.title, "trip name");
      setValue("partySize", spec.partySize, "party size");
      setValue("budget", spec.budget, "budget");
      setValue("startsOn", spec.startsOn, "start date");
      setValue("endsOn", spec.endsOn, "end date");
      setValue("pace", spec.pace, "pace");
      setValue("style", spec.style, "style");
      setValue("mobility", spec.mobility, "access needs");
      if (spec.dietary.length) setValue("dietary", spec.dietary.join(", "), "dietary");

      if (spec.interests.length) {
        const boxes = document.querySelectorAll<HTMLInputElement>(
          'input[name="interests"]'
        );
        // Only ever ticks boxes. Unticking something the traveler chose by hand
        // because a later description did not mention it would be maddening.
        for (const box of boxes) {
          if (spec.interests.includes(box.value)) box.checked = true;
        }
        done.push(`interests (${spec.interests.join(", ")})`);
      }

      setFilled(done);
      setUnclear(spec.unclear);
      if (done.length === 0) {
        setError("I could not pick anything out of that. Try naming dates, numbers or what you enjoy.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface p-5 mb-10">
      <div className="flex items-center gap-2.5">
        <Vela className="w-4 h-4 text-fg" thinking={busy} />
        <h2 className="font-display uppercase text-label tracking-label text-fg">
          Or just say it
        </h2>
      </div>
      <p className="mt-2 font-sans text-xs text-muted">
        Describe the trip and I will fill the form in. Nothing is submitted —
        check every field before you create it.
      </p>

      <textarea
        value={prose}
        onChange={(event) => setProse(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Five days on the Amalfi Coast in September for me and my wife, around €4,500. We like food and being on the water, nothing too strenuous, and she's vegetarian."
        className="mt-4 w-full bg-transparent border border-line px-4 py-3 text-fg font-sans text-sm
                   focus:outline-none focus:border-fg transition-colors placeholder:text-muted resize-y"
      />

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={read}
          disabled={busy || !prose.trim()}
          className="flex items-center gap-2 border border-line px-4 py-2.5 font-sans text-xs
                     uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg
                     transition-colors disabled:opacity-40 disabled:hover:text-muted
                     disabled:hover:border-line"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busy ? "Reading…" : "Read this and fill the form"}
        </button>

        {filled.length > 0 && (
          <p className="font-sans text-xs text-muted">
            Filled in {filled.join(", ")}.
          </p>
        )}
      </div>

      {unclear.length > 0 && (
        <p className="mt-3 font-sans text-xs text-muted">
          <span className="uppercase tracking-wider text-accent">Left blank</span>{" "}
          — {unclear.join("; ")}.
        </p>
      )}

      {error && (
        <p className="mt-3 font-sans text-xs text-accent">{error}</p>
      )}
    </section>
  );
}
