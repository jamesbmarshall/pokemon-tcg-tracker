/** Revisions advance only when the UI accepts state or this client commits a mutation.
 * A background GET that the UI discards must not authorize writes from stale displayed data.
 */
const revisions = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
let protocol = false;
let generation = 0;
export const usesMutationProtocol = () => protocol;
export const observeMutationProtocol = (value: string | null) => { if (value === '1') protocol = true; };
export const collectionRevision = (id: string) => revisions.get(id);
export function acceptCollectionRevision(id: string, revision: number | undefined) {
  if (Number.isSafeInteger(revision) && revision! >= 0) revisions.set(id, revision!);
}
export function resetCollectionRevisions() { generation++; revisions.clear(); queues.clear(); }
export function queueCollectionWrite<T>(id: string, run: () => Promise<T>): Promise<T> {
  const started = generation;
  const previous = queues.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => {
    if (started !== generation) throw new Error('This editing session has ended. Reload before saving.');
    return run();
  });
  queues.set(id, pending);
  void pending.finally(() => { if (queues.get(id) === pending) queues.delete(id); }).catch(() => undefined);
  return pending;
}
export function mutationKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}
