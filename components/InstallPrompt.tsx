'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
}

// Floating "Install App" control shown on every page (public map, admin editor,
// 3D map). Uses the native install prompt on Android/desktop Chromium, and shows
// Add-to-Home-Screen instructions on iOS (which has no programmatic prompt).
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosSheet, setShowIosSheet] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed → nothing to show

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — offer manual instructions instead.
    if (isIos()) setVisible(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => {});
      setDeferred(null);
      setVisible(false);
    } else if (isIos()) {
      setShowIosSheet(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        aria-label="Install Mappingg app"
        style={{
          position: 'fixed',
          left: 14,
          bottom: 14,
          zIndex: 100000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 999,
          border: '1px solid rgba(0,0,0,0.08)',
          background: '#1b2430',
          color: '#fff',
          font: '600 13px/1 Inter, system-ui, sans-serif',
          boxShadow: '0 6px 18px rgba(27,36,48,0.28)',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ fontSize: 15 }}>⬇</span>
        Install App
        <span
          role="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            setVisible(false);
          }}
          style={{ marginLeft: 4, opacity: 0.7, fontSize: 15, lineHeight: 1 }}
        >
          ×
        </span>
      </button>

      {showIosSheet && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowIosSheet(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100001,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px 16px 0 0',
              padding: 20,
              maxWidth: 420,
              width: '100%',
              font: '400 14px/1.5 Inter, system-ui, sans-serif',
              color: '#1b2430',
            }}
          >
            <h2 style={{ margin: '0 0 10px', font: '700 16px/1.2 Inter, sans-serif' }}>
              Install Mappingg
            </h2>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Tap the <strong>Share</strong> button in Safari’s toolbar.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> — Mappingg opens like a normal app.</li>
            </ol>
            <button
              onClick={() => setShowIosSheet(false)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '11px',
                borderRadius: 10,
                border: 'none',
                background: '#1b2430',
                color: '#fff',
                font: '600 14px Inter, sans-serif',
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
