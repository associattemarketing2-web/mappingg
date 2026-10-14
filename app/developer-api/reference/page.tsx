import type { Metadata } from 'next';
import Link from 'next/link';
import '../dev-api.css';
import InfoPage from '@/components/InfoPage';
import { buildMetadata } from '@/lib/seo/metadata';
import { API_BASE_PATH } from '@/lib/api-platform/config';
import SwaggerReference from './SwaggerReference';

export const metadata: Metadata = buildMetadata({
  title: 'Developer API reference',
  description: 'Endpoints, parameters, response schemas and error codes of the Mappingg Developer API (OpenAPI 3.1).',
  path: '/developer-api/reference',
});

export default function ApiReferencePage() {
  return (
    <InfoPage
      path="/developer-api/reference"
      crumb="API reference"
      eyebrow="Developer API · v1"
      icon="fas fa-book"
      tone="water"
      title={<>API <span className="accent">reference</span></>}
      intro="Generated from the API’s OpenAPI 3.1 document. Requests need a key, so “Try it out” is turned off here — call the API from your server."
      actions={
        <>
          <Link className="btn btn-outline" href="/developer-api"><i className="fas fa-arrow-left" aria-hidden="true" /> Guide</Link>
          <a className="btn btn-outline" href={`${API_BASE_PATH}/openapi.json`}><i className="fas fa-file-code" aria-hidden="true" /> openapi.json</a>
        </>
      }
    >
      <section className="dapi-ref">
        <div className="container">
          <SwaggerReference specUrl={`${API_BASE_PATH}/openapi.json`} />
        </div>
      </section>
    </InfoPage>
  );
}
