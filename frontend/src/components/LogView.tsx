import Box from "@mui/material/Box";

/** A block of log output that scrolls on its own instead of stretching the page. */
export function LogView({ children }: { children: string }) {
    return (
        <Box
            component="pre"
            sx={{
                m: 0,
                p: 1.5,
                maxHeight: "60vh",
                overflow: "auto",
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                bgcolor: "action.hover",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                lineHeight: 1.45,
            }}
        >
            {children}
        </Box>
    );
}
