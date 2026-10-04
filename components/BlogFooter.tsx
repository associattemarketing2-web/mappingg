import SocialLinks from '@/components/SocialLinks';
import { EMAIL, WHATSAPP_DISPLAY, WHATSAPP_URL } from '@/lib/contact';

// Footer shared by the blog index and blog posts.
export default function BlogFooter() {
  return (
    <footer className="blog-foot">
      <div className="wrap">
        <div className="blog-foot-main">
          <span>© {new Date().getFullYear()} Mappingg.com — a product by Associatte.</span>
          <span className="blog-foot-contact">
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a> · WhatsApp{' '}
            <a href={WHATSAPP_URL} target="_blank" rel="noopener">{WHATSAPP_DISPLAY}</a>
          </span>
          <span><a href="/">Home</a> · <a href="/map">Live map</a> · <a href="/contact">Contact</a></span>
        </div>
        <SocialLinks email />
      </div>
    </footer>
  );
}
