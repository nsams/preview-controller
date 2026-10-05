import { FieldContainer } from "@dextinity/admin";
import InputBase, { type InputBaseProps } from "@mui/material/InputBase";
import type { SxProps, Theme } from "@mui/material/styles";
import { useId } from "react";

/**
 * A labelled input styled like the fields of Dextinity. Its own TextField needs final-form, which
 * these few uncontrolled-enough forms do not.
 */
export function Field({ label, required, sx, ...props }: Omit<InputBaseProps, "sx"> & { label: string; sx?: SxProps<Theme> }) {
    const id = useId();
    return (
        <FieldContainer label={label} required={required} fullWidth fieldMargin="never" sx={sx} slotProps={{ label: { htmlFor: id } }}>
            <InputBase id={id} required={required} fullWidth {...props} />
        </FieldContainer>
    );
}
