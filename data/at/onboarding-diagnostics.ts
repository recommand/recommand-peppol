export type OnboardingLogger = Pick<Console, 'info' | 'warn' | 'error'>;

export function onboardingDiagnostics(logger: OnboardingLogger, scope: string, slowMs = 30_000) {
  const emit = (level: keyof OnboardingLogger, event: string) => {
    try {
      logger[level](`[onboarding-diagnostics] ${scope} ${event}`);
    } catch {
      // Diagnostics must not change processing or retry behaviour.
    }
  };
  return {
    emit,
    async step<T>(stage: string, action: () => Promise<T>): Promise<T> {
      const started = performance.now();
      emit('info', `${stage} started`);
      const timer = setTimeout(() => emit('warn', `${stage} still-running elapsedMs=${Math.round(performance.now() - started)}`), slowMs);
      timer.unref();
      try {
        const result = await action();
        emit('info', `${stage} completed elapsedMs=${Math.round(performance.now() - started)}`);
        return result;
      } catch (error) {
        emit('error', `${stage} failed elapsedMs=${Math.round(performance.now() - started)}`);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
