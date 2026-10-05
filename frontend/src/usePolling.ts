import { useCallback, useEffect, useState } from "react";

export type PollingState<T> = {
    data?: T;
    error?: unknown;
    isLoading: boolean;
    /** Loads again right away, e.g. after an action changed what is shown. */
    reload: () => void;
};

/**
 * Loads right away and again every intervalMs, keeping the last data while a reload runs. An
 * interval of 0 loads once. `load` has to be stable, a new function starts over.
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number): PollingState<T> {
    const [state, setState] = useState<Omit<PollingState<T>, "reload">>({ isLoading: true });
    const [generation, setGeneration] = useState(0);
    const reload = useCallback(() => setGeneration((value) => value + 1), []);

    useEffect(() => {
        let isCancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const run = async () => {
            try {
                const data = await load();
                if (!isCancelled) {
                    setState({ data, isLoading: false });
                }
            } catch (error) {
                if (!isCancelled) {
                    setState((previous) => ({ data: previous.data, error, isLoading: false }));
                }
            }
            if (!isCancelled && intervalMs > 0) {
                timer = setTimeout(run, intervalMs);
            }
        };
        run();

        return () => {
            isCancelled = true;
            clearTimeout(timer);
        };
    }, [load, intervalMs, generation]);

    return { ...state, reload };
}
