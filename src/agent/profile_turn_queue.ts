/** A small keyed promise queue: tasks for one profile run serially; profiles remain independent. */
export class ProfileTurnQueue {
  private readonly tails = new Map<string, Promise<void>>();

  public run<T>(profileId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(profileId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(profileId, tail);
    void tail.finally(() => {
      if (this.tails.get(profileId) === tail) this.tails.delete(profileId);
    });
    return result;
  }
}
