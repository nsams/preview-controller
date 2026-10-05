import { useEffect, useState } from "react";

/** More than anyone scrolls back through, little enough that a long running log stays light. */
const maxLength = 512 * 1024;

export type LogStreamState = {
    text: string;
    /** Whether the log is being received, or the browser is reconnecting to it. */
    isConnected: boolean;
    /** The server ended the log, for container logs because no container is running anymore. */
    hasEnded: boolean;
    error?: Error;
};

/** Keeps the end of the text, from a line break on, so that no half line is left at the top. */
function trim(text: string): string {
    if (text.length <= maxLength) {
        return text;
    }
    const rest = text.slice(-maxLength);
    return rest.slice(rest.indexOf("\n") + 1);
}

/**
 * Follows one of the log streams of the api, see /previews/:slug/logs/stream in src/api.ts. A
 * reset replaces the text - which also makes a reconnect of the browser start over cleanly - and
 * an append adds to it. A new url, or a new restartKey, opens the stream again. Undefined closes it.
 */
export function useLogStream(url: string | undefined, restartKey?: string): LogStreamState {
    const [state, setState] = useState<LogStreamState>({ text: "", isConnected: false, hasEnded: false });

    useEffect(() => {
        if (!url) {
            return;
        }
        const source = new EventSource(url);
        const read = (event: Event) => JSON.parse((event as MessageEvent<string>).data) as string;

        source.addEventListener("open", () => setState((previous) => ({ ...previous, isConnected: true, error: undefined })));
        source.addEventListener("reset", (event) => setState((previous) => ({ ...previous, text: trim(read(event)) })));
        source.addEventListener("append", (event) => setState((previous) => ({ ...previous, text: trim(previous.text + read(event)) })));
        source.addEventListener("end", () => {
            // Closed before the browser takes the end of the response for something to reconnect to.
            source.close();
            setState((previous) => ({ ...previous, isConnected: false, hasEnded: true }));
        });
        source.addEventListener("error", () => {
            // Connecting again is what the browser does on its own after a dropped connection. A
            // closed source got an answer that was no stream at all, like a missing session.
            if (source.readyState === EventSource.CLOSED) {
                setState((previous) => ({ ...previous, isConnected: false, error: new Error("The log could not be loaded") }));
            }
        });

        return () => {
            source.close();
            setState((previous) => ({ ...previous, isConnected: false, hasEnded: false }));
        };
    }, [url, restartKey]);

    return state;
}
