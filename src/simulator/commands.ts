import type { Simulator } from './view';

/** One simulator, ever: revealed rather than opened a second time. */
export const openSimulator = (simulator: Simulator) => (): Promise<void> => simulator.show();
