import { useEffect, useState } from "react";

export type PollingState<T> = {
    data?: T;
    error?: unknown;
    isLoading: boolean;
};

/** Loads right away and again every intervalMs, keeping the last data while a reload runs. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number): PollingState<T> {
    const [state, setState] = useState<PollingState<T>>({ isLoading: true });

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
                    setState((previous) => ({
                        data: previous.data,
                        error,
                        isLoading: false,
                    }));
                }
            }
            if (!isCancelled) {
                timer = setTimeout(run, intervalMs);
            }
        };
        run();

        return () => {
            isCancelled = true;
            clearTimeout(timer);
        };
    }, [load, intervalMs]);

    return state;
}
