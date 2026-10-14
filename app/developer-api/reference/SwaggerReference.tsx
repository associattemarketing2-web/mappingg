'use client';

import { useEffect, useState } from 'react';

// Swagger UI (pinned version, Subresource Integrity checked) rendering /api/v1/openapi.json.
// "Try it out" is disabled: keys belong on servers, not in a browser page.
const VERSION = '5.17.14';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${VERSION}`;
const JS = { src: `${BASE}/swagger-ui-bundle.min.js`, sri: 'sha384-5zikP7B6JemcHcJalIiFMnUirmSVBr3lZ85ClVPXO7mamWuqUixgyCMUPcKKfZLk' };
const CSS = { href: `${BASE}/swagger-ui.min.css`, sri: 'sha384-+R8fx41ke61Yq4+j30C8Uh8fbNUEGy8Le9lzVmeMfiUNd+H3q8gN7qW9LM3rbesj' };

type SwaggerUIBundle = ((o: Record<string, unknown>) => unknown) & { presets: { apis: unknown } };

export default function SwaggerReference({ specUrl }: { specUrl: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const link = document.createElement('link');
    Object.assign(link, { rel: 'stylesheet', href: CSS.href, integrity: CSS.sri, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' });
    document.head.appendChild(link);
    const script = document.createElement('script');
    Object.assign(script, { src: JS.src, integrity: JS.sri, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer', async: true });
    script.onload = () => {
      const ui = (window as unknown as { SwaggerUIBundle?: SwaggerUIBundle }).SwaggerUIBundle;
      if (!ui) return setFailed(true);
      ui({ url: specUrl, dom_id: '#swagger-ui', presets: [ui.presets.apis], supportedSubmitMethods: [], defaultModelsExpandDepth: 0, docExpansion: 'list', deepLinking: true });
    };
    script.onerror = () => setFailed(true);
    document.body.appendChild(script);
    return () => { link.remove(); script.remove(); };
  }, [specUrl]);
  return (
    <>
      {failed && (
        <div className="dapi-fallback">
          The interactive reference could not load. Open the raw <a href={specUrl}>OpenAPI document</a> instead, or import it into Postman or Insomnia.
        </div>
      )}
      <div id="swagger-ui" />
      <noscript>JavaScript is needed for the interactive reference. The raw OpenAPI document is at <a href={specUrl}>{specUrl}</a>.</noscript>
    </>
  );
}
