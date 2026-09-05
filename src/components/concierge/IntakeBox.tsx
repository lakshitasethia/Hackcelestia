"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2 } from "lucide-react";
import Vela from "./Vela";
import { readDescriptionAction, proposeTripAction } from "@/app/plan/actions";

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
  const router = useRouter();
  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
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

  /**
   * The whole trip, not the form.
   *
   * Someone who writes "suggest me a 13-day itinerary" is not asking to be
   * handed a filled-in form and a catalogue; they are asking for the itinerary.
   * This researches the destination on the web, composes a plan, and takes
   * them to it to look at. Nothing exists yet at the other end of that redirect
   * — the proposal page is where they say yes, and saying yes is what builds
   * the trip.
   */
  async function proposeEverything() {
    if (!prose.trim() || planning) return;
    setPlanning(true);
    setError(null);
    setFilled([]);
    setUnclear([]);

    try {
      const result = await proposeTripAction(prose);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/plan/proposal/${result.proposalId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setPlanning(false);
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
        Describe the trip, anywhere in the world. I will search the web for
        what is actually there — places to stay, things to do, what the trains
        cost — and plan the whole thing: route, days, times and prices, with the
        pages I read it all off. You see the itinerary and say yes before
        anything is created.
      </p>

      <textarea
        value={prose}
        onChange={(event) => setProse(event.target.value)}
        rows={3}
        maxLength={2000}
        /**
         * Deliberately not an example trip.
         *
         * It used to be a complete, ready-to-use Switzerland prompt — which
         * meant anyone typing their own request was overwriting a suggestion
         * that looked suspiciously like the one in the demo. A placeholder
         * should say what shape of answer helps, not hand over the answer.
         */
        placeholder="Where do you want to go, when, and what matters to you? Dates, budget and anything compulsory all help."
        className="mt-4 w-full bg-transparent border border-line px-4 py-3 text-fg font-sans text-sm
                   focus:outline-none focus:border-fg transition-colors placeholder:text-muted resize-y"
      />

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={proposeEverything}
          disabled={planning || busy || !prose.trim()}
          className="flex items-center gap-2 bg-fg text-bg px-4 py-2.5 font-sans text-xs
                     uppercase tracking-wider font-bold hover:opacity-90 transition-opacity
                     disabled:opacity-40"
        >
          <Wand2 className="w-3.5 h-3.5" />
          {planning ? "Researching and planning…" : "Research and plan the whole trip"}
        </button>

        <button
          type="button"
          onClick={read}
          disabled={busy || planning || !prose.trim()}
          className="flex items-center gap-2 border border-line px-4 py-2.5 font-sans text-xs
                     uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg
                     transition-colors disabled:opacity-40 disabled:hover:text-muted
                     disabled:hover:border-line"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busy ? "Reading…" : "Just fill the form"}
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
