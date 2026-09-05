"use client";

import { Download } from "lucide-react";

/**
 * "Save as PDF", said out loud.
 *
 * `window.print()` is the whole implementation. Every browser's print dialog
 * has a "Save as PDF" destination, and what it produces is a real PDF with
 * selectable text and live links — better than anything a server-side renderer
 * would give us here, and without shipping a PDF library or a font bundle into
 * a serverless function.
 *
 * The label says PDF rather than Print because that is what people come here
 * for; the hint underneath says where to find it, because "choose Save as PDF
 * as the destination" is the one step a print dialog does not make obvious.
 */
export default function PrintButton() {
  return (
    <div className="doc-actions">
      <button type="button" onClick={() => window.print()} className="doc-button">
        <Download className="w-4 h-4" />
        Download as PDF
      </button>
      <p className="doc-hint">
        Choose <strong>Save as PDF</strong> as the destination in the dialog
        that opens.
      </p>
    </div>
  );
}
