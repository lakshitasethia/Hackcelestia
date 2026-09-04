"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The shape every form on this page reads back. `useFormState` needs the
 * action to return something serialisable, and a discriminated result is
 * easier to render than a thrown error — a wrong password is an ordinary
 * outcome, not an exception.
 */
export type AuthState = {
  error?: string;
  notice?: string;
};

/**
 * Where to send someone after they sign in.
 *
 * Only a path from our own site is honoured. `next=https://evil.example` in a
 * link would otherwise turn our login page into an open redirect that borrows
 * our domain's credibility — cheap to prevent, unpleasant to be caught with.
 */
function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

/** The origin this request actually arrived on, so OAuth comes back to the
 *  same place — localhost in dev, the deployment in production, without a
 *  second environment variable to keep in sync. */
function origin(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-host");
  const host = forwarded ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (host ? `${proto}://${host}` : "http://localhost:3000")
  );
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) return { error: "Email and password are both required." };

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase says "Invalid login credentials" for both a wrong password and
    // an address that was never registered, and that is the right answer to
    // give back — distinguishing them tells a stranger which emails exist.
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const next = safeNext(formData.get("next"));

  if (!email || !password) return { error: "Email and password are both required." };
  if (password.length < 8)
    return { error: "Use at least 8 characters — Supabase rejects anything shorter." };

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the `handle_new_user` trigger, which copies it into
      // `profiles.full_name`. Set it here or the profile row is born blank.
      data: { full_name: fullName },
      emailRedirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };

  /**
   * An email that is already registered does not come back as an error.
   * Supabase deliberately returns a user-shaped response with no identities,
   * so that a stranger cannot use this form to discover who has an account.
   * Without this branch that case falls into the "check your email" message
   * below and sends someone to wait for a mail that is never sent, when what
   * they actually needed was the Sign in tab.
   */
  if (data.user && (data.user.identities ?? []).length === 0) {
    return {
      notice: `${email} already has an account — switch to Sign in.`,
    };
  }

  // With email confirmation switched on, `signUp` returns a user but no
  // session — there is nothing to redirect *to* yet, so say so rather than
  // bouncing them to a page that will send them straight back here.
  if (!data.session) {
    return {
      notice: `Check ${email} for a confirmation link, then sign in.`,
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

/**
 * Google.
 *
 * The server action only asks Supabase for the consent URL; the browser has to
 * be the thing that travels to Google, so this redirects rather than fetching.
 * Google sends the user back to Supabase, which sends them to
 * `/auth/callback` with a code that the route handler trades for a session.
 */
export async function signInWithGoogleAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        // Ask for a refresh token, and let someone pick a different account
        // than the one their browser is already signed into — on a shared
        // demo laptop that second one matters more than it sounds.
        access_type: "offline",
        prompt: "consent select_account",
      },
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in is unavailable.")}`);
  }

  redirect(data.url);
}

export async function signOutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
