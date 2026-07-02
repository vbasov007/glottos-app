import { Suspense } from 'react';
import { LandingClient } from '../components/LandingClient';
import { AuthMenu } from '../components/AuthMenu';
import { TutorLink } from '../components/TutorLink';

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12 relative">
      {/* User chip — always top-right of the landing page so the avatar+name
          aren't competing with body content. AuthMenu handles both signed-in
          (avatar + name + sign-out dropdown) and signed-out (Google button). */}
      <div className="absolute top-4 right-4 z-10">
        <AuthMenu />
      </div>

      {/* Greeting in every supported native AND target language. Order keeps
          the latin-script natives first for the most likely visitor groups,
          then targets, then non-latin scripts. */}
      <p className="text-2xl sm:text-3xl md:text-4xl pr-32 sm:pr-48 leading-tight">
        Hi!{' · '}Привет!{' · '}Cześć!{' · '}Hallo!{' · '}Salut!{' · '}¡Hola!{' · '}Здраво!{' · '}<bdi>გამარჯობა!</bdi>{' · '}<bdi>שלום!</bdi>
      </p>

      {/* Suspense boundary required because LandingClient uses useSearchParams,
          which forces client-side rendering at this boundary. */}
      <Suspense fallback={<div className="mt-10 text-sm text-zinc-500">Loading…</div>}>
        <LandingClient />
      </Suspense>

      {/* Companion-app handoff. Same SSO + theme + from-path round-trip the
          per-lesson chips use, so a signed-in landing visitor crosses over
          already authenticated. The landing page is not locale-scoped, so
          the label is English-only — text-tutor's own landing handles
          per-user UI. */}
      <div className="mt-10">
        <TutorLink style="nav" label="Open Audio Tutor" />
      </div>

      <p className="mt-16 text-xs italic text-zinc-500">
        5% — understand the rule. 95% — train your mouth. Language is a sport. Open your mouth and speak.
      </p>
    </main>
  );
}
