import '@/app/seo.css';
import SiteHeader from '@/components/SiteHeader';
import Breadcrumbs from '@/components/seo/Breadcrumbs';

// Shared wrapper for every crawlable SEO page: the one shared site header, a
// breadcrumb trail (visible + JSON-LD), and the content container.
export default function SeoShell({
  crumbs,
  children,
}: {
  crumbs: { name: string; path: string }[];
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="seo-wrap">
        <Breadcrumbs items={crumbs} />
        {children}
      </main>
    </>
  );
}
