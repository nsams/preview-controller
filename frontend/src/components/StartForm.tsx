import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { previewPath, startPreview } from "../api.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

type Fields = { org: string; repo: string; branch: string };

const fields: { name: keyof Fields; label: string; placeholder: string }[] = [
    { name: "org", label: "Organization", placeholder: "vivid-planet" },
    { name: "repo", label: "Repository", placeholder: "dextinity-starter" },
    { name: "branch", label: "Branch", placeholder: "main" },
];

/** Organization and repository start out as the ones used last, the branch is what usually changes. */
export function StartForm({ initial }: { initial?: Partial<Fields> }) {
    const navigate = useNavigate();
    const [values, setValues] = useState<Fields>({ org: initial?.org ?? "", repo: initial?.repo ?? "", branch: "" });
    const [error, setError] = useState<unknown>();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setIsSubmitting(true);
        setError(undefined);
        try {
            const preview = await startPreview(values);
            navigate(previewPath(preview.slug));
        } catch (caught) {
            setError(caught);
            setIsSubmitting(false);
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 2 }}>
                Start a preview
            </Typography>
            {error ? (
                <Box sx={{ mb: 2 }}>
                    <ErrorMessage error={error} />
                </Box>
            ) : null}
            <Stack component="form" onSubmit={submit} direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" } }}>
                {fields.map(({ name, label, placeholder }) => (
                    <TextField
                        key={name}
                        name={name}
                        label={label}
                        placeholder={placeholder}
                        value={values[name]}
                        onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                        required
                        size="small"
                        autoFocus={name === "branch"}
                        autoComplete="off"
                        slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
                        sx={{ flex: name === "branch" ? 1.2 : 1 }}
                    />
                ))}
                <Button type="submit" variant="contained" startIcon={<PlayArrowIcon />} loading={isSubmitting} sx={{ height: 40 }}>
                    Start
                </Button>
            </Stack>
        </Paper>
    );
}
