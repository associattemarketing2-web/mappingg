// Lets TypeScript accept side-effect stylesheet imports (`import './globals.css'`).
// Next.js bundles these itself; newer TypeScript (e.g. the one bundled with
// VS Code) otherwise reports "Cannot find module or type declarations" (TS2882).
declare module '*.css';
