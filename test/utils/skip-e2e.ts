/**
 * Set SKIP_E2E to run only what works offline: no dev server is started and no
 * test talks to a running API. Deploy pipelines use it (see the `test:unit`
 * script and .kamal/hooks/pre-build) so a build never depends on, or is
 * changed by, whatever ETE_UNIT_TEST_* values happen to be in the environment.
 */
export const SKIP_E2E =
  !!process.env.SKIP_E2E && process.env.SKIP_E2E !== "0" && process.env.SKIP_E2E !== "false";
