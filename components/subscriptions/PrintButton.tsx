'use client';

/** "Download PDF" on an invoice: the browser's print dialog (Save as PDF). */
export default function PrintButton() {
  return (
    <button type="button" className="sub-btn primary" onClick={() => window.print()}>
      <i className="fas fa-file-arrow-down" /> Download / print PDF
    </button>
  );
}
