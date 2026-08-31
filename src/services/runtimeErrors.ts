export function reportRuntimeError(message: string, error?: unknown) {
  const detail =
    error === undefined
      ? message
      : `${message}: ${error instanceof Error ? error.message : String(error)}`;
  window.dispatchEvent(
    new CustomEvent("janja-runtime-error", {
      detail,
    }),
  );
}
