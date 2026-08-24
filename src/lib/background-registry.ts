const controllers = new Map<string, AbortController>();

export function registerBackgroundController(jobId: string, controller: AbortController) {
  controllers.set(jobId, controller);
}

export function unregisterBackgroundController(jobId: string) {
  controllers.delete(jobId);
}

export function abortBackgroundJob(jobId: string) {
  controllers.get(jobId)?.abort();
}
