// Inline JSON-LD <script> for structured data. Server component — no
// client JS shipped. Renders dangerouslySetInnerHTML, which is safe here
// because the payload is fully derived from server-side content (no user
// input), but we still escape `</` to prevent script-tag breakout.

interface Props {
  data: object;
}

export function JsonLd({ data }: Props) {
  const json = JSON.stringify(data).replace(/<\/script/gi, '<\\/script');
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}
