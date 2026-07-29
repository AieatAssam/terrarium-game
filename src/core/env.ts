// Single place the DEV flag pattern lives. `import.meta.env.DEV` is replaced
// by Vite at build time (false + dead-code-eliminated in production builds),
// so anything gated behind `isDev` — e.g. Subagent F's debug panel — is
// neither rendered nor bundled into dist/. Verify absence in dist/ with a
// grep at integration time, not just by trusting the conditional.
export const isDev: boolean = import.meta.env.DEV;
