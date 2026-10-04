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
        <div className="card">
            <h2>Start a preview</h2>
            <ErrorMessage error={error} />
            <form className="start-form" onSubmit={submit}>
                {fields.map(({ name, label, placeholder }) => (
                    <label key={name}>
                        {label}
                        <input
                            name={name}
                            value={values[name]}
                            placeholder={placeholder}
                            onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                            required
                            spellCheck={false}
                            autoCapitalize="off"
                            autoComplete="off"
                            autoFocus={name === "branch"}
                        />
                    </label>
                ))}
                <button type="submit" disabled={isSubmitting}>
                    Start
                </button>
            </form>
        </div>
    );
}
