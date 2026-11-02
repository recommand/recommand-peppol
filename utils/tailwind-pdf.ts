const RECOMMAND_RENDER_ENDPOINT = "https://render.recommand.dev";
// A render service that does not answer must not hold the request or worker that waits for it.
const RENDER_TIMEOUT_MS = 60_000;

/**
 * Renders a Mustache template with Tailwind classes to HTML (preview) or PDF.
 */
export async function renderTailwindTemplate(
  templateHtml: string,
  data: unknown,
  options: { preview: boolean; pdfa?: boolean },
): Promise<string | Buffer> {
  const body = JSON.stringify({ html: templateHtml, data });
  const searchParams = new URLSearchParams();
  if (options.preview) {
    searchParams.set("preview", "true");
  }
  if (options.pdfa) {
    searchParams.set("pdfa", "true");
  }
  const query = searchParams.toString();
  const url = query
    ? `${RECOMMAND_RENDER_ENDPOINT}/?${query}`
    : RECOMMAND_RENDER_ENDPOINT;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("Failed to generate document using Tailwind PDF generator");
  }

  if (options.preview) {
    return await response.text();
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
