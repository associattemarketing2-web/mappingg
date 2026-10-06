// Root loading UI — a lightweight placeholder shown while a server component
// route streams in, so navigation never flashes a blank screen.
export default function Loading() {
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div
        aria-label="Loading"
        role="status"
        style={{
          width: 36,
          height: 36,
          border: '3px solid #e3e8ee',
          borderTopColor: '#1b2430',
          borderRadius: '50%',
          animation: 'mpg-spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes mpg-spin{to{transform:rotate(360deg)}}'}</style>
    </main>
  );
}
