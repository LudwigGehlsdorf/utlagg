"use client";

// Implementation of the zoomable receipt viewer. Loaded client-only (via the
// dynamic wrapper in receipt-viewer.tsx) because pdf.js touches browser globals
// such as DOMMatrix at import time and can't be evaluated during SSR.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { cn } from "@/lib/utils";

// Served from /public, kept in sync with pdfjs-dist by the copy-pdf-worker script.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface ReceiptViewerProps {
  receiptId: string;
  mimeType: string;
  filename?: string;
  /** Sizing/framing for the inline (non-fullscreen) viewer. */
  className?: string;
}

export default function ReceiptViewerImpl({
  receiptId,
  mimeType,
  filename,
  className,
}: ReceiptViewerProps) {
  const src = `/api/receipts/${receiptId}`;
  const isPdf = mimeType === "application/pdf";

  const [fullscreen, setFullscreen] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Track the container width so PDF pages render to fit (then zoom from there).
  // ResizeObserver fires once on observe, so it supplies the initial width too.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Lock background scroll while in fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const pdfWidth = width ? Math.min(width - 24, 1100) : 600;

  const content = (
    <TransformWrapper minScale={0.5} maxScale={10} doubleClick={{ mode: "zoomIn" }} wheel={{ step: 0.005 }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
              {isPdf && numPages > 1 && (
                <>
                  <ToolBtn label="Föregående sida" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    ‹
                  </ToolBtn>
                  <span className="px-1 text-xs tabular-nums text-muted">
                    {page}/{numPages}
                  </span>
                  <ToolBtn label="Nästa sida" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>
                    ›
                  </ToolBtn>
                  <span className="mx-0.5 h-5 w-px bg-border" />
                </>
              )}
              <ToolBtn label="Zooma ut" onClick={() => zoomOut()}>
                −
              </ToolBtn>
              <ToolBtn label="Zooma in" onClick={() => zoomIn()}>
                +
              </ToolBtn>
              <ToolBtn label="Återställ" onClick={() => resetTransform()}>
                <ResetIcon />
              </ToolBtn>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <ToolBtn label={fullscreen ? "Stäng helskärm" : "Helskärm"} onClick={() => setFullscreen((v) => !v)}>
                {fullscreen ? <CloseIcon /> : <ExpandIcon />}
              </ToolBtn>
            </div>

            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ width: "100%" }}
              wrapperClass="!cursor-grab active:!cursor-grabbing"
            >
              <div className="flex min-h-full w-full items-start justify-center p-2">
                {isPdf ? (
                  <Document
                    file={src}
                    onLoadSuccess={({ numPages: n }) => {
                      setNumPages(n);
                      setPage(1);
                    }}
                    loading={<Hint>Laddar PDF…</Hint>}
                    error={
                      <a href={src} target="_blank" rel="noreferrer" className="p-6 text-sm text-accent">
                        Kunde inte visa PDF – öppna i ny flik
                      </a>
                    }
                  >
                    <Page
                      pageNumber={page}
                      width={pdfWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={filename ?? "Kvitto"}
                    draggable={false}
                    className="max-w-full select-none"
                  />
                )}
              </div>
            </TransformComponent>
          </>
        )}
    </TransformWrapper>
  );

  // Fullscreen renders through a portal to <body> so no ancestor's overflow,
  // transform or stacking context can trap or clip the overlay.
  if (fullscreen) {
    return createPortal(
      <div ref={containerRef} className="fixed inset-0 z-100 overflow-hidden bg-black/90">
        {content}
      </div>,
      document.body,
    );
  }

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden bg-surface/40", className)}>
      {content}
    </div>
  );
}

function ToolBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-full text-[15px] leading-none text-foreground transition-colors hover:bg-surface disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-sm text-muted">{children}</p>;
}

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
