import SubmissionsReview from '@/components/admin/SubmissionsReview';

export const dynamic = 'force-dynamic';

// Review queue for projects developers add from their dashboard. Gated by the
// /s-admin layout (staff only). Approving publishes the pin to the public map.
export default function SubmissionsPage() {
  return <SubmissionsReview />;
}
