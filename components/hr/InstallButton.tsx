"use client";
import { useEffect, useState } from "react";
import { Modal } from "./ui";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Install App" button — native prompt on Android/Chrome/Edge, instructions on iPhone */
export default function InstallButton({ className = "" }: { className?: string }) {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (installed) return null;

  return (
    <>
      <button
        className={className || "btn-ghost btn-sm"}
        onClick={async () => {
          if (evt) {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
          } else setHelp(true);
        }}
      >
        📲 Install App
      </button>
      <Modal open={help} onClose={() => setHelp(false)} title="Install the app">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <b>Android (Chrome):</b> tap the ⋮ menu → <b>Install app</b> / <b>Add to Home screen</b>.
          </p>
          <p>
            <b>iPhone (Safari):</b> tap the Share button → <b>Add to Home Screen</b>.
          </p>
          <p>
            <b>Desktop (Chrome / Edge):</b> click the install icon in the address bar.
          </p>
          <p className="text-xs text-slate-400">The app must be opened over HTTPS (or localhost) to be installable.</p>
        </div>
      </Modal>
    </>
  );
}
