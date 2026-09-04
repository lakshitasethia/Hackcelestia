"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  signInAction,
  signUpAction,
  signInWithGoogleAction,
  type AuthState,
} from "@/app/login/actions";

const EMPTY: AuthState = {};

const field =
  "w-full bg-transparent border border-line px-4 py-3 text-fg font-sans text-sm focus:outline-none focus:border-fg transition-colors placeholder:text-muted";
const label =
  "font-display uppercase text-label tracking-label text-accent block mb-2";

/** Google's mark, inline. A CDN-hosted logo is one more thing that can be
 *  offline in a conference hall on borrowed wifi. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.8 41 15.3 46 24 46z" />
      <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3A22 22 0 0 0 2 24c0 3.6.9 6.9 2.3 9.8l7.4-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 30 2 24 2 15.3 2 7.8 7 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
    </svg>
  );
}

/** Disabled and spinning while the action is in flight. Lives in its own
 *  component because `useFormStatus` only reports on the form above it. */
function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-solid w-full py-3.5 text-xs tracking-wider disabled:opacity-60 disabled:cursor-wait"
    >
      {pending ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Working</span>
        </>
      ) : (
        <>
          <span>{children}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </>
      )}
    </button>
  );
}

/**
 * Google is on unless it is explicitly switched off.
 *
 * Until the provider is configured in the Supabase dashboard, clicking it
 * lands on Supabase's raw `{"msg":"Unsupported provider..."}` JSON — Supabase
 * rejects it at its own authorize endpoint, so there is no way for us to catch
 * that and render something civil. Setting NEXT_PUBLIC_GOOGLE_AUTH=off hides
 * the button instead, which is the version you want on a projector.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH !== "off";

export default function AuthForm({
  next,
  initialError,
}: {
  next: string;
  initialError?: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  // One state hook per action rather than one shared: switching tabs should not
  // carry "invalid login credentials" over to the sign-up form, where it makes
  // no sense.
  const [signInState, signIn] = useFormState(signInAction, EMPTY);
  const [signUpState, signUp] = useFormState(signUpAction, EMPTY);

  const state = mode === "signin" ? signInState : signUpState;
  // A provider error arrives as a query param on a fresh page, so nothing has
  // been submitted yet and there is no form state to hold it.
  const error = state.error ?? (initialError || undefined);

  return (
    <div className="surface p-8 sm:p-10">
      {/* Mode switch. Two buttons rather than two routes: the fields are almost
          identical and a full navigation between them loses whatever is typed. */}
      <div className="flex border border-line mb-8">
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Create account"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`flex-1 py-3 font-sans text-xs uppercase tracking-wider font-bold transition-colors ${
              mode === value
                ? "bg-fg text-bg"
                : "text-muted hover:text-fg"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {/* Google first. Most people will use it, and burying it under a password
          form implies it is the fallback. */}
      {GOOGLE_ENABLED && (
        <>
          <form action={signInWithGoogleAction}>
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="btn-outline w-full py-3.5 text-xs tracking-wider gap-2.5"
            >
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
          </form>

          <div className="flex items-center gap-4 my-7">
            <span className="h-px flex-1 bg-line" />
            <span className="font-display uppercase text-xs tracking-label text-muted">
              or
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={mode === "signin" ? signIn : signUp} className="space-y-5">
        <input type="hidden" name="next" value={next} />

        {mode === "signup" && (
          <div>
            <label className={label} htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              autoComplete="name"
              placeholder="Ananya Sharma"
              className={field}
            />
          </div>
        )}

        <div>
          <label className={label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={field}
          />
        </div>

        <div>
          <label className={label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            className={field}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="border border-line bg-bg/40 px-4 py-3 text-sm text-fg"
          >
            {error}
          </p>
        )}

        {state.notice && (
          <p
            role="status"
            className="border border-line bg-bg/40 px-4 py-3 text-sm text-muted"
          >
            {state.notice}
          </p>
        )}

        <Submit>{mode === "signin" ? "Sign in" : "Create account"}</Submit>
      </form>

      <p className="mt-7 pt-6 border-t border-line text-sm text-muted leading-relaxed">
        {mode === "signin"
          ? "New here? Creating an account takes one field more than signing in."
          : "Accounts start as travelers. An operator or a coordinator is promoted by whoever runs the tour company."}
      </p>
    </div>
  );
}
