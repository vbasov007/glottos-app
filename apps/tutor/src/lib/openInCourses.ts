// Producer-side click handler for "Courses" link in the tutor header.
//
// See CROSS_APP_SSO_GUIDE.md (Part B6). Navigates the SAME tab to courses —
// either:
//   - the plain courses URL (no session, anonymous user, or mint failure), or
//   - courses.glottos.com/sso?sso=<token> with a freshly-minted SSO token so
//     the consumer side adopts the same identity.
//
// When the user wants a new tab they can still cmd-click / middle-click the
// header link element — the browser's native modifier handling for those
// gestures works because the click handler doesn't preventDefault on them
// (the caller wires this up on a button, but on a real <a> the modifiers
// would route through navigation directly).

const COURSES_URL: string =
  (import.meta.env.VITE_COURSES_URL as string | undefined) ||
  'https://courses.glottos.com';

// The courses lesson the user arrived from, stashed by App.tsx on SSO arrival.
// Validated as a site-relative path so it can't redirect off-origin.
function getReturnPath(): string | null {
  try {
    const v = localStorage.getItem('courses_return_path');
    if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  } catch { /* ignore */ }
  return null;
}

export async function openInCourses(args: {
  sessionId: string | null;
  isAnonymous: boolean;
}): Promise<void> {
  const ret = getReturnPath();

  // No SSO to mint (signed-out / anonymous / mint failure): deep-link straight
  // to the originating lesson when we know it, else the courses home page.
  const fallback = () => { window.location.href = ret ? COURSES_URL + ret : COURSES_URL; };

  if (!args.sessionId || args.isAnonymous) {
    fallback();
    return;
  }

  try {
    const r = await fetch('/api/sso/mint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': args.sessionId,
      },
      body: JSON.stringify({ to: 'courses' }),
    });
    if (!r.ok) { fallback(); return; }
    const data: { token?: string } = await r.json();
    if (!data?.token) { fallback(); return; }
    // Round-trip the lesson path so /sso lands the user back on it after
    // adopting the session, instead of the courses home page.
    let url = `${COURSES_URL}/sso?sso=${encodeURIComponent(data.token)}`;
    if (ret) url += `&return=${encodeURIComponent(ret)}`;
    window.location.href = url;
  } catch { fallback(); }
}
