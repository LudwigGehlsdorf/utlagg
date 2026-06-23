"use client";

// Client-only wrapper around the receipt viewer. pdf.js (used inside) touches
// browser globals at import time, so the implementation must never be evaluated
// during SSR — `ssr: false` guarantees that and keeps pdfjs out of the server
// bundle. Consumers import { ReceiptViewer } from here as usual.
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { ReceiptViewerProps } from "./receipt-viewer-impl";

const Impl = dynamic(() => import("./receipt-viewer-impl"), {
  ssr: false,
  loading: () => null,
});

export function ReceiptViewer(props: ReceiptViewerProps) {
  // Reserve the viewer's box (height/border from `className`) while the client
  // chunk loads, to avoid layout shift; the impl fills it.
  return (
    <div className={cn("relative overflow-hidden bg-surface/40", props.className)}>
      <Impl {...props} className="h-full w-full" />
    </div>
  );
}
